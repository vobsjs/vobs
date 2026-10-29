/**
 * Verifies the real behavior of Vobs Console's **built artifact** under DSH's client module protocol.
 *
 * Coverage:
 *   1. dsh manifest and exports consistency
 *   2. Host side is a valid cordis plugin
 *   3. lib/client.js only registers a factory; executing it has no side effects
 *   4. Materializing the factory yields the plugin; apply() registers both main (keyed) and sidebar.panellist
 *   5. Panel mount: shadow root + full-page vobs rendering
 *   6. Real interactions: tab switching, event stream filtering, pause/drop, incremental tool aggregation
 *   7. Cleanup: shadow root emptied, demo timer stopped
 *
 * Run: node packages/dsh-console/scripts/verify-console.mjs
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

const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
  runScripts: 'outside-only',
  pretendToBeVisual: true,
  url: 'http://127.0.0.1/'
})

// Intercept the demo timer so the verification can advance the timeline deterministically
// instead of waiting for the real 900ms.
const intervals = []
dom.window.setInterval = (fn) => {
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
const pluginEffects = []
const registered = []
const requireStub = id => {
  if (id === 'react') return createReactStub(hostEffects)
  throw new Error(`verify: the artifact require()d a non-platform module ${id}`)
}

const plugin = registry.get(manifest.name)(requireStub)
check('factory directly returns the plugin object', typeof plugin?.apply === 'function')
check('plugin injects slots', Array.isArray(plugin.inject) && plugin.inject.includes('slots'))

plugin.apply({
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
  effect(callback) {
    pluginEffects.push(callback)
  },
  get() {
    return undefined
  }
})

check('two slots registered', injectCalls.join(',') === 'main,sidebar.panellist', injectCalls.join(','))
const panelReg = registered.find(item => item.options.name === 'main')
const entryReg = registered.find(item => item.options.name === 'sidebar.panellist')
check('main claimed with key', panelReg?.options.key === 'vobs-console', JSON.stringify(panelReg?.options))
check('sidebar.panellist linked via the same-value id', entryReg?.options.id === 'vobs-console', JSON.stringify(entryReg?.options))
check('sidebar entry label is Vobs Console', entryReg?.options.label === 'Vobs Console', String(entryReg?.options.label))
check('sidebar entry label matches the panel title', entryReg?.options.label === panelReg?.options.label, `${entryReg?.options.label} / ${panelReg?.options.label}`)
check('entry icon component registered too', typeof entryReg?.component === 'function')
check('demo timer started', intervals.length === 1)

/* ------------------------------------------------------------ 5. Panel rendering */

section('5. Panel rendering')
const tree = panelReg.component()
const hostElement = dom.window.document.createElement('div')
tree.props.ref.current = hostElement
dom.window.document.body.appendChild(hostElement)

// Run the host effect (mounts vobs into the shadow root)
const hostCleanups = []
for (const effect of hostEffects) {
  const cleanup = effect()
  if (typeof cleanup === 'function') hostCleanups.push(cleanup)
}

const shadow = hostElement.shadowRoot
check('host element has a shadow root', !!shadow)
check('.vc panel mounted', !!shadow?.querySelector('.vc'))
check('title rendered', (shadow?.textContent ?? '').includes('Vobs Console'))
check('labeled as demo data when no service was detected', (shadow?.textContent ?? '').includes('Demo data'))

const kpiValue = index => shadow.querySelectorAll('.vc-kpi__value')[index]?.textContent?.trim()
check('running session count comes from the data source', kpiValue(0) === '3', String(kpiValue(0)))
check('awaiting-approval count is correct', kpiValue(1) === '1', String(kpiValue(1)))
check('total session count is correct', kpiValue(2) === '8', String(kpiValue(2)))
check('shows — when there are no tool events', kpiValue(3) === '—', String(kpiValue(3)))
check('session list rendered 8 rows', shadow.querySelectorAll('.vc-session').length === 8, String(shadow.querySelectorAll('.vc-session').length))

/* ------------------------------------------------------ 6. Event stream & interactions */

section('6. Event stream ingestion & interactions')
const advance = steps => {
  for (let index = 0; index < steps; index += 1) intervals[0]?.()
}

advance(60)
await tick()

const tabByText = label => [...shadow.querySelectorAll('.vc-tab')].find(tab => tab.textContent.trim().startsWith(label))
check("overview's recent events have content", shadow.querySelectorAll('.vc-ev').length > 0, String(shadow.querySelectorAll('.vc-ev').length))
check('top-5 tools rendered 5 rows', shadow.querySelectorAll('.vc-bar').length === 5, String(shadow.querySelectorAll('.vc-bar').length))
check('tool-call KPI grew', Number(kpiValue(3)) > 0, String(kpiValue(3)))

// Switch to the event stream
tabByText('Event Stream').click()
await tick()
check('toolbar appears after switching to the event stream', !!shadow.querySelector('.vc-toolbar'))
const streamRows = () => shadow.querySelectorAll('.vc-card .vc-ev').length
const before = streamRows()
check('event stream row count > 0', before > 0, String(before))
check('stream count badge exists', /Event Stream\s*\d+/u.test(shadow.textContent ?? ''))

// Filter
const input = shadow.querySelector('.vc-input')
input.value = 'pwsh'
input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
await tick()
const filtered = streamRows()
check('filtering reduces rows but keeps content', filtered > 0 && filtered < before, `${filtered} / ${before}`)
const filteredTexts = [...shadow.querySelectorAll('.vc-card .vc-ev')].map(row => row.textContent.toLowerCase())
check('all filtered rows contain the keyword', filteredTexts.length > 0 && filteredTexts.every(text => text.includes('pwsh')))

input.value = ''
input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
await tick()
check('row count restored after clearing the filter', streamRows() === before, `${streamRows()} / ${before}`)

// Pause: ticks during pause are no longer ingested
const pauseButton = [...shadow.querySelectorAll('.vc-btn')].find(button => button.textContent.includes('Pause'))
pauseButton.click()
await tick()
const frozen = streamRows()
advance(40)
await tick()
check('no new rows while paused', streamRows() === frozen, `${streamRows()} / ${frozen}`)
check('UI reports the number of dropped events', /Paused · dropped\s*[1-9]\d*/u.test(shadow.textContent ?? ''), shadow.textContent?.match(/Paused · dropped \d+/u)?.[0] ?? '')

const resumeButton = [...shadow.querySelectorAll('.vc-btn')].find(button => button.textContent.includes('Resume'))
resumeButton.click()
await tick()
advance(1)
await tick()
check('ingestion resumes after resuming', streamRows() > frozen, `${streamRows()} / ${frozen}`)

// Tool analysis
tabByText('Tool Analysis').click()
await tick()
const rows = shadow.querySelectorAll('.vc-table tbody tr').length
check('tool table has rows', rows > 0, String(rows))
check('tool table shows pwsh', (shadow.textContent ?? '').includes('pwsh'))
check('P95 KPI computed', (shadow.querySelectorAll('.vc-kpi__value')[3]?.textContent ?? '').trim().length > 0)
check('trend line rendered as path', shadow.querySelectorAll('.vc-spark path').length === rows, `${shadow.querySelectorAll('.vc-spark path').length} / ${rows}`)

// Artifacts
tabByText('Artifacts').click()
await tick()
check('artifacts tab renders', !!shadow.querySelector('.vc-card'))

// Back to overview
tabByText('Overview').click()
await tick()
check('can switch back to overview', shadow.querySelectorAll('.vc-kpi__value').length === 4)

/* ------------------------------------------------ 8. Switch to DSH's real data source */

section('8. Switch to DSH real data source')
let listSnapshot = {
  ids: ['real-a', 'real-b'],
  byId: {
    'real-a': { sessionId: 'real-a', title: 'Real Session A', running: true, updatedAt: 9_000 },
    'real-b': { sessionId: 'real-b', title: 'Real Session B', running: false, updatedAt: 8_000 }
  }
}
let statusMap = new Map()
const listListeners = new Set()
const statusListeners = new Set()

const livePluginEffects = []
plugin.apply({
  slots: {
    inject(name, callback) {
      callback()
    },
    register() {
      return () => {}
    }
  },
  effect(callback) {
    livePluginEffects.push(callback)
  },
  get(name) {
    if (name === 'sessions') {
      return {
        list: {
          getSnapshot: () => listSnapshot,
          subscribe: listener => {
            listListeners.add(listener)
            return () => listListeners.delete(listener)
          }
        }
      }
    }
    if (name === 'uiSession') {
      return {
        sessionStatus: {
          getSnapshot: () => statusMap,
          subscribe: listener => {
            statusListeners.add(listener)
            return () => statusListeners.delete(listener)
          }
        }
      }
    }
    return undefined
  }
})
await tick()

check('plugin subscribed to the session catalog', listListeners.size === 1 && statusListeners.size === 1, `${listListeners.size}/${statusListeners.size}`)
check('badge switched to DSH live data', (shadow.textContent ?? '').includes('DSH live data'))
check('demo sessions were replaced by the real list', (shadow.textContent ?? '').includes('Real Session A') && !(shadow.textContent ?? '').includes('KitSidebar menu pinning'))
check('session row count comes from the real list', shadow.querySelectorAll('.vc-session').length === 2, String(shadow.querySelectorAll('.vc-session').length))
check('running session count comes from real state', kpiValue(0) === '1', String(kpiValue(0)))
check('demo events were cleared', (shadow.textContent ?? '').includes('Tool calls') && kpiValue(3) === '—', String(kpiValue(3)))

// Real state changes → event stream
tabByText('Event Stream').click()
await tick()
const liveBefore = streamRows()

statusMap = new Map([['real-b', { running: true }]])
for (const listener of statusListeners) listener()
await tick()

check('real state changes produce events', streamRows() > liveBefore, `${streamRows()} / ${liveBefore}`)
check('event kind is turn/start', [...shadow.querySelectorAll('.vc-ev__kind')].some(node => node.textContent.includes('turn/start')))

// Clean up the real source
for (const effect of livePluginEffects) {
  const disposer = effect()
  if (typeof disposer === 'function') disposer()
}
check('real source unsubscribed after cleanup', listListeners.size === 0 && statusListeners.size === 0, `${listListeners.size}/${statusListeners.size}`)

/* ------------------------------------------------------------- 9. Cleanup */

section('9. Cleanup')
for (const effect of pluginEffects) {
  const disposer = effect()
  if (typeof disposer === 'function') disposer()
}
for (const cleanup of hostCleanups) cleanup()
check('shadow root emptied after cleanup', (hostElement.shadowRoot?.childNodes.length ?? -1) === 0)

console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures > 0) {
  console.error(`${failures} checks failed`)
  process.exitCode = 1
}

/** Tiny React stub: the host component only uses createElement / useRef / useEffect. */
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
