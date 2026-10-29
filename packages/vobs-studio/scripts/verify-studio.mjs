/**
 * Verifies the real behavior of the **built artifact** (not the source) under DSH's client
 * module system — the same acceptance style as dsh-plugin's verify-client.mjs.
 *
 * Coverage:
 *   1. package.json dsh manifest (patch / platform / exports targets exist)
 *   2. cordis.patch.yml inserts this package and does not override official lines
 *   3. lib/index.js is a valid Host-side cordis plugin
 *   4. lib/client.js registers exactly one factory; executing it has no side effects
 *   5. apply() registers into `main` (keyed) + `sidebar.panellist`
 *   6. With fake sessions + remote.workspaceFiles services, the preview manifest flows
 *      through: the panel reaches `ready`, the page list renders, the iframe points at
 *      the static server, and page switching updates the iframe
 *   7. After effect cleanup the shadow root is emptied
 *   8. Real-Host missing-file semantics (stat/read THROW for an absent file — the wire
 *      schema has no "absent" shape): the panel shows the setup card, never a JSON
 *      error; a genuinely broken manifest still surfaces as an actionable error
 *
 * Run: node scripts/verify-studio.mjs
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
const until = async (predicate, tries = 50) => {
  for (let i = 0; i < tries; i += 1) {
    if (predicate()) return true
    await tick()
  }
  return predicate()
}

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

const patchPath = resolveFromPackage(dsh.bundle.patch)
check('patch file exists', await fileExists(patchPath))
const patchText = await readFile(patchPath, 'utf8')
check('patch inserts this package', patchText.includes('insert:') && patchText.includes(manifest.name))
check('patch does not override top-level ids (only appends its own line)', !/^-\s*id:/mu.test(patchText))

const hostPath = resolveFromPackage(manifest.exports['.'])
const clientPath = resolveFromPackage(manifest.exports['./client'])
check('exports["."] target exists', await fileExists(hostPath))
check('exports["./client"] target exists', await fileExists(clientPath))
check(
  'no install-time lifecycle hooks (DSH does not build)',
  manifest.scripts?.prepare === undefined && manifest.scripts?.postinstall === undefined
)
check(
  'no workspace: protocol dependencies',
  !JSON.stringify(manifest.devDependencies ?? {}).includes('workspace:')
)

/* ------------------------------------------------------- 2. Host-side plugin loads */

section('2. Host side')
const host = await import(pathToFileURL(hostPath).href)
check('exports a non-empty name', typeof host.name === 'string' && host.name.length > 0, String(host.name))
check('exports an apply function', typeof host.apply === 'function')
host.apply({})

/* ----------------------------------------------- 3. Client-side bundle & runtime */

section('3. Client side: factory registration')
const bundleCode = await readFile(clientPath, 'utf8')
check(
  'calls __ModuleLoader__.load exactly once',
  (bundleCode.match(/__ModuleLoader__\.load\(/gu) ?? []).length === 1
)
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

dom.window.eval(bundleCode)

check('factory registered', registry.has(manifest.name), [...registry.keys()].join(','))
check(
  'executing the bundle only registers a factory, no module side effects',
  loadCalls === 1 && dom.window.document.body.childNodes.length === 0
)

/* --------------------------------------------- 4. apply() with fake DSH services */

section('4. apply(): slot registration with fake services')

const MANIFEST_JSON = JSON.stringify({
  version: 1,
  server: { origin: 'http://127.0.0.1:5218' },
  project: { name: 'demo-app', dir: 'demo-app' },
  pages: [
    { id: 'dashboard', title: 'Dashboard', route: '/', file: 'demo-app/dist/dashboard.html' },
    { id: 'settings', title: 'Settings', route: '/settings', file: 'demo-app/dist/settings.html' }
  ]
})

const fakeServices = {
  sessions: {
    list: {
      getSnapshot: () => ({
        byId: {
          s1: { sessionId: 's1', title: 'demo session', blank: false, updatedAt: 9, cwd: 'C:/work/demo' }
        }
      })
    }
  },
  remote: {
    workspaceFiles: {
      stat: async (sessionId, filePath) => (filePath === '.vobs/studio/preview.json' ? { version: 1, bytes: MANIFEST_JSON.length } : undefined),
      read: async (sessionId, filePath, range) => (filePath === '.vobs/studio/preview.json' ? { text: MANIFEST_JSON, eof: true } : undefined)
    }
  }
}

const mainRegistrations = []
const railRegistrations = []
const toolviewRegistrations = []
const reactEffects = []

const slotsStub = {
  inject(name, callback) {
    return callback()
  },
  register(options, component) {
    if (options.name === 'main') mainRegistrations.push({ options, component })
    else if (options.name === 'sidebar.panellist') railRegistrations.push({ options, component })
    else if (options.name === 'tool.call.toolview') toolviewRegistrations.push({ options, component })
    return () => {}
  }
}

const requireStub = id => {
  if (id === 'react') return createReactStub(reactEffects)
  const service = fakeServices[id]
  if (service !== undefined) return service
  throw new Error(`verify: the artifact require()d a non-platform module ${id}`)
}

const plugin = registry.get(manifest.name)(requireStub)
check('factory returns the plugin object', typeof plugin === 'object' && plugin !== null && typeof plugin.apply === 'function')

// cordis's effect hooks the plugin teardown (which clears the polling interval) — without
// running it the process never exits.
const disposers = []
const declaredInject = new Set(['slots', ...(plugin.inject ?? [])])
// Real DSH only hands DECLARED services to ctx.get — a source that reads an undeclared
// service silently gets undefined (real-install regression this assertion guards against).
plugin.apply({
  slots: slotsStub,
  get(name) {
    if (!declaredInject.has(name)) throw new Error(`service "${name}" used but not declared in inject/injectServices`)
    return fakeServices[name]
  },
  effect(callback) {
    const dispose = callback()
    if (typeof dispose === 'function') disposers.push(dispose)
  }
})

check('registered into main', mainRegistrations.length === 1, `main=${mainRegistrations.length}`)
check(
  'main registration is keyed to vobs-studio',
  mainRegistrations[0]?.options?.name === 'main' && mainRegistrations[0]?.options?.key === 'vobs-studio',
  JSON.stringify(mainRegistrations[0]?.options)
)
check('registered into sidebar.panellist', railRegistrations.length === 1, `rail=${railRegistrations.length}`)
check(
  'sidebar entry id links to the panel key',
  railRegistrations[0]?.options?.id === 'vobs-studio',
  JSON.stringify(railRegistrations[0]?.options)
)

section('4b. toolview rows for the Studio MCP tools')
check(
  'four tool.call.toolview registrations (one per MCP tool)',
  toolviewRegistrations.length === 4,
  `toolview=${toolviewRegistrations.length}`
)
check(
  'toolview keys match the MCP tool names',
  ['design_contract', 'design_scaffold', 'design_check', 'design_preview_build'].every(tool =>
    toolviewRegistrations.some(r => r.options.key === tool)
  ),
  toolviewRegistrations.map(r => r.options.key).join(',')
)

/* --------------------------------------------- 5. Mount + manifest flows through */

section('5. Mount: manifest drives the panel to ready')

const tree = mainRegistrations[0].component()
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
check('panel rendered', !!shadow?.querySelector('.studio'))

const ready = await until(() => shadow.querySelectorAll('.studio__page').length === 2)
check('panel reached ready: both pages listed', ready, `pages=${shadow.querySelectorAll('.studio__page').length}`)

const pageButtons = () => [...shadow.querySelectorAll('.studio__page')]
check('page titles render', pageButtons().map(b => b.textContent).join('|').includes('Dashboard') && pageButtons().map(b => b.textContent).join('|').includes('Settings'))

const frame = shadow.querySelector('.studio__frame')
check('iframe points at the static server (first page selected automatically)', frame?.getAttribute('src') === 'http://127.0.0.1:5218/demo-app/dist/dashboard.html', String(frame?.getAttribute('src')))

section('6. Page switching')
pageButtons()[1].click()
await tick()
check('clicking the second page switches the iframe', shadow.querySelector('.studio__frame')?.getAttribute('src') === 'http://127.0.0.1:5218/demo-app/dist/settings.html', String(shadow.querySelector('.studio__frame')?.getAttribute('src')))
check(
  'active page is visually marked',
  pageButtons()[1].getAttribute('data-active') === 'true' && pageButtons()[0].getAttribute('data-active') !== 'true'
)

section('7. Cleanup')
for (const cleanup of cleanups) cleanup()
for (const dispose of disposers) dispose()
check('shadow root emptied after cleanup', (hostElement.shadowRoot?.childNodes.length ?? -1) === 0)

/* ------------------------------- 8. Real-Host missing-file semantics (recon'ed contract) */

// The asar's dsh-api-workspace-files typert shows every result schema is a plain object
// with no "absent" shape, so the Host THROWS for a missing file (observed live as
// "Unexpected end of JSON input"). The panel must answer that with the setup card.
// NOTE: section 7's cleanup already tore the data source down, so every case below
// re-applies the plugin (a fresh apply resets the module state and starts a new source).
section('8. Missing / broken manifest → guidance, not a JSON error')

const applyAndMount = () => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  for (const dispose of disposers.splice(0)) dispose()
  mainRegistrations.length = 0
  railRegistrations.length = 0
  const effectMark = reactEffects.length
  plugin.apply({
    slots: slotsStub,
    get(name) {
      if (!declaredInject.has(name)) throw new Error(`service "${name}" used but not declared in inject/injectServices`)
      return fakeServices[name]
    },
    effect(callback) {
      const dispose = callback()
      if (typeof dispose === 'function') disposers.push(dispose)
    }
  })
  const mounted = mainRegistrations[0].component()
  const element = dom.window.document.createElement('div')
  mounted.props.ref.current = element
  dom.window.document.body.appendChild(element)
  for (const effect of reactEffects.slice(effectMark)) {
    const cleanup = effect()
    if (typeof cleanup === 'function') cleanups.push(cleanup)
  }
  return element.shadowRoot
}

// 8a. stat reports a concrete empty file (bytes: 0) — decisive missing.
fakeServices.remote.workspaceFiles.stat = async () => ({ version: 9, bytes: 0 })
fakeServices.remote.workspaceFiles.read = async () => ({ text: MANIFEST_JSON, eof: true })
const shadowEmpty = applyAndMount()
const gone = await until(() => shadowEmpty?.querySelector('.studio__steps') !== null)
check('empty manifest (bytes 0) shows the setup card', gone)
check('no error notice in the empty state', shadowEmpty?.querySelector('.studio__error') === null)

// 8b. Services that throw like the real Host does for an absent file.
const realHostMissing = async () => {
  throw new Error('Unexpected end of JSON input')
}
fakeServices.remote.workspaceFiles.stat = realHostMissing
fakeServices.remote.workspaceFiles.read = realHostMissing
const shadow2 = applyAndMount()
const guided = await until(() => shadow2?.querySelector('.studio__steps') !== null)
check('host-style thrown "missing" shows the setup card', guided)
check('thrown missing state shows no error notice', shadow2?.querySelector('.studio__error') === null)

// 8c. A present but broken manifest is a real error, with an actionable message.
fakeServices.remote.workspaceFiles.stat = async () => ({ version: 2, bytes: 5 })
fakeServices.remote.workspaceFiles.read = async () => ({ text: '{"pag', eof: true })
shadow2.querySelector('.studio__btn')?.click()
const failed = await until(() => shadow2?.querySelector('.studio__error') !== null)
const errorText = shadow2?.querySelector('.studio__error')?.textContent ?? ''
check('broken manifest JSON surfaces as an error', failed, errorText)
check('error message names the file and the fix', errorText.includes('not valid JSON') && errorText.includes('Rebuild'), errorText)

section('9. Final cleanup')
for (const cleanup of cleanups.splice(0)) cleanup()
for (const dispose of disposers.splice(0)) dispose()
check('second mount emptied after cleanup', (shadow2?.childNodes.length ?? -1) === 0)

/* ------------------------------------------------------------------- Result */

console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures > 0) {
  console.error(`${failures} checks failed`)
  process.exitCode = 1
}

/**
 * Tiny React stub: the adapter's host component only uses createElement / useRef / useEffect.
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
