/**
 * Verifies the real behavior of Vobs Devkit's **built artifact** under DSH's client module protocol.
 *
 * Coverage:
 *   1. dsh manifest and exports consistency
 *   2. Host side is a valid cordis plugin
 *   3. lib/client.js only registers a factory; executing it has no side effects
 *   4. Materializing the factory yields the plugin; apply() registers main (keyed) and sidebar.panellist
 *   5. Panel mount: shadow root + full-page vobs rendering + five tabs
 *   6. "Project" page: honestly explains when no service exists; really renders report content once fake services are attached
 *   7. Other pages and real interactions: switching tabs, switching API entries
 *   8. Sidebar icon carries its own dimensions
 *   9. Cleanup: the shadow root is emptied after effect cleanup
 *
 * Run: node packages/dsh-devkit/scripts/verify-devkit.mjs
 */
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { JSDOM } from 'jsdom'

const here = path.dirname(fileURLToPath(import.meta.url))
const packageDir = path.resolve(here, '..')

let failures = 0
let checks = 0

const check = (label, condition, detail = '') => {
  checks += 1
  if (condition) console.log(`  ok   ${label}`)
  else {
    failures += 1
    console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const section = title => console.log(`\n${title}`)
const tick = () => new Promise(resolve => setTimeout(resolve, 0))
const settle = async (times = 3) => { for (let i = 0; i < times; i += 1) await tick() }
const fileExists = async target => {
  try {
    await stat(target)
    return true
  } catch {
    return false
  }
}
const resolveFromPackage = relative => path.join(packageDir, String(relative).replace(/^\.\//u, ''))

/* ---------------------------------------------------------- 1. Manifest consistency */

section('1. dsh manifest')
const manifest = JSON.parse(await readFile(path.join(packageDir, 'package.json'), 'utf8'))
const dsh = manifest.dsh ?? {}
check('package name is valid', /^[a-z0-9][a-z0-9._~-]*$/u.test(manifest.name), manifest.name)
check('dsh.bundle.patch is declared', typeof dsh.bundle?.patch === 'string')
check('dsh.client.platform is web', dsh.client?.platform === 'web')
check('no install-time lifecycle hooks', manifest.scripts?.prepare === undefined && manifest.scripts?.postinstall === undefined)
check(
  'no workspace: protocol dependencies',
  !JSON.stringify({
    dependencies: manifest.dependencies,
    peerDependencies: manifest.peerDependencies,
    devDependencies: manifest.devDependencies
  }).includes('workspace:')
)
check('declares no dependencies (the artifact must be self-contained)', manifest.dependencies === undefined)

const patchText = await readFile(resolveFromPackage(dsh.bundle.patch), 'utf8')
check('patch inserts this package', patchText.includes('insert:') && patchText.includes(manifest.name))
check('patch does not override top-level ids', !/^-\s*id:/mu.test(patchText))

const hostPath = resolveFromPackage(manifest.exports['.'])
const clientPath = resolveFromPackage(manifest.exports['./client'])
check('exports["."] exists', await fileExists(hostPath))
check('exports["./client"] exists', await fileExists(clientPath))

/* --------------------------------------------------------- 2. Host side */

section('2. Host side')
const host = await import(pathToFileURL(hostPath).href)
check('exports a non-empty name', typeof host.name === 'string' && host.name.length > 0, String(host.name))
check('exports an apply function', typeof host.apply === 'function')
host.apply({})

/* ------------------------------------------------------- 3. Bundle shape */

section('3. Client bundle')
const bundleCode = await readFile(clientPath, 'utf8')
check('calls __ModuleLoader__.load exactly once', (bundleCode.match(/__ModuleLoader__\.load\(/gu) ?? []).length === 1)
const requires = bundleCode.match(/require\((['"])[^'"]+\1\)/gu) ?? []
check('synchronous require only targets platform modules', requires.length > 0 && requires.every(call => call.includes('react')), requires.join(','))
check('no dynamic import', !bundleCode.includes('import('))
check('styles inlined into the artifact', bundleCode.includes('.vk-root'))

const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
  runScripts: 'outside-only',
  pretendToBeVisual: true,
  url: 'http://127.0.0.1/'
})

// Intercept the timers: polling must not actually run during verification, but the beat can be advanced manually
const intervals = []
dom.window.setInterval = fn => {
  intervals.push(fn)
  return intervals.length
}
dom.window.clearInterval = () => {}

const registry = new Map()
let loadCalls = 0
dom.window.__ModuleLoader__ = {
  load(entry) {
    loadCalls += 1
    registry.set(entry.id, entry.factory)
  }
}
dom.window.eval(bundleCode)

check('factory registered', registry.has(manifest.name), [...registry.keys()].join(','))
check('executing the bundle has no module side effects', loadCalls === 1 && dom.window.document.body.childNodes.length === 0)

/* --------------------------------------------------- 4. Materialization & slot registration */

section('4. slot registration')
const injectCalls = []
const hostEffects = []
const registered = []
const requireStub = id => {
  if (id === 'react') return createReactStub(hostEffects)
  throw new Error(`verify: the artifact require()d a non-platform module ${id}`)
}

const plugin = registry.get(manifest.name)(requireStub)
check('factory directly returns the plugin object', typeof plugin?.apply === 'function')
check('injects slots', Array.isArray(plugin.inject) && plugin.inject.includes('slots'))
check(
  'also injects sessions and remote (needed for reading the workspace)',
  plugin.inject.includes('sessions') && plugin.inject.includes('remote'),
  plugin.inject.join(',')
)

/** Round one: no services at all — the panel must say so honestly, not pretend to have data. */
const cleanups = []
const applyWith = ctx => {
  const dispose = plugin.apply(ctx)
  if (typeof dispose === 'function') cleanups.push(dispose)
}
applyWith({
  slots: {
    inject(name, callback) {
      injectCalls.push(name)
      callback()
    },
    register(options, component) {
      registered.push({ options, component })
      return () => {}
    }
  },
  effect() {},
  get() {
    return undefined
  }
})

check('two slots registered', injectCalls.join(',') === 'main,sidebar.panellist', injectCalls.join(','))
const panelReg = registered.find(item => item.options.name === 'main')
const entryReg = registered.find(item => item.options.name === 'sidebar.panellist')
check('main claimed with key', panelReg?.options.key === 'vobs-devkit', JSON.stringify(panelReg?.options))
check('sidebar.panellist linked via the same-value id', entryReg?.options.id === 'vobs-devkit', JSON.stringify(entryReg?.options))
check('sidebar label is Vobs Devkit', entryReg?.options.label === 'Vobs Devkit', String(entryReg?.options.label))
check('sidebar label matches the panel label', entryReg?.options.label === panelReg?.options.label, `${entryReg?.options.label} / ${panelReg?.options.label}`)
check('entry icon component registered too', typeof entryReg?.component === 'function')

/* ------------------------------------------------------------ 5. Panel rendering */

section('5. Panel rendering')
const tree = panelReg.component()
const hostElement = dom.window.document.createElement('div')
tree.props.ref.current = hostElement
dom.window.document.body.appendChild(hostElement)

const hostCleanups = []
for (const effect of hostEffects) {
  const cleanup = effect()
  if (typeof cleanup === 'function') hostCleanups.push(cleanup)
}

const shadow = hostElement.shadowRoot
check('host element has a shadow root', !!shadow)
/*
 * The mount container must fill the host — otherwise the parent of a `height: 100%` element is
 * auto-height, the percent height degenerates to auto, and the panel's internal scroll container
 * (`.vk-body { overflow: auto }`) never activates: long pages get clipped by the outer layer,
 * and the symptom is "the Patterns page cannot scroll".
 */
const rootDiv = shadow?.querySelector('.vobs-dsh-root')
check(
  'mount container fills the host (height: 100%)',
  rootDiv?.style.height === '100%' && rootDiv?.style.width === '100%',
  rootDiv?.getAttribute('style') ?? '(no style)'
)
check('.vk-root mounted', !!shadow?.querySelector('.vk-root'))
check('title rendered', (shadow?.textContent ?? '').includes('Vobs Devkit'))
check('tag marks it as rendered by vobs', (shadow?.textContent ?? '').includes('rendered by vobs'))

const tabLabels = () => [...shadow.querySelectorAll('.vk-tab')].map(node => node.textContent.trim())
check('five tabs rendered', shadow.querySelectorAll('.vk-tab').length === 5, tabLabels().join(','))
check('tab names are correct', tabLabels().join(',') === 'Project,Guardrails,API,Patterns,Status', tabLabels().join(','))
check('defaults to the Project page', shadow.querySelector('.vk-tab--active')?.textContent.trim() === 'Project')

/* -------------------------------------------------------------- 6. Project page */

section('6. Project page')
const text = () => shadow.textContent ?? ''
await settle()
check('says so honestly when there are no services (does not pretend to have data)', text().includes('Cannot read'), text().slice(0, 120))

// Attach fake services: one session + a remote that can read workspace files
const report = {
  root: 'C:/demo',
  files: 12,
  skippedTests: 1,
  diagnostics: [
    {
      code: 'VOBS_C210',
      severity: 'error',
      message: 'effect wrote to the signal it depends on "count"',
      fix: 'wrap this write in untrack',
      file: 'src/components/Counter.tsx',
      line: 12,
      column: 5,
      snippet: 'count.value++'
    }
  ]
}
let fileVersion = 1
let readCount = 0
const workspaceFiles = {
  async stat() {
    return { version: fileVersion }
  },
  async readBytes(_sessionId, target) {
    readCount += 1
    if (target !== '.vobs/check.json') throw new Error('lookup-not-found')
    return new TextEncoder().encode(JSON.stringify(report))
  }
}

const secondRegistered = []
applyWith({
  slots: {
    inject(_name, callback) { callback() },
    register(options, component) {
      secondRegistered.push({ options, component })
      return () => {}
    }
  },
  effect() {},
  get(name) {
    if (name === 'sessions') {
      return {
        list: {
          getSnapshot: () => ({
            byId: {
              s1: { sessionId: 's1', title: 'demo', cwd: 'C:/demo', updatedAt: 100 },
              s2: { sessionId: 's2', title: 'Old session', cwd: 'C:/old', updatedAt: 1 }
            }
          })
        }
      }
    }
    if (name === 'remote') return { workspaceFiles }
    return undefined
  }
})
await settle()

check('read the report (really went through remote.workspaceFiles)', readCount > 0, String(readCount))
check("displayed the session's workspace", text().includes('C:/demo'), text().slice(0, 160))
check('issue entry error code rendered', text().includes('VOBS_C210'))
check('issue message rendered', text().includes('effect wrote to the signal it depends on'))
check('file:line:column rendered', text().includes('src/components/Counter.tsx:12:5'))
check('offending line rendered', text().includes('count.value++'))
check('fix suggestion rendered', text().includes('untrack'))
check('summary shows file and error counts', text().includes('12 files') && text().includes('1 errors'))
check('summary shows skipped test files', text().includes('1 test files skipped'))

// Polling: re-read only when the version changed
const before = readCount
fileVersion = 2
const poll = intervals.at(-1)
check('polling timer registered', typeof poll === 'function')
await poll?.()
await settle()
check('a file version change triggers a re-read', readCount > before, `${before} -> ${readCount}`)

const stable = readCount
await poll?.()
await settle()
check('no re-read when the version is unchanged (polling is cheap)', readCount === stable, `${stable} -> ${readCount}`)

/* --------------------------------------------------- 7. Other pages & interactions */

section('7. Other pages & interactions')
const clickTab = async label => {
  const tab = [...shadow.querySelectorAll('.vk-tab')].find(node => node.textContent.includes(label))
  tab.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  await settle(2)
}

await clickTab('Guardrails')
check('guardrails page lists VOBS_C210', text().includes('VOBS_C210'))
check('guardrails page gives the correct pattern', text().includes('untrack'))
check('guardrails page has before/after comparison', shadow.querySelectorAll('.vk-code--bad').length === 2 && shadow.querySelectorAll('.vk-code--good').length === 2)
check('declares "report only, never interrupt"', text().includes('Report only, never interrupt'))

await clickTab('API')
check('API page lists the groups', ['Reactivity', 'DSH plugins', 'Compiler', 'Dev guardrails'].every(group => text().includes(group)))
check("state's signature shown by default", text().includes('state<T>(initialValue: T'))
const target = [...shadow.querySelectorAll('.vk-api__item')].find(node => node.textContent.trim() === 'defineDshPanel')
target.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
await settle(2)
check('detail switches to defineDshPanel after clicking', text().includes('defineDshPanel(options: DshPanelOptions'))
check('detail shows the owning package', text().includes('@vobs/dsh'))

await clickTab('Patterns')
check('patterns page has pattern cards', shadow.querySelectorAll('.vk-pattern').length >= 6, String(shadow.querySelectorAll('.vk-pattern').length))
check('pattern code is a real copy-ready vobs pattern', text().includes("import { state } from '@vobs/vobs'"))

await clickTab('Status')
check('status page honestly marks not-done items', text().includes('Not yet'))
check('status page explains why the panel is static', text().includes('the same page'))

await clickTab('Project')
check('returning to the Project page still shows the freshly read report', text().includes('VOBS_C210'))

/* ----------------------------------------------------------- 8. Sidebar icon */

section('8. Sidebar icon')
const iconEffectsFrom = hostEffects.length
const iconTree = entryReg.component()
const iconElement = dom.window.document.createElement('div')
iconTree.props.ref.current = iconElement
dom.window.document.body.appendChild(iconElement)
for (const effect of hostEffects.slice(iconEffectsFrom)) {
  const cleanup = effect()
  if (typeof cleanup === 'function') hostCleanups.push(cleanup)
}
const iconSvg = iconElement.shadowRoot?.querySelector('svg')
check('sidebar icon renders an svg', !!iconSvg)
check(
  'svg carries width/height (otherwise the icon is empty)',
  iconSvg?.getAttribute('width') !== null && iconSvg?.getAttribute('height') !== null,
  `${iconSvg?.getAttribute('width')} x ${iconSvg?.getAttribute('height')}`
)
check('icon has real dimensions', Number(iconSvg?.getAttribute('width') ?? 0) > 0 && Number(iconSvg?.getAttribute('height') ?? 0) > 0)

/* ------------------------------------------------------------- 9. Cleanup */

section('9. Cleanup')
for (const dispose of cleanups) dispose()
for (const cleanup of hostCleanups) cleanup()
check('shadow root emptied after cleanup', (hostElement.shadowRoot?.childNodes.length ?? -1) === 0)

/* ------------------------------------------------------------- Result */

console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures > 0) {
  console.error(`${failures} checks failed`)
  process.exit(1)
}

/* ------------------------------------------------------- React stub */

function createReactStub(effects) {
  return {
    createElement(type, props) {
      return { type, props: props ?? {} }
    },
    useRef(initial) {
      return { current: initial }
    },
    useEffect(effect) {
      effects.push(effect)
    }
  }
}
