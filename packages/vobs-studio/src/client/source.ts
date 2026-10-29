/**
 * Source browser data layer: the "Files" mode of the Studio panel.
 *
 * Root = the generated project dir from the preview manifest (the panel is about the
 * generated project, not the whole workspace). Directory listings are fetched lazily
 * per expansion via `workspaceFiles.list` (wire contract verified against the Host
 * typert: `{ path, entries: [{name, type, size?}], truncated }`, and — like stat/read —
 * a missing path THROWS instead of resolving cleanly). File contents stream through the
 * same paged `read` the manifest uses.
 *
 * No polling and no `changes` stream: a directory is re-fetched when (re-)expanded, and
 * the existing Refresh button re-runs the manifest flow — the repo discipline is to
 * keep unverified streams out of the panel.
 */
import { state, type Signal } from '@vobs/vobs'
import { readWorkspaceText, workspaceFilesOf, type WorkspaceFilesApi } from './manifest'

/** Directories that are build/dependency noise for a source review. */
const EXCLUDED_DIRS = new Set(['node_modules', 'dist', '.git', '.vobs'])

export interface SourceEntry {
  readonly name: string
  readonly type: 'file' | 'directory'
}

export type SourceStatus = 'off' | 'loading' | 'ready' | 'error'

export interface SourceState {
  readonly status: SourceStatus
  readonly message: string
  /** Project dir the tree is rooted at (e.g. "order-admin"). Empty when not available. */
  readonly projectDir: string
  /** Directory rel-paths currently expanded. */
  readonly expanded: readonly string[]
  /** Loaded directory listings by rel-path ('' = project root). */
  readonly dirs: Readonly<Record<string, readonly SourceEntry[]>>
  /** Selected file (rel to projectDir) and its text. */
  readonly openPath: string
  readonly openState: 'loading' | 'ok' | 'error'
  readonly openText: string
}

export interface SourceSignals {
  readonly state: Signal<SourceState>
  listDir(relPath: string): Promise<void>
  toggleDir(relPath: string): void
  openFile(relPath: string): Promise<void>
  reset(): void
}

const EMPTY: SourceState = {
  status: 'off',
  message: '',
  projectDir: '',
  expanded: [],
  dirs: {},
  openPath: '',
  openState: 'loading',
  openText: ''
}

const joinPath = (base: string, rel: string): string => (rel === '' ? base : `${base}/${rel}`)

function sortEntries(entries: readonly SourceEntry[]): readonly SourceEntry[] {
  return [...entries].sort((a, b) =>
    a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1
  )
}

export function createSourceBrowser(ctx: unknown, signals: { projectDir: Signal<string>; sessionId: Signal<string> }): SourceSignals {
  const sourceState = state<SourceState>(EMPTY, 'studio.source')
  let inFlight = false

  const patch = (next: Partial<SourceState>): void => {
    sourceState.value = { ...sourceState.value, ...next }
  }

  const api = (): WorkspaceFilesApi | undefined => workspaceFilesOf(ctx as never)
  const sessionId = (): string => String(signals.sessionId.value ?? '')

  /** List one directory (rel to projectDir) into the cache. Throws propagate to callers. */
  const fetchDir = async (relPath: string): Promise<void> => {
    const workspaceApi = api()
    if (workspaceApi?.list === undefined) throw new Error('workspaceFiles.list is unavailable')
    const abs = joinPath(signals.projectDir.value, relPath)
    const result = await workspaceApi.list(sessionId(), abs)
    const raw = Array.isArray(result?.entries) ? result?.entries : []
    const entries: SourceEntry[] = raw
      .filter(e => typeof e?.name === 'string' && e.name !== '' && !EXCLUDED_DIRS.has(e.name))
      .map(e => ({ name: String(e.name), type: e.type === 'directory' ? 'directory' : 'file' }))
    const dirs = { ...sourceState.value.dirs, [relPath]: sortEntries(entries) }
    patch({ dirs })
  }

  const listDir = async (relPath: string): Promise<void> => {
    if (inFlight) return
    inFlight = true
    try {
      await fetchDir(relPath)
    } catch (error) {
      patch({ status: 'error', message: error instanceof Error ? error.message : String(error) })
    } finally {
      inFlight = false
    }
  }

  return {
    state: sourceState,
    listDir,
    toggleDir(relPath: string): void {
      const expanded = sourceState.value.expanded
      if (expanded.includes(relPath)) {
        patch({ expanded: expanded.filter(p => p !== relPath) })
        return
      }
      patch({ expanded: [...expanded, relPath] })
      if (sourceState.value.dirs[relPath] === undefined) void listDir(relPath)
    },
    async openFile(relPath: string): Promise<void> {
      patch({ openPath: relPath, openState: 'loading', openText: '' })
      const workspaceApi = api()
      if (workspaceApi === undefined) {
        patch({ openState: 'error', openText: 'workspaceFiles service is unavailable' })
        return
      }
      const text = await readWorkspaceText(workspaceApi, sessionId(), joinPath(signals.projectDir.value, relPath))
      if (text === undefined) patch({ openState: 'error', openText: 'could not read this file' })
      else patch({ openState: 'ok', openText: text })
    },
    reset(): void {
      sourceState.value = { ...EMPTY }
    }
  }
}

/**
 * Assemble the visible tree from the loaded directory cache. Pure over signals so the
 * JSX position stays a single subscription.
 */
export function buildTree(dirs: Readonly<Record<string, readonly SourceEntry[]>>, relPath: string): TreeNode[] {
  const entries = dirs[relPath]
  if (entries === undefined) return []
  return entries.map(entry => {
    const childRel = relPath === '' ? entry.name : `${relPath}/${entry.name}`
    return {
      name: entry.name,
      relPath: childRel,
      isDir: entry.type === 'directory',
      children: entry.type === 'directory' ? buildTree(dirs, childRel) : []
    }
  })
}

export interface TreeNode {
  readonly name: string
  readonly relPath: string
  readonly isDir: boolean
  readonly children: readonly TreeNode[]
}
