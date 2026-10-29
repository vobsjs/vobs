#!/usr/bin/env node
/*
 * Runtime guardrail check for `vobs check --runtime`.
 *
 * Why it exists (measured evidence in .artifacts/B-direction.md):
 * static analysis (VOBS_C210) caught only **1 of the 4 self-subscriptions actually
 * fixed in this repo** — the three it missed all "read or write across a function
 * boundary", and static analysis **cannot know the calling context**
 * (`setBrand(v){ overrides.value = … }` reading and writing the same signal is not a
 * self-subscription on its own; it only is when called from inside an effect).
 * Relaxing the rule would flag every legitimate setter as a false positive.
 *
 * The runtime guardrail **actually knows** which effect reads which signal — all 4
 * cases were caught by it. So this check wires the guardrail in: start a dev server
 * that injects the collector into served pages, open each route in real Chrome,
 * collect guardrail errors, and express the verdict through the exit code.
 *
 * Usage:
 *   node scripts/check-runtime.mjs [--root <dir>] [--routes <a,b,c>] [--port 5390] [--ignore <a,b>]
 *   node scripts/check-runtime.mjs --json   # machine-readable verdict (agent self-verification loop: generate → run guardrail → read report → fix)
 *
 * `--json` emits a structured verdict: { version, mode, pass, routes: [{ route, status, guardFailures, clicks }] }.
 * After generating code, an agent can run this check on its own and parse the failed
 * routes and guardrail entries — no human trigger needed.
 *
 * `--ignore` is for **known issues on record** (e.g. the shelved `/devtools` loop in
 * `.artifacts/KNOWN-BUGS.md`). It must be a list of routes spelled out one by one,
 * not a blanket relaxation — so new problems still turn the check red, while known
 * issues do not drown the signal.
 *
 * Design constraints (all bought with this round's pitfalls, do not change):
 * - **The collector must be injected into the served pages**; reading contentWindow
 *   via an iframe from a file:// parent page does not work (the parent's origin is
 *   null, blocked by the same-origin policy)
 * - Chrome needs its **own --user-data-dir** (otherwise the command is forwarded to
 *   an already-running instance, which silently ignores our flags)
 * - Chrome arguments must be joined into a **single string** (`Start-Process
 *   -ArgumentList @(array)` splits them apart)
 */
import { createServer } from 'vite'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback
}

const root = resolve(flag('root', 'playground/basic'))
const port = Number(flag('port', '5390'))
// Interact mode really clicks every button (60ms each); the budget must be enlarged
const interact = args.includes('--interact')
const waitMs = Number(flag('wait', '2500'))
const virtualTimeBudget = interact ? '20000' : '8000'

/** By default read paths from the playground's router file; fall back to the home route. */
function defaultRoutes() {
  const explicit = flag('routes', null)
  if (explicit) return explicit.split(',').map(route => route.trim()).filter(Boolean)
  const routerFile = join(root, 'src/router.ts')
  if (!existsSync(routerFile)) return ['/']
  const source = readFileSync(routerFile, 'utf8')
  const routes = [...source.matchAll(/path:\s*'([^']+)'/gu)].map(match => match[1])
  return routes.length > 0 ? [...new Set(routes)] : ['/']
}

const COLLECTOR = `<script>
(function () {
  var errors = [];
  function pub() {
    document.documentElement.setAttribute('data-guard-errors', JSON.stringify(errors.slice(0, 10)));
    document.documentElement.setAttribute('data-guard-stage', 'done');
  }
  function rec(kind, text) {
    errors.push(kind + ': ' + String(text).slice(0, 400));
    pub();
  }
  window.addEventListener('error', function (e) {
    rec('error', (e.message || '') + ' @ ' + String(e.filename || '').split('/').pop() + ':' + (e.lineno || 0));
  });
  window.addEventListener('unhandledrejection', function (e) {
    rec('rejection', (e.reason && (e.reason.message || e.reason)) || 'unknown');
  });
  var oe = console.error;
  console.error = function () {
    var p = [];
    for (var i = 0; i < arguments.length; i++) { var a = arguments[i]; p.push(a && a.message ? a.message : String(a)); }
    rec('console-error', p.join(' '));
    return oe.apply(console, arguments);
  };
  pub();
})();
</script>`


/*
 * Driver script appended in interact mode (--interact).
 *
 * Why run this separately: the first render only proves "it rendered"; measured
 * experience from this round is that **runtime issues more often appear after
 * interaction** (an ad-hoc interact smoke run caught `insertBefore` receiving null).
 * This clicks **every** button, triggers every input, then reports what the
 * guardrail sees.
 *
 * Three deliberate trade-offs:
 * - **Skip `<a>`**: clicking navigates, which takes us off this route — no longer
 *   testing it
 * - **Skip `type=file`**: assigning a string value throws ("accepts a filename");
 *   that is the probe's own fault, not the app's — it once produced a batch of
 *   false alarms here
 * - **Skip checkbox/radio**: assigning `value` is meaningless for them (state
 *   lives on `checked`)
 */
var INTERACT_SOURCE = `
(function () {
  var clicks = 0;
  function mark(stage) {
    document.documentElement.setAttribute('data-guard-stage', stage);
    document.documentElement.setAttribute('data-guard-clicks', String(clicks));
  }
  function afterClicks() {
    var inputs = document.querySelectorAll('input, textarea, select');
    for (var j = 0; j < inputs.length; j++) {
      var input = inputs[j];
      try {
        if (input.tagName === 'SELECT') {
          if (input.options.length > 1) { input.selectedIndex = 1; input.dispatchEvent(new Event('change', { bubbles: true })); }
        } else if (input.type !== 'file' && input.type !== 'checkbox' && input.type !== 'radio') {
          input.value = input.type === 'password' ? 'smoke' : 'smoke';
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
      } catch (e) { /* one input failing must not abort the whole run */ }
    }
    mark('interacted');
  }
  function clickAll() {
    var all = document.querySelectorAll('button, [role=button]');
    var buttons = [];
    for (var i = 0; i < all.length; i++) { if (!all[i].disabled) buttons.push(all[i]); }
    var step = 0;
    function next() {
      if (step >= buttons.length) { afterClicks(); return; }
      var button = buttons[step++];
      clicks++;
      try { button.click(); } catch (e) { /* an unclickable button must not abort the whole run */ }
      setTimeout(next, 60);
    }
    next();
  }
  setTimeout(clickAll, 2200);
})();
`

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ].filter(Boolean)
  return candidates.find(candidate => existsSync(candidate))
}

/** Open a route in real Chrome and retrieve the result the injected collector wrote into the DOM. */
function openRoute(chrome, url, userDataDir) {
  return new Promise(resolvePromise => {
    // Arguments joined into a single string: the array form gets split apart (see file header)
    const argLine = [
      '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
      `--user-data-dir=${userDataDir}`, `--virtual-time-budget=${virtualTimeBudget}`, '--dump-dom', url
    ].join(' ')
    const child = spawn(chrome, argLine.split(' '), { stdio: ['ignore', 'pipe', 'ignore'] })
    let out = ''
    child.stdout.on('data', chunk => { out += chunk })
    child.on('close', () => resolvePromise(out))
    child.on('error', () => resolvePromise(''))
  })
}

function decode(value) {
  return value.replace(/&quot;/gu, '"').replace(/&amp;/gu, '&').replace(/&lt;/gu, '<').replace(/&gt;/gu, '>')
}

const chrome = findChrome()
if (!chrome) {
  console.error('vobs check --runtime: Chrome not found. Set the CHROME_PATH environment variable to the executable.')
  process.exit(2)
}

const routes = defaultRoutes()
const server = await createServer({
  root,
  server: { port, strictPort: true },
  logLevel: 'silent',
  plugins: [{
    name: 'vobs-check-runtime-collector',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        // Collector always injected; interact mode appends the driver script (it also flips stage from 'done' to 'interacted')
        return html.replace('</head>', COLLECTOR + (interact ? `<script>${INTERACT_SOURCE}</script>` : '') + '</head>')
      }
    }
  }]
})
await server.listen()

const userDataDir = mkdtempSync(join(tmpdir(), 'vobs-check-'))
/** Per-route results — the single source for both text output and the `--json` verdict. */
const routeResults = []
const failures = []
const ignored = new Set(
  flag('ignore', '').split(',').map(route => route.trim()).filter(Boolean)
)
const acknowledged = []
/** How many clicks each route actually received in interact mode (proof the driver ran). */
const clickCounts = []
try {
  for (const route of routes) {
    const dom = await openRoute(chrome, `http://localhost:${port}${route}`, userDataDir)
    const stage = /data-guard-stage="([^"]*)"/u.exec(dom)?.[1] ?? null
    const raw = /data-guard-errors="([^"]*)"/u.exec(dom)
    const clicks = Number(/data-guard-clicks="(\d+)"/u.exec(dom)?.[1] ?? '-1')
    if (stage === null) {
      const failure = { route, errors: ['page not ready (collector did not run; check the dev server)'] }
      failures.push(failure)
      routeResults.push({ route, status: 'failed', guardFailures: failure.errors, clicks: null })
      continue
    }
    /*
     * Interact mode must **prove the clicks really happened**: if the driver script
     * failed to inject, or threw before clicking, stage stays at 'done' — in that
     * case "zero errors" is meaningless (nothing was clicked). This is exactly the
     * "toothless test" pitfall hit earlier: the check went green while the thing it
     * verifies never ran.
     */
    if (interact && stage !== 'interacted') {
      const failure = {
        route,
        errors: [`interaction driver did not finish (stage=${stage}, clicks=${clicks}) — this run's "zero errors" cannot be trusted`]
      }
      failures.push(failure)
      routeResults.push({ route, status: 'failed', guardFailures: failure.errors, clicks })
      continue
    }
    if (interact) clickCounts.push(clicks)
    const errors = raw ? JSON.parse(decode(raw[1])) : []
    if (errors.length === 0) {
      routeResults.push({ route, status: 'pass', guardFailures: [], clicks })
      continue
    }
    if (ignored.has(route)) {
      acknowledged.push({ route, errors })
      routeResults.push({ route, status: 'acknowledged', guardFailures: errors, clicks })
    } else {
      failures.push({ route, errors })
      routeResults.push({ route, status: 'failed', guardFailures: errors, clicks })
    }
  }
} finally {
  await server.close()
  try { rmSync(userDataDir, { recursive: true, force: true }) } catch { /* temp dir cleanup failure does not affect the verdict */ }
}

/*
 * --json: machine-readable verdict (agent self-verification loop). The structure is
 * stable and parseable:
 *   { version: 1, mode, pass, routesChecked, routes: [{ route, status, guardFailures, clicks }] }
 * status ∈ pass / failed / acknowledged — the agent reads failed entries' guardFailures
 * to locate the exact route and guardrail entry, fixes, and re-runs to self-verify;
 * no human needs to trigger check:runtime.
 */
if (args.includes('--json')) {
  console.log(JSON.stringify({
    version: 1,
    mode: interact ? 'interact' : 'render',
    pass: failures.length === 0,
    routesChecked: routes.length,
    routes: routeResults
  }, null, 2))
  process.exit(failures.length === 0 ? 0 : 1)
}

if (failures.length === 0) {
  const mode = interact ? ` (interact mode: clicks + input triggers)` : ''
  const suffix = acknowledged.length > 0
    ? ` (${acknowledged.length} acknowledged known issue(s) passed via --ignore: ${acknowledged.map(item => item.route).join(', ')})`
    : ''
  const clicked = clickCounts.length > 0 ? `, ${clickCounts.reduce((a, b) => a + b, 0)} clicks total (min ${Math.min(...clickCounts)} per route)` : ''
  console.log(`vobs check --runtime${mode}: ${routes.length} routes without guardrail errors${clicked}${suffix}`)
  process.exit(0)
}

console.error(`vobs check --runtime${interact ? ' (interact mode)' : ''}: ${failures.length}/${routes.length} routes with guardrail errors\n`)
for (const failure of failures) {
  console.error(`  ${failure.route}`)
  for (const error of failure.errors) console.error(`    ${error}`)
}
console.error('\nThese problems are only observable at **runtime** (self-subscription / loops / uncaught exceptions).')
console.error('Static analysis cannot see them: when reads or writes cross a function boundary, only the runtime knows the calling context.')
process.exit(1)
