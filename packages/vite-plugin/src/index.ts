// Vite plugin: integrates the Vobs compiler

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { Plugin, ViteDevServer } from 'vite'
import { analyzeSource, compileWithSourceMap, createI18nExtractor, describeDiagnostics, type CompileOptions, type VobsSourceMap } from '@vobs/compiler'
import { VobsError, formatVobsError, type VobsErrorLocation, type VobsErrorOptions } from '@vobs/runtime/error'
import { compileHtmlComponent } from './html-component.ts'

/** Virtual module id (the `\0` prefix is a rollup convention to keep it from being resolved as a real file). */
const GUARDRAILS_ID = '\0virtual:vobs-dev-guardrails'
/** URL form inside the browser: vite encodes `\0` as `__x00__`. */
const GUARDRAILS_URL = '/@id/__x00__virtual:vobs-dev-guardrails'
/** Agent snapshot probe virtual module (same shape as guardrails). */
const AGENT_STATE_ID = '\0virtual:vobs-agent-state-probe'
const AGENT_STATE_URL = '/@id/__x00__virtual:vobs-agent-state-probe'
/** Guardrail violation reporting endpoint. */
const VIOLATION_ENDPOINT = '/__vobs/violation'
/** Agent self-verification channel endpoint: the browser posts runtime snapshots; Agent / CLI query (GET, `?live=1` for "right now"). */
const AGENT_STATE_ENDPOINT = '/__vobs/agent-state'
/** Request sequence number for live queries (vite WS broadcast → browser responds matched by id). */
let liveQuerySeq = 0

/**
 * Windows path separators → POSIX.
 *
 * This is not a style preference but an **interface contract**: Vite/Rollup module ids
 * always use forward slashes, so whatever shape `resolveId` returns is the
 * **normalized** shape `load` subsequently receives — return the raw string of
 * `path.resolve(...)` (backslashes on Windows) and `load`'s forward-slash id lookup in
 * `htmlModules.has(id)` never hits; bare HTML then falls through to
 * `vite:import-analysis`, gets parsed as JS and throws
 * `Failed to parse source for import analysis`, breaking the entire HTML component
 * feature on Windows.
 *
 * Only backslashes are replaced with slashes — no `resolve`/`realpath`-style
 * normalization, to avoid changing case or resolving symlinks (which would desync
 * `htmlModules` from the actual `readFile` target).
 */
function toPosixPath(value: string): string {
  return value.replace(/\\/gu, '/')
}

export interface VobsVitePluginOptions {
  include?: RegExp
  compiler?: CompileOptions
  hmr?: boolean
  /**
   * Module-level state HMR freshness (on by default, dev only). When on:
   * - module-top-level state() declarations compile to hmrStateRef(...); hot updates
   *   re-execute the module but reuse the existing signals, eliminating the "two module
   *   instances, two copies of state" problem that caused edits not applying / half the
   *   page going dead;
   * - .ts files declaring module-level state (store-like modules) are also included in
   *   HMR handling.
   */
  hmrState?: boolean
  extractI18n?: (key: string, filename: string) => void
  html?: boolean | { readonly extensions?: readonly string[] }
  /**
   * Development guardrails (on by default, dev only). When on, the page automatically
   * gets `installDevGuardrails()` from `@vobs/vobs/dev`, and violations are sent back to
   * the dev server and printed in the terminal — so an AI reading the terminal sees an
   * explicit error for silent failures like "effect self-subscription".
   *
   * Skipped automatically when the page does not have `@vobs/vobs` installed; leaves a
   * single console hint.
   */
  devGuardrails?: boolean
  /**
   * Agent runtime snapshot channel (on by default, dev only). When on, the page-side
   * probe subscribes to the `window.__VOBS_DEVTOOLS__` event stream and POSTs a runtime
   * snapshot (throttled to 100ms) to `GET /__vobs__/agent-state` — after generating code,
   * an Agent needs no human to trigger anything; one curl returns "each effect's current
   * subscription set / most recent update trigger chain / guardrail verdicts".
   *
   * The channel reuses devGuardrails' existing pattern (virtual module probe + POST
   * middleware), opening no new WebSocket and requiring no long-lived Agent connection.
   * Decoupled from the devtools core: the probe only consumes the global API
   * (`window.__VOBS_DEVTOOLS__`), and devtools knows nothing about this channel.
   */
  agentState?: boolean
}

export function vobsPlugin(options: VobsVitePluginOptions = {}): Plugin {
  const include = options.include ?? /\.tsx(?:$|\?)/
  const htmlModules = new Set<string>()
  const guardrailsEnabled = options.devGuardrails ?? true
  const agentStateEnabled = options.agentState ?? true
  let productionBuild = false
  let hmrStateEnabled = (options.hmr ?? true) && (options.hmrState ?? true)
  /** Project root (taken in `configResolved`) — used to normalize absolute module ids to repo-relative paths. */
  let projectRoot = ''

  /** Install guardrails only in dev and when not disabled. */
  const guardrailsActive = (): boolean => !productionBuild && guardrailsEnabled
  /** Install the Agent snapshot probe only in dev and when not disabled. */
  const agentStateActive = (): boolean => !productionBuild && agentStateEnabled

  /**
   * The **stable** source name passed to the compiler: project-relative + POSIX separators.
   *
   * ## Why the absolute `id` cannot be used directly
   *
   * The compiler writes the source name into the output's debug metadata
   * (`resolveComponent(Comp, "<source name>", "Comp")`). Absolute paths cause two problems:
   *
   * 1. **Build output is not reproducible**: Windows yields `C:/Users/…`, Linux yields
   *    `/home/runner/…` — the same source produces different bytes per platform. The
   *    repo's CI validates "output in sync with source" via
   *    `pnpm run build:dsh && git diff --exit-code`, so **artifacts built on Windows can
   *    never pass validation on Linux** (measured ~100 bytes of difference).
   * 2. **Leaks developer machine paths**: these paths ship with the package and mean
   *    nothing to consumers.
   *
   * Normalized to a relative POSIX path, the build result is platform-independent while
   * error locations remain usable (relative to project root).
   *
   * Note: only affects debug metadata and the sourcemap's `sources`; no runtime behavior changes.
   */
  const stableSourceName = (id: string): string => {
    const clean = id.split(/[?#]/u, 1)[0]
    if (projectRoot === '' || !clean.startsWith(projectRoot)) return toPosixPath(clean)
    const relative = path.relative(projectRoot, clean)
    // A leading `..` means it actually lives outside the project root (e.g. above in the
    // monorepo) — a relative path is meaningless there, keep the original name
    return relative.startsWith('..') ? toPosixPath(clean) : toPosixPath(relative)
  }

  return {
    name: 'vobs',

    enforce: 'pre',

    configResolved(config) {
      productionBuild = config.command === 'build'
      hmrStateEnabled = (options.hmr ?? true) && !productionBuild && (options.hmrState ?? true)
      projectRoot = config.root ?? ''
    },

    transformIndexHtml() {
      const tags = []
      if (guardrailsActive()) {
        // Return only the tag array: returning { html } would **replace** the whole HTML (not merge)
        tags.push({
          tag: 'script',
          attrs: { type: 'module', src: GUARDRAILS_URL },
          injectTo: 'head-prepend' as const
        })
      }
      if (agentStateActive()) {
        tags.push({
          tag: 'script',
          attrs: { type: 'module', src: AGENT_STATE_URL },
          injectTo: 'head-prepend' as const
        })
      }
      return tags.length > 0 ? tags : undefined
    },

    configureServer(server: ViteDevServer) {
      /*
       * Agent runtime snapshot cache (bucketed by page href, one most-recent snapshot per page).
       * POST writes (throttled reports from the browser probe), GET returns everything —
       * the read-only consumption surface for Agent / CLI.
       */
      const agentSnapshots = new Map<string, Record<string, unknown>>()
      /*
       * Response collection for live queries (`?live=1`): the request is broadcast over
       * vite WS and the browser probe collects and responds immediately. Wait for the
       * **first** response or a 600ms timeout (fall back to the cache) — do not wait for
       * every connection; in multi-tab scenarios the Agent filters by page itself.
       */
      const pendingLive = new Map<number, (snapshot: Record<string, unknown>) => void>()
      server.ws?.on?.('vobs:agent-state:response', (data: { id?: number; snapshot?: Record<string, unknown> }) => {
        const resolve = data?.id !== undefined ? pendingLive.get(data.id) : undefined
        if (resolve && data.snapshot) {
          pendingLive.delete(data.id!)
          resolve(data.snapshot)
        }
      })
      server.middlewares.use((req, res, next) => {
        const urlPath = req.url?.split('?', 1)[0]
        if (urlPath === AGENT_STATE_ENDPOINT) {
          if (req.method === 'POST' && agentStateActive()) {
            let body = ''
            req.on('data', chunk => { body += String(chunk) })
            req.on('end', () => {
              try {
                const snapshot = JSON.parse(body) as Record<string, unknown>
                if (typeof snapshot.page === 'string') {
                  agentSnapshots.set(snapshot.page, snapshot)
                  while (agentSnapshots.size > 20) {
                    const oldest = agentSnapshots.keys().next().value
                    if (oldest === undefined) break
                    agentSnapshots.delete(oldest)
                  }
                }
              } catch { /* corrupted snapshots are dropped outright — the channel is best-effort and never affects the app */ }
              res.statusCode = 204
              res.end()
            })
            return
          }
          if (req.method === 'GET') {
            const wantsLive = new URL(req.url ?? '/', 'http://localhost').searchParams.has('live')
            if (wantsLive && agentStateActive() && server.ws?.send) {
              const id = ++liveQuerySeq
              void Promise.race([
                new Promise<Record<string, unknown>>(resolve => { pendingLive.set(id, resolve) }),
                new Promise<never>((_, reject) => setTimeout(() => reject(new Error('live timeout')), 600))
              ])
                .then(liveSnapshot => ({ pages: [liveSnapshot], stale: false }))
                .catch(() => ({ pages: [...agentSnapshots.values()], stale: true }))
                .then(payload => {
                  pendingLive.delete(id)
                  res.statusCode = 200
                  res.setHeader('content-type', 'application/json')
                  res.end(JSON.stringify({ serverTime: Date.now(), ...payload }))
                })
              server.ws?.send?.({ type: 'custom', event: 'vobs:agent-state-request', data: { id } })
              return
            }
            res.statusCode = 200
            res.setHeader('content-type', 'application/json')
            res.end(JSON.stringify({
              serverTime: Date.now(),
              pages: [...agentSnapshots.values()]
            }))
            return
          }
          next()
          return
        }
        if (req.method !== 'POST' || urlPath !== VIOLATION_ENDPOINT) {
          next()
          return
        }
        let body = ''
        req.on('data', chunk => { body += String(chunk) })
        req.on('end', () => {
          printViolation(server, body)
          res.statusCode = 204
          res.end()
        })
      })
    },

    resolveId(source: string, importer: string | undefined) {
      if (source === GUARDRAILS_ID) return GUARDRAILS_ID
      if (source === AGENT_STATE_ID) return AGENT_STATE_ID
      if (!importer || !isHtmlComponent(source, options.html) || !isRelativeModule(source)) return null
      const cleanImporter = importer.split(/[?#]/u, 1)[0]
      const cleanSource = source.split(/[?#]/u, 1)[0]
      // Must return POSIX form: load receives Vite's normalized forward-slash id;
      // a backslash string never matches in htmlModules (the Windows-only whole-feature breakage).
      const resolved = toPosixPath(path.resolve(path.dirname(cleanImporter), cleanSource))
      htmlModules.add(resolved)
      return resolved
    },

    async load(id: string) {
      if (id === GUARDRAILS_ID) return guardrailsActive() ? createGuardrailsModule() : null
      if (id === AGENT_STATE_ID) return agentStateActive() ? createAgentStateModule() : null
      // Defensive normalization: still matches even if some caller (or a future Vite version) hands back a backslash form
      if (!htmlModules.has(id) && !htmlModules.has(toPosixPath(id))) return null
      return compileHtmlComponent(await readFile(id, 'utf8'), { filename: stableSourceName(id) })
    },

    transform(code: string, id: string, transformOptions?: { readonly ssr?: boolean }): { code: string; map: VobsSourceMap } | null {
      const cleanId = id.split(/[?#]/u, 1)[0]
      const isTsx = cleanId.endsWith('.tsx')
      const isStateTs = isStateModulePath(cleanId)
      if (!isTsx && !isStateTs) return null
      if (options.include) {
        include.lastIndex = 0
        if (!include.test(id)) return null
      }

      // .ts state modules (store-like): only compiled and HMR-handled when they declare
      // module-level state, avoiding a full re-print of ordinary .ts files.
      if (!isTsx && (!hmrStateEnabled || !isStatefulModule(code))) return null

      const extractor = options.extractI18n
        ? createI18nExtractor({ onKey: options.extractI18n })
        : undefined
      const hmr = options.hmr ?? !productionBuild
      // SSR/Node builds must disable static template hoisting: createTemplate depends on
      // document, and the output would crash as soon as it loads on the server.
      const hoistTemplates = !transformOptions?.ssr
      const result = compileWithSourceMap(code, {
        ...options.compiler,
        // Production builds strip component source locations by default (error location goes through the source map); explicit config wins.
        sourceLocation: options.compiler?.sourceLocation ?? !productionBuild,
        filename: stableSourceName(id),
        // The HMR module identity must stay stable across ?t= queries (registry reuse semantics depend on it); use the clean path.
        hmrModuleId: hmr ? cleanId : options.compiler?.hmrModuleId,
        // Explicit config wins; when unset, SSR builds force it off (browser-only optimization).
        hoistTemplates: options.compiler?.hoistTemplates ?? hoistTemplates,
        plugins: [
          ...(options.compiler?.plugins ?? []),
          ...(extractor ? [extractor.plugin] : [])
        ]
      })
      // Report everything at once: taking only the first entry means 5 errors in a file
      // require 5 builds to see the full picture
      const summary = describeDiagnostics(result.diagnostics)
      if (summary) {
        throw new VobsError({
          code: summary.primary.code,
          layer: 'compiler',
          message: summary.message,
          location: summary.primary.location,
          codeFrame: summary.primary.codeFrame,
          fix: summary.primary.fix
        })
      }
      /*
       * **Warnings must be reported too.**
       *
       * Handling only errors (`describeDiagnostics` returns `null` when there are none)
       * means **warnings are silently dropped**: `VOBS_C105` (JSX at module top level) and
       * `VOBS_C104` (conditional return at top level) were **completely invisible** in
       * `vite build` — on the main build path those two diagnostics effectively did not exist.
       *
       * Going through Vite's own warning channel (`this.warn`) makes them visible in both
       * the build output and the dev server; fall back to `console.warn` when no
       * PluginContext is available (never silent).
       *
       * Deliberately **not** escalating warnings to errors: their rationale is heuristic
       * (see the C104/C105 comments), not strong enough to block builds. For a hard gate,
       * treat warnings as failures in CI.
       */
      const warnings = result.diagnostics.filter(item => item.severity === 'warning')
      /*
       * Analyzer diagnostics (`C118`/`C232`/`C210` static rules) **must be reported here too**.
       *
       * Reported only in `vobs check`, `vite dev`/`vite build` report **none of them** —
       * invisible during development; the problem only surfaces when someone runs CI.
       * This directly conflicts with "errors must not be silent": **the AI finishes its
       * change, `vite build` passes, but the problem is still there.**
       *
       * The rule implementations were already extracted into `@vobs/compiler` (both
       * vite-plugin and the CLI depend on it), so just call it directly —
       * see the comments in `packages/compiler/src/analyze.ts`.
       */
      const analyzed = analyzeSource(code, cleanId)
      if (warnings.length > 0 || analyzed.length > 0) {
        const context = this as unknown as { warn?: (message: string) => unknown }
        const emit = typeof context.warn === 'function'
          ? (message: string): unknown => context.warn!(message)
          : (message: string): void => { console.warn(message) }
        const seen = new Set<string>()
        for (const warning of warnings) {
          const where = `${warning.location.file}:${warning.location.line}:${warning.location.column}`
          const text = `[vobs ${warning.code}] ${where}\n  ${warning.message}`
            + (warning.fix ? `\n  Fix: ${warning.fix}` : '')
          // The same diagnostic may hit multiple places in one file; deduplicate by
          // "code + location + message" to avoid spamming the output
          const key = `${warning.code}|${where}|${warning.message}`
          if (seen.has(key)) continue
          seen.add(key)
          emit(text)
        }
        for (const item of analyzed) {
          // Analyzer errors also go through the **warning channel** (does not block the
          // build): it is an "after writing, before running" hint — failing the build over
          // it would stall the dev workflow, and it is not a compile error.
          const where = `${cleanId}:${item.line}:${item.column}`
          const key = `${item.code}|${where}|${item.message}`
          if (seen.has(key)) continue
          seen.add(key)
          emit(`[vobs ${item.code}] ${where}\n  ${item.message}`
            + (item.fix ? `\n  Fix: ${item.fix}` : '')
            + (item.snippet ? `\n  ${item.snippet}` : ''))
        }
      }
      const hmrCode = hmr ? createHmrCode(cleanId) : ''
      return {
        code: `${result.code}${hmrCode}`,
        map: result.map
      }
    }
  }
}

/** Store-like .ts module with module-level state: imports state from @vobs and actually calls it. */function isStatefulModule(code: string): boolean {
  return /\bimport\s+(?:type\s+)?\{[^}]*\bstate\b[^}]*\}\s*from\s*['"]@vobs\/(?:reactivity|vobs)['"]/u.test(code)
    && /(?<![\w$.])state\s*\(/u.test(code)
}

function isStateModulePath(cleanId: string): boolean {
  if (!cleanId.endsWith('.ts')) return false
  if (cleanId.endsWith('.d.ts')) return false
  if (cleanId.includes('node_modules')) return false
  return true
}

function isRelativeModule(source: string): boolean {
  return source.startsWith('./') || source.startsWith('../')
}

function isHtmlComponent(id: string, option: VobsVitePluginOptions['html']): boolean {
  if (option === false) return false
  const extensions = typeof option === 'object' && option.extensions?.length ? option.extensions : ['.html', '.htm']
  const cleanId = id.split(/[?#]/u, 1)[0]
  return extensions.some(extension => cleanId.endsWith(extension))
}


/**
 * The guardrails module injected into the page.
 *
 * Two deliberate choices:
 * 1. A **dynamic** import instead of a static one: the app does not necessarily depend
 *    on `@vobs/vobs` (projects using only `@vobs/reactivity` exist); a failed static
 *    import resolution would blank the page outright — dev guardrails must never make
 *    the dev environment worse.
 * 2. `.then()` instead of top-level await: TLA requires both browser and build target
 *    support, which is entirely unnecessary here — the guardrails being installed one
 *    microtask later has no impact at all.
 */
function createGuardrailsModule(): string {
  return `
const endpoint = ${JSON.stringify(VIOLATION_ENDPOINT)}

// Reporting failure does not matter: the guardrails are a dev-time aid and never affect the app itself
const report = payload => {
  fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  }).catch(() => {})
}

import('@vobs/vobs/dev').then(guardrails => {
  guardrails.installDevGuardrails?.({
    onViolation: ({ error, count }) => report({
      code: error.code,
      severity: error.severity,
      layer: error.layer,
      message: error.message,
      fix: error.fix,
      example: error.example,
      location: error.location,
      count
    })
  })
}).catch(error => {
  console.warn('[vobs] Dev guardrails not enabled: the page does not have @vobs/vobs installed.', error?.message ?? error)
})
`
}

/**
 * Agent snapshot probe (virtual module).
 *
 * Depends on `window.__VOBS_DEVTOOLS__` (globally available once the devtools plugin is
 * installed) — the probe only consumes the global API, zero coupling with the devtools
 * core. Event-driven + 100ms throttle: any devtools event (update / effect-run /
 * network / error …) schedules one snapshot report, POSTed to `/__vobs/agent-state`.
 * No events, no traffic — an idle page sends nothing.
 */
function createAgentStateModule(): string {
  return `
const endpoint = ${JSON.stringify(AGENT_STATE_ENDPOINT)}

const start = () => {
  const api = window.__VOBS_DEVTOOLS__
  if (!api || typeof api.subscribe !== 'function') return
  const collect = () => ({
    page: window.location.href,
    ts: Date.now(),
    effects: api.getEffects(),
    recentUpdates: api.getUpdates().slice(-20),
    errors: api.getErrors().slice(-20)
  })
  const send = snapshot => {
    try {
      fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(snapshot)
      }).catch(() => {})
    } catch { /* reporting failure never affects the app */ }
  }
  let lastSent = 0
  let timer = null
  const schedule = () => {
    if (timer) return
    const waitMs = Math.max(0, 100 - (Date.now() - lastSent))
    timer = setTimeout(() => { timer = null; lastSent = Date.now(); send(collect()) }, waitMs)
  }
  api.subscribe('*', schedule)
  // "Right now" queries: the middleware broadcasts over vite WS and the probe collects and responds immediately (no throttle)
  if (import.meta.hot) {
    import.meta.hot.on('vobs:agent-state-request', () => {
      import.meta.hot.send('vobs:agent-state:response', { snapshot: collect() })
    })
  }
}

// The devtools plugin may load after this probe — poll until it appears (it always appears in dev)
const poll = setInterval(() => {
  if (window.__VOBS_DEVTOOLS__) { clearInterval(poll); start() }
}, 200)
setTimeout(() => clearInterval(poll), 30000)
`
}

/** Print violations reported by the browser to the dev server terminal. Repeat hits (count > 1) are not printed again. */
function printViolation(server: ViteDevServer, body: string): void {
  let payload: VobsErrorOptions & { location?: VobsErrorLocation; count?: number }
  try {
    payload = JSON.parse(body) as typeof payload
  } catch {
    return
  }
  if (typeof payload?.code !== 'string' || (payload.count ?? 1) > 1) return
  server.config.logger.error(formatVobsError(new VobsError(payload), { environment: 'development' }), { timestamp: true })
}

function createHmrCode(moduleId: string): string {
  const encodedId = JSON.stringify(moduleId)
  return `
import { disposeHmrModule, updateHmrModule } from '@vobs/vobs'

if (import.meta.hot) {
  import.meta.hot.accept((module) => {
    if (module) updateHmrModule(${encodedId}, module)
  })
  import.meta.hot.dispose(() => disposeHmrModule(${encodedId}))
}
`
}
