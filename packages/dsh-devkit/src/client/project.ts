/**
 * Data source for the "Project" page: reads `.vobs/check.json` from the workspace
 * (produced by `vobs check --write`).
 *
 * It goes through DSH's built-in workspace-files Remote (`remote.workspaceFiles`) — the
 * client itself can read workspace files, **the plugin's Host side is not needed**. That is
 * why this version was feasible at all.
 *
 * Several deliberate choices:
 * - **Who writes the report**: the AI (or a human) runs `vobs check --write`. The panel is
 *   read-only and executes no commands — DSH's Remote set is read-only, and the panel cannot
 *   start processes either.
 * - **Polling rather than a change stream**: `changes()` is streaming and more capable, but
 *   I never verified its consumption style (async iterator vs callback) against a live DSH.
 *   `stat()`'s shape is certain; comparing `version` with it is both cheap and stable.
 *   Upgrading to push only means swapping this piece out.
 * - **Honesty**: when the file does not exist, say "the check has not been run yet" and give
 *   the command to run, instead of showing an empty table.
 */
import { state, type Signal } from '@vobs/vobs'
import type { DshClientContext } from '@vobs/dsh'

export interface CheckDiagnostic {
  readonly code: string
  readonly severity: 'error' | 'warning'
  readonly message: string
  readonly fix: string
  readonly file: string
  readonly line: number
  readonly column: number
  readonly snippet?: string
}

export interface CheckReport {
  readonly root: string
  readonly files: number
  readonly skippedTests: number
  readonly diagnostics: readonly CheckDiagnostic[]
}

export type ProjectStatus = 'unavailable' | 'loading' | 'missing' | 'ready' | 'error'

export interface ProjectState {
  readonly status: ProjectStatus
  /** Which session this report belongs to (its workspace root). */
  readonly sessionId?: string
  readonly workspace?: string
  readonly message: string
  readonly report?: CheckReport
}

/** Path of the report relative to the workspace root; matches `vobs check --write`'s default location. */
export const REPORT_PATH = '.vobs/check.json'

export interface ProjectSource {
  readonly state: Signal<ProjectState>
  /** Re-read immediately (the panel can offer a manual refresh button). */
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

interface WorkspaceFilesApi {
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
}

function workspaceFilesOf(ctx: DshClientContext | undefined): WorkspaceFilesApi | undefined {
  const remote = ctx?.get?.('remote') as { workspaceFiles?: WorkspaceFilesApi } | undefined
  return remote?.workspaceFiles
}

/**
 * Decide whether a byte sequence was obtained.
 *
 * **Do not use `instanceof Uint8Array`** — across realms (jsdom, iframes, worker boundaries)
 * the constructors differ and `instanceof` lies. Shape-checking (`byteLength` is a number)
 * holds in every realm.
 */
function asBytes(value: unknown): ArrayBufferView | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const candidate = (value as { data?: unknown }).data ?? value
  if (candidate === null || typeof candidate !== 'object') return undefined
  return typeof (candidate as { byteLength?: unknown }).byteLength === 'number'
    ? candidate as ArrayBufferView
    : undefined
}

/** Read the whole file. Try "one-shot readBytes" first, then page by line — both shapes appear in the docs. */
async function readWholeFile(api: WorkspaceFilesApi, sessionId: string, path: string): Promise<string> {
  if (typeof api.readBytes === 'function') {
    const bytes = asBytes(await api.readBytes(sessionId, path, {}))
    if (bytes !== undefined) return new TextDecoder().decode(bytes)
  }
  if (typeof api.read !== 'function') throw new Error('workspaceFiles has no usable read method')

  let text = ''
  let offset = 1
  for (let page = 0; page < 20; page += 1) {
    const result = await api.read(sessionId, path, { offset })
    if (result === undefined) break
    if (page > 0) text += '\n'
    text += result.text ?? ''
    if (result.eof === true) break
    const lines = typeof result.lines === 'number' && result.lines > 0 ? result.lines : 1
    offset += lines
  }
  return text
}

/* ---------------------------------------------------------------- Data source */

export interface ProjectSourceOptions {
  /** Polling interval (milliseconds). Defaults to 2500. Set 0 to disable polling (for tests). */
  readonly pollMs?: number
  /**
   * Write into this signal instead of creating a new one.
   *
   * The panel's render is assembled before setup runs (same as the Console), so the state
   * signal must exist at module level; `setup(ctx)` then hands it to the data source to drive.
   */
  readonly sink?: Signal<ProjectState>
}

export function createProjectSource(
  ctx: DshClientContext | undefined,
  options: ProjectSourceOptions = {}
): ProjectSource {
  const pollMs = options.pollMs ?? 2500
  const projectState = options.sink ?? state<ProjectState>({ status: 'loading', message: 'Reading the check report…' }, 'signal')
  projectState.value = { status: 'loading', message: 'Reading the check report…' }

  const session = pickSession(ctx)
  const api = workspaceFilesOf(ctx)

  if (session === undefined || api === undefined) {
    projectState.value = {
      status: 'unavailable',
      message: session === undefined
        ? 'Cannot read the session list (sessions service unavailable), so the workspace is unknown.'
        : 'Cannot read the workspace-files service (remote.workspaceFiles unavailable), so workspace files cannot be read.'
    }
    return { state: projectState, refresh: () => {}, dispose: () => {} }
  }

  const sessionId = String(session.sessionId ?? '')
  const workspace = session.cwd
  let lastVersion: unknown
  let disposed = false
  let inFlight = false

  const fail = (message: string): void => {
    projectState.value = { status: 'error', sessionId, workspace, message }
  }

  const load = async (): Promise<void> => {
    if (disposed || inFlight) return
    inFlight = true
    try {
      const text = await readWholeFile(api, sessionId, REPORT_PATH)
      const report = JSON.parse(text) as CheckReport
      if (disposed) return
      projectState.value = {
        status: 'ready',
        sessionId,
        workspace,
        message: `Report from ${workspace ?? 'the workspace'}`,
        report
      }
    } catch (error) {
      if (disposed) return
      const message = error instanceof Error ? error.message : String(error)
      // A missing file is the most common "normal" case: the check has not been run yet. Not an error.
      if (/not.?found|ENOENT|lookup-not-found/iu.test(message)) {
        projectState.value = {
          status: 'missing',
          sessionId,
          workspace,
          message: `${REPORT_PATH} does not exist yet`
        }
      } else {
        fail(message)
      }
    } finally {
      inFlight = false
    }
  }

  /** Lightweight probe: re-read the file only when the version changed. */
  const tick = async (): Promise<void> => {
    if (disposed) return
    try {
      if (typeof api.stat === 'function') {
        const info = await api.stat(sessionId, REPORT_PATH)
        const version = info?.version
        if (version === undefined || version === lastVersion) {
          // Version undetectable or unchanged — still make sure the first read gets content
          if (projectState.value.status === 'loading') await load()
          return
        }
        lastVersion = version
      }
      await load()
    } catch {
      // A stat failure usually means the file does not exist — let load distinguish "not run yet" from a real error
      if (projectState.value.status === 'loading') await load()
    }
  }

  void tick()
  const timer = pollMs > 0 ? setInterval(() => { void tick() }, pollMs) : undefined

  return {
    state: projectState,
    refresh: () => { void tick() },
    dispose: () => {
      disposed = true
      if (timer !== undefined) clearInterval(timer)
    }
  }
}
