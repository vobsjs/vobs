/**
 * Verifies the real behavior of the **built artifact** (not the source) under DSH's client
 * module system.
 *
 * Coverage:
 *   1. package.json's dsh manifest (bundle.patch / client.platform / exports targets all exist)
 *   2. cordis.patch.yml inserts the line pointing at this package and does not override official lines
 *   3. lib/index.js is a valid Host-side cordis plugin
 *   4. lib/client.js only registers a factory; executing the bundle itself has no side effects
 *   5. Materializing the factory yields the plugin object; apply() registers the component into the shell.overlay slot
 *   6. After the React host mounts: the shadow root contains the vobs-rendered panel
 *   7. vobs reactivity: the component body runs once, signal-driven updates, insertList row add/remove
 *   8. After effect cleanup the shadow root is emptied
 *
 * Run: node scripts/verify-client.mjs (or pnpm --filter dsh-plugin verify)
 */
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { JSDOM } from 'jsdom'

const here = path.dirname(fileURLToPath(import.meta.url))
const pluginDir = path.resolve(here, '..')

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

const fileExists = async target => {
  try {
    await stat(target)
    return true
  } catch {
    return false
  }
}

const resolveFromPackage = relative => path.join(pluginDir, String(relative).replace(/^\.\//u, ''))

/* ------------------------------------------------- 1. Manifest & patch consistency */

section('1. dsh manifest')
const manifest = JSON.parse(await readFile(path.join(pluginDir, 'package.json'), 'utf8'))
const dsh = manifest.dsh ?? {}

check('package name is valid', /^[a-z0-9][a-z0-9._~-]*$/u.test(manifest.name), manifest.name)
check('dsh.bundle.patch is declared', typeof dsh.bundle?.patch === 'string', JSON.stringify(dsh.bundle))
check('dsh.client.platform is web', dsh.client?.platform === 'web', String(dsh.client?.platform))
check(
  'dsh.client uses only official fields',
  Object.keys(dsh.client ?? {}).every(key => ['platform', 'inject', 'external', 'immediately'].includes(key)),
  Object.keys(dsh.client ?? {}).join(',')
)

const patchPath = resolveFromPackage(dsh.bundle.patch)
check('patch file exists', await fileExists(patchPath), path.relative(pluginDir, patchPath))

const patchText = await readFile(patchPath, 'utf8')
check('patch inserts this package', patchText.includes('insert:') && patchText.includes(manifest.name))
check('patch does not override top-level ids (only appends its own line)', !/^-\s*id:/mu.test(patchText))

const hostPath = resolveFromPackage(manifest.exports['.'])
const clientPath = resolveFromPackage(manifest.exports['./client'])
check('exports["."] target exists', await fileExists(hostPath), path.relative(pluginDir, hostPath))
check('exports["./client"] target exists', await fileExists(clientPath), path.relative(pluginDir, clientPath))
check(
  'no install-time lifecycle hooks (DSH does not build)',
  manifest.scripts?.prepare === undefined && manifest.scripts?.postinstall === undefined
)
check(
  'no workspace: protocol dependencies (GitHub path: direct install must be self-contained)',
  !JSON.stringify({
    dependencies: manifest.dependencies,
    peerDependencies: manifest.peerDependencies,
    devDependencies: manifest.devDependencies
  }).includes('workspace:')
)

/* ------------------------------------------------------- 2. Host-side plugin loads */

section('2. Host side')
const host = await import(pathToFileURL(hostPath).href)
check('exports a non-empty name', typeof host.name === 'string' && host.name.length > 0, String(host.name))
check('exports an apply function', typeof host.apply === 'function')
check('inject is an array', Array.isArray(host.inject))
host.apply({})

/* ----------------------------------------------- 3. Client-side bundle & runtime */

section('3. Client side: factory registration')
const bundleCode = await readFile(clientPath, 'utf8')
check(
  'calls __ModuleLoader__.load exactly once',
  (bundleCode.match(/__ModuleLoader__\.load\(/gu) ?? []).length === 1
)
check('react stays external', bundleCode.includes('require("react")') && !bundleCode.includes('react-dom'))
const requires = bundleCode.match(/require\((['"])[^'"]+\1\)/gu) ?? []
check('synchronous require only targets platform modules', requires.length > 0 && requires.every(call => call.includes('react')), requires.join(','))
check('no dynamic import (DSH only supports self-contained chunks)', !bundleCode.includes('import('))

const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
  runScripts: 'outside-only',
  pretendToBeVisual: true,
  url: 'http://127.0.0.1/'
})

const registry = new Map()
let loadCalls = 0
dom.window.__ModuleLoader__ = {
  load(entry) {
    loadCalls += 1
    registry.set(entry.id, entry.factory)
  }
}

// Execute the bundle directly in the jsdom realm: window / document / getComputedStyle are native.
dom.window.eval(bundleCode)

check('factory registered', registry.has(manifest.name), [...registry.keys()].join(','))
check(
  'executing the bundle only registers a factory, no module side effects',
  loadCalls === 1 && dom.window.document.body.childNodes.length === 0,
  `loadCalls=${loadCalls} body=${dom.window.document.body.childNodes.length}`
)

section('4. Client side: materialization & slot registration')
const injectCalls = []
const reactEffects = []
let slotRegistration = null
const requireStub = id => {
  if (id === 'react') return createReactStub(reactEffects)
  throw new Error(`verify: the artifact require()d a non-platform module ${id}`)
}

const plugin = registry.get(manifest.name)(requireStub)
check('factory directly returns the plugin object', typeof plugin === 'object' && plugin !== null && typeof plugin.apply === 'function')
check('plugin injects slots', Array.isArray(plugin.inject) && plugin.inject.includes('slots'))

plugin.apply({
  slots: {
    inject(name, callback) {
      injectCalls.push(name)
      return callback()
    },
    register(options, component) {
      slotRegistration = { options, component }
      return () => {}
    }
  }
})

check('registered into shell.overlay', injectCalls[0] === 'shell.overlay', injectCalls.join(','))
check(
  'slot options are correct',
  slotRegistration?.options?.name === 'shell.overlay' && slotRegistration?.options?.id === 'vobs-panel',
  JSON.stringify(slotRegistration?.options)
)
check('registered value is a component', typeof slotRegistration?.component === 'function')

section('5. React host + vobs rendering')
const tree = slotRegistration.component()
const hostElement = dom.window.document.createElement('div')
tree.props.ref.current = hostElement
dom.window.document.body.appendChild(hostElement)

const cleanups = []
for (const effect of reactEffects) {
  const cleanup = effect()
  if (typeof cleanup === 'function') cleanups.push(cleanup)
}

const shadow = hostElement.shadowRoot
check('host element has a shadow root', !!shadow)
check('shadow root contains <style> and the panel root', !!shadow?.querySelector('style') && !!shadow?.querySelector('.vobs-dsh-root'))
check('.vobs-panel rendered', !!shadow?.querySelector('.vobs-panel'))

const text = shadow?.textContent ?? ''
// The version is injected by build-time define and changes every release — assert against the
// value embedded in the artifact itself rather than hardcoding a version in the script
// (hardcoding turns version bumps into false failures).
const embeddedVersion = /VOBS_VERSION\s*=\s*`v\$\{("([^"]+)")\}`/u.exec(bundleCode)?.[2]
check('artifact embeds the build-time injected version', typeof embeddedVersion === 'string' && /^\d+\.\d+\.\d+/u.test(embeddedVersion), String(embeddedVersion))
check('the UI renders that version', embeddedVersion !== undefined && text.includes(`v${embeddedVersion}`), text.slice(0, 140))

// The artifact is checked into the repo, so "edited the source / bumped the version but forgot
// to rebuild" never surfaces anywhere else — installing still picks up the last built bundle.
// Aligning the embedded version with the framework's current version lets CI catch that slip.
const frameworkVersion = JSON.parse(
  await readFile(path.resolve(pluginDir, '..', 'vobs', 'package.json'), 'utf8')
).version
check(
  'embedded artifact version matches the framework version',
  embeddedVersion === frameworkVersion,
  `artifact embeds ${embeddedVersion} / framework ${frameworkVersion} — rebuild this plugin's artifact`
)

check('tagline rendered', text.includes('Signals First'))

const statValue = index => shadow.querySelectorAll('.vobs-stat__value')[index]?.textContent?.trim()
const byText = (selector, label) =>
  [...shadow.querySelectorAll(selector)].find(node => node.textContent.trim() === label)

check('component body executions = 1 (run-once)', statValue(0) === '1', String(statValue(0)))
check('initial count = 0', statValue(2) === '0', String(statValue(2)))
check('initial memo derived value = 0', statValue(3) === '0', String(statValue(3)))

section('6. Reactivity: signal updates do not re-run the component body')
shadow.querySelector('.vobs-btn--primary').click()
shadow.querySelector('.vobs-btn--primary').click()
await tick()

check('count accumulates to 2', statValue(2) === '2', String(statValue(2)))
check('memo ×2 follows to 4', statValue(3) === '4', String(statValue(3)))
check(
  'two writes in the same tick are coalesced; the effect re-runs only once (dirty-value dedup + microtask batch flush)',
  statValue(1) === '2',
  `effect ran ${statValue(1)} times`
)
check('component body executions still 1', statValue(0) === '1', String(statValue(0)))

byText('.vobs-btn', '−1').click()
await tick()
check('−1 took effect, count back to 1', statValue(2) === '1', String(statValue(2)))
check('memo back to 2', statValue(3) === '2', String(statValue(3)))
check('a write in a new tick independently triggers one effect run', statValue(1) === '3', String(statValue(1)))

section('7. insertList: tag list add/remove')
const input = shadow.querySelector('.vobs-input')
input.value = 'dsh'
input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
await tick()
byText('.vobs-btn', 'Add').click()
await tick()

const chipTexts = () => [...shadow.querySelectorAll('.vobs-chip')].map(chip => chip.firstChild.textContent.trim())
check('new tag enters the list', chipTexts().includes('dsh'), chipTexts().join('|'))
check('original two entries remain', chipTexts().includes('signals') && chipTexts().includes('run-once'), chipTexts().join('|'))
check('input was cleared', input.value === '', input.value)
check('component body executions still 1', statValue(0) === '1', String(statValue(0)))

const dshChip = [...shadow.querySelectorAll('.vobs-chip')].find(chip => chip.textContent.includes('dsh'))
dshChip.querySelector('.vobs-chip__remove').click()
await tick()
check('tag removal works', !chipTexts().includes('dsh'), chipTexts().join('|'))

for (const chip of [...shadow.querySelectorAll('.vobs-chip')]) {
  chip.querySelector('.vobs-chip__remove').click()
  await tick()
}
check('empty state branch after clearing', !!shadow.querySelector('.vobs-empty'), shadow.querySelector('.vobs-chips')?.innerHTML ?? '')

section('8. Interactions & cleanup')
byText('.vobs-btn--icon', '–').click()
await tick()
check('body disappears after collapsing', !shadow.querySelector('.vobs-panel__body'))

byText('.vobs-btn--icon', '+').click()
await tick()
check('body returns after expanding', !!shadow.querySelector('.vobs-panel__body'))

shadow.querySelector('[title="Collapse to badge"]').click()
await tick()
check('only the badge remains after hiding', !shadow.querySelector('.vobs-panel') && !!shadow.querySelector('.vobs-badge'))

shadow.querySelector('.vobs-badge').click()
await tick()
check('clicking the badge restores the panel', !!shadow.querySelector('.vobs-panel'))
check('component body still not re-run after the whole interaction', statValue(0) === '1', String(statValue(0)))

for (const cleanup of cleanups) cleanup()
check('shadow root emptied after cleanup', (hostElement.shadowRoot?.childNodes.length ?? -1) === 0)

/* ------------------------------------------------------------------- Result */

console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures > 0) {
  console.error(`${failures} checks failed`)
  process.exitCode = 1
}

/**
 * Tiny React stub: this plugin's host component only uses createElement / useRef / useEffect.
 * The verify script manually runs effects in React's commit order (after ref assignment).
 */
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
