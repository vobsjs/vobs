/**
 * Data source for the Studio preview: reads `.vobs/studio/preview.json` from the
 * session workspace.
 *
 * Who writes the manifest: the design tooling (`design_preview_build` / the agent's
 * skill instructions) — the panel is read-only and executes nothing. DSH's Remote set
 * is read-only and the panel cannot start processes, so the manifest is the contract
 * between the generation side and this panel:
 *
 * ```json
 * {
 *   "version": 1,
 *   "server": { "origin": "http://127.0.0.1:5218" },
 *   "project": { "name": "my-app", "dir": "my-app" },
 *   "pages": [{ "id": "dashboard", "title": "Dashboard", "route": "/", "file": "dashboard.html" }]
 * }
 * ```
 *
 * Polling rather than a change stream, same rationale as the devkit's Project page:
 * `stat()`'s shape is verified against a live DSH; `changes()` is not.
 */
import { state, type Signal } from '@vobs/vobs'
import type { DshClientContext } from '@vobs/dsh'

/** Path of the preview manifest relative to the workspace root. */
export const MANIFEST_PATH = '.vobs/studio/preview.json'

export interface PreviewPage {
  readonly id: string
  readonly title: string
  readonly route?: string
  readonly file: string
}

export interface PreviewManifest {
  readonly version?: number
  readonly server?: { readonly origin?: string }
  readonly project?: { readonly name?: string; readonly dir?: string }
  readonly pages?: readonly PreviewPage[]
}

export type StudioStatus = 'unavailable' | 'loading' | 'missing' | 'ready' | 'error'

export interface StudioState {
  readonly status: StudioStatus
  readonly sessionId?: string
  readonly workspace?: string
  readonly message: string
  /** Why the last read failed — surfaced in the panel so silence never hides a Host error. */
  readonly diagnostic?: string
  readonly manifest?: PreviewManifest
}

export interface StudioSource {
  readonly state: Signal<StudioState>
  refresh(): void
  dispose(): void
}

/* ------------------------------------------------- Defensive reads of DSH services */

interface SessionRow {
  readonly sessionId?: string
  readonly title?: string
  readonly blank?: boolean
  readonly updatedAt?: number
  readonly cwd?: string
}

interface SnapshotStore<T> {
  getSnapshot(): T
  subscribe?(listener: () => void): () => void
}

/** Which session to use as the current workspace: the most recently updated non-blank one. */
function pickSession(ctx: DshClientContext | undefined): SessionRow | undefined {
  const list = (ctx?.get?.('sessions') as { list?: SnapshotStore<{ byId?: Record<string, SessionRow> }> } | undefined)?.list
  if (list === undefined || typeof list.getSnapshot !== 'function') return undefined

  let snapshot: { byId?: Record<string, SessionRow> }
  try {
    snapshot = list.getSnapshot()
  } catch {
    return undefined
  }
  const rows = Object.values(snapshot.byId ?? {}).filter(row => row.blank !== true)
  if (rows.length === 0) return undefined
  return rows.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0]
}

export interface WorkspaceFilesApi {
  readonly stat?: (sessionId: string, path: string, signal?: unknown) => Promise<{ version?: unknown; bytes?: number } | undefined>
  readonly read?: (
    sessionId: string,
    path: string,
    range?: { offset?: number; limit?: number },
    signal?: unknown
  ) => Promise<{ text?: string; lines?: number; eof?: boolean } | undefined>
  readonly readBytes?: (
    sessionId: string,
    path: string,
    options?: { range?: unknown; baseFile?: string },
    signal?: unknown
  ) => Promise<{ data?: Uint8Array } | Uint8Array | undefined>
  readonly list?: (
    sessionId: string,
    path: string,
    signal?: unknown
  ) => Promise<
    | {
        path?: string
        entries?: readonly { name: string; type?: string; size?: number }[]
        truncated?: boolean
      }
    | undefined
  >
}

export function workspaceFilesOf(ctx: DshClientContext | undefined): WorkspaceFilesApi | undefined {
  const remote = ctx?.get?.('remote') as { workspaceFiles?: WorkspaceFilesApi } | undefined
  return remote?.workspaceFiles
}

/**
 * Decide whether a byte sequence was obtained. Shape-checking (`byteLength` is a number)
 * holds across realms; `instanceof Uint8Array` does not.
 */
function asBytes(value: unknown): ArrayBufferView | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const candidate = (value as { data?: unknown }).data ?? value
  if (candidate === null || typeof candidate !== 'object') return undefined
  return typeof (candidate as { byteLength?: unknown }).byteLength === 'number'
    ? candidate as ArrayBufferView
    : undefined
}

/**
 * Read a whole file. Discriminated result: 'ok' carries the text; 'unreadable' carries
 * the Host's real error message — the panel surfaces it, because a silent missing state
 * cost us a full debugging round (the absolute-path incident).
 *
 * Two channels, cross-checked: readBytes (single binary shot) and the paged text read.
 * Field round #3 caught readBytes resolving with EMPTY data for a non-empty file — so an
 * empty readBytes payload is never trusted alone; the paged read must confirm it. Only
 * when every channel that ran completed without throwing and all were empty is the file
 * reported as truly empty ('ok' with '').
 */
export async function readTextWithReason(api: WorkspaceFilesApi, sessionId: string, path: string): Promise<{ kind: 'ok'; text: string } | { kind: 'unreadable'; reason: string }> {
  let sawChannel = false
  let allEmpty = true
  let reason: string | undefined

  if (typeof api.readBytes === 'function') {
    sawChannel = true
    try {
      const bytes = asBytes(await api.readBytes(sessionId, path, {}))
      if (bytes !== undefined && bytes.byteLength > 0) return { kind: 'ok', text: new TextDecoder().decode(bytes) }
      reason = 'readBytes returned no data'
    } catch (error) {
      allEmpty = false
      reason = error instanceof Error ? error.message : String(error)
    }
  }

  if (typeof api.read === 'function') {
    sawChannel = true
    try {
      let text = ''
      let offset = 1 // line numbers are 1-based — the official paged reader starts at 1
      for (let page = 0; page < 20; page += 1) {
        const before = text
        const result = await api.read(sessionId, path, { offset })
        if (result === undefined) break
        if (page > 0 && !text.endsWith('\n')) text += '\n'
        text += result.text ?? ''
        // No-progress guard: a Host anomaly that answers every page with empty text and
        // eof=false would otherwise burn 20 IPC calls per poll and starve the renderer
        // (the UI-freeze incident). One empty page is enough to stop.
        if (text === before) break
        if (result.eof === true) break
        const lines = typeof result.lines === 'number' && result.lines > 0 ? result.lines : 1
        offset += lines
      }
      if (text !== '') return { kind: 'ok', text }
      reason = reason ?? 'the paged read returned empty text'
    } catch (error) {
      allEmpty = false
      reason = error instanceof Error ? error.message : String(error)
    }
  }

  if (!sawChannel) return { kind: 'unreadable', reason: 'workspaceFiles has no usable read method' }
  if (allEmpty) return { kind: 'ok', text: '' } // the file exists with zero content
  return { kind: 'unreadable', reason: reason ?? 'the file could not be read' }
}

/** Back-compat wrapper: text or undefined. */
export async function readWorkspaceText(api: WorkspaceFilesApi, sessionId: string, path: string): Promise<string | undefined> {
  const read = await readTextWithReason(api, sessionId, path)
  return read.kind === 'ok' ? read.text : undefined
}

/* ---------------------------------------------------------------- Data source */

export interface StudioSourceOptions {
  /** Polling interval (milliseconds). Defaults to 2500. Set 0 to disable polling (for tests). */
  readonly pollMs?: number
  /** Write into this signal instead of creating a new one (module-level state for render assembly). */
  readonly sink?: Signal<StudioState>
}

const EMPTY: StudioState = { status: 'loading', message: 'Reading the preview manifest…' }

/** Join a workspace (or any base dir) with a workspace-relative path into an absolute path. */
const joinPath = (base: string | undefined, rel: string): string => {
  if (base === undefined || base === '') return rel
  if (rel === '') return base.replace(/[\\/]+$/u, '')
  return `${base.replace(/[\\/]+$/u, '')}/${rel.replace(/^[\\/]+/u, '')}`
}

export { joinPath as joinWorkspace }

const MISSING_MESSAGE = 'No preview manifest yet. Generate pages first (the skill writes .vobs/studio/preview.json).'

export function createStudioSource(ctx: DshClientContext | undefined, options: StudioSourceOptions = {}): StudioSource {
  const pollMs = options.pollMs ?? 2500
  const studioState = options.sink ?? state<StudioState>(EMPTY, 'studio.state')
  studioState.value = EMPTY

  let lastVersion: unknown
  let disposed = false
  let inFlight = false

  const setState = (patch: Partial<StudioState>): void => {
    studioState.value = { ...studioState.value, ...patch }
  }

  /**
   * Services are probed **on every tick**, not once at setup: on a real DSH the sessions /
   * remote services register AFTER client plugins load, so a setup-time probe permanently
   * fails (the exact bug seen in a real install — the Console avoids it by hot-swapping).
   * "unavailable" is therefore a retrying state, never terminal.
   */
  const showMissing = (sessionId: string, workspace: string | undefined, diagnostic?: string): void => {
    lastVersion = undefined
    setState({ status: 'missing', sessionId, workspace, message: MISSING_MESSAGE, diagnostic, manifest: undefined })
  }

  const load = async (): Promise<void> => {
    if (disposed || inFlight) return
    inFlight = true
    let sessionId = ''
    let workspace: string | undefined
    try {
      const session = pickSession(ctx)
      const api = workspaceFilesOf(ctx)
      if (session === undefined || api === undefined) {
        setState({
          status: 'unavailable',
          message: session === undefined
            ? 'Waiting for the sessions service (it registers after plugins load) — retrying…'
            : 'Waiting for the workspace-files service — retrying…'
        })
        return
      }
      sessionId = String(session.sessionId ?? '')
      workspace = session.cwd

      /**
       * The Host's stat/read take an ABSOLUTE path ("the filesystem's execution world"
       * — verified in the asar docstring); a workspace-relative path resolves to nothing
       * and the call throws → the panel showed 'missing' forever on a real Host while
       * the manifest sat on disk. Compose workspace + rel into an absolute path.
       */
      const manifestPath = joinPath(workspace, MANIFEST_PATH)

      /**
       * stat is a cheap skip, NOT an existence oracle: the Host's stat result carries no
       * "absent" state (bytes is optional) and a missing file may resolve or throw alike.
       * Only a concrete `bytes` number is acted on; everything else falls through to the
       * read, which is the single source of truth for existence.
       */
      if (typeof api.stat === 'function') {
        try {
          const info = await api.stat(sessionId, manifestPath)
          if (info !== undefined && typeof info.bytes === 'number') {
            if (info.bytes === 0) {
              showMissing(sessionId, workspace)
              return
            }
            if (info.version !== undefined && info.version === lastVersion && studioState.value.status === 'ready') return
            lastVersion = info.version
          }
        } catch {
          /* existence is decided by the read below */
        }
      }

      const read = await readTextWithReason(api, sessionId, manifestPath)
      if (read.kind === 'unreadable') {
        // Read failed: either no manifest (the common case — a missing file throws on the
        // real Host) or a transport failure. An already-ready panel keeps its preview; a
        // non-ready one shows the setup card WITH the Host's real error text.
        if (studioState.value.status !== 'ready') showMissing(sessionId, workspace, `read failed: ${read.reason}`)
        return
      }
      if (read.text.trim() === '') {
        showMissing(sessionId, workspace, 'the manifest file exists but is empty')
        return
      }

      let parsed: unknown
      try {
        parsed = JSON.parse(read.text)
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        setState({
          status: 'error',
          sessionId,
          workspace,
          message: `Preview manifest is not valid JSON (${reason}). Rebuild the preview to rewrite it.`
        })
        return
      }
      if (parsed === null || typeof parsed !== 'object') {
        setState({ status: 'error', sessionId, workspace, message: 'Preview manifest is not an object. Rebuild the preview to rewrite it.' })
        return
      }
      const manifest = parsed as PreviewManifest
      const pages = Array.isArray(manifest.pages) ? manifest.pages : []
      if (pages.length === 0) {
        setState({ status: 'error', sessionId, workspace, message: 'Preview manifest has no pages. Rebuild the preview to rewrite it.' })
        return
      }
      setState({ status: 'ready', sessionId, workspace, message: '', manifest })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setState({ status: 'error', sessionId, workspace, message })
    } finally {
      inFlight = false
    }
  }

  /**
   * Self-scheduling poll with BACKOFF: live refresh needs the fast cadence only when
   * ready; while missing/unavailable every tick burns stat+readBytes+read IPC against
   * the Host — a 4× slower cadence there keeps the renderer (and the Host) fluid.
   */
  let timer: ReturnType<typeof setTimeout> | undefined
  const schedule = (): void => {
    if (disposed) return
    const delay = studioState.value.status === 'ready' ? pollMs : pollMs * 4
    timer = setTimeout(() => {
      void load().finally(schedule)
    }, delay)
  }
  if (pollMs > 0) {
    void load().finally(schedule) // first load immediately, then the backoff cadence
  } else {
    void load()
  }

  return {
    state: studioState,
    refresh: () => { void load() },
    dispose: () => {
      disposed = true
      if (timer !== undefined) clearTimeout(timer)
    }
  }
}

/** Resolve a page to a loadable URL. The static server is the only supported origin for now. */
export function pageUrl(manifest: PreviewManifest | undefined, page: PreviewPage): string | undefined {
  const origin = manifest?.server?.origin
  if (origin === undefined || origin === '') return undefined
  const base = origin.endsWith('/') ? origin.slice(0, -1) : origin
  const file = page.file.startsWith('/') ? page.file : `/${page.file}`
  return base + file
}
