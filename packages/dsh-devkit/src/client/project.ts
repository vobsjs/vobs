/**
 * 「项目」页的数据源：读工作区里的 `.vobs/check.json`（`vobs check --write` 产出）。
 *
 * 走的是 DSH 内置的 workspace-files Remote（`remote.workspaceFiles`）—— 客户端就能读
 * 工作区文件，**不需要插件的 Host 半侧**。这也是为什么这一版能做成。
 *
 * 几个刻意的选择：
 * - **谁写报告**：由 AI（或人）跑 `vobs check --write`。面板只读、不执行命令 ——
 *   DSH 的这套 Remote 是只读的，面板也无法启动进程。
 * - **轮询而不是变更流**：`changes()` 是流式的、更强，但消费方式（异步迭代器还是回调）
 *   我没在活体 DSH 上验证过。`stat()` 的形状是确定的，用它比对 `version` 既便宜又稳。
 *   要升级成 push 只需要换掉这一段。
 * - **如实**：文件不存在就说「还没跑过检查」并给出该跑什么命令，而不是显示一张空表。
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
  /** 这份报告属于哪个会话（它的工作区根）。 */
  readonly sessionId?: string
  readonly workspace?: string
  readonly message: string
  readonly report?: CheckReport
}

/** 报告相对工作区根的路径，与 `vobs check --write` 的默认落点一致。 */
export const REPORT_PATH = '.vobs/check.json'

export interface ProjectSource {
  readonly state: Signal<ProjectState>
  /** 立刻重读一次（面板可以给个手动刷新按钮）。 */
  refresh(): void
  dispose(): void
}

/* ------------------------------------------------- DSH 服务的防御式读取 */

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

/** 当前工作区用哪个会话：取最近更新的那个非空会话。 */
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
 * 判断是否拿到了字节序列。
 *
 * **不要用 `instanceof Uint8Array`** —— 跨 realm（jsdom、iframe、worker 边界）时构造
 * 函数不同，`instanceof` 会假。按形状判断（`byteLength` 是数值）在任何 realm 都成立。
 */
function asBytes(value: unknown): ArrayBufferView | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const candidate = (value as { data?: unknown }).data ?? value
  if (candidate === null || typeof candidate !== 'object') return undefined
  return typeof (candidate as { byteLength?: unknown }).byteLength === 'number'
    ? candidate as ArrayBufferView
    : undefined
}

/** 读到文件全文。先试「整份 readBytes」，不行再按行分页 —— 两种形状在文档里都有。 */
async function readWholeFile(api: WorkspaceFilesApi, sessionId: string, path: string): Promise<string> {
  if (typeof api.readBytes === 'function') {
    const bytes = asBytes(await api.readBytes(sessionId, path, {}))
    if (bytes !== undefined) return new TextDecoder().decode(bytes)
  }
  if (typeof api.read !== 'function') throw new Error('workspaceFiles 没有可用的读取方法')

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

/* ---------------------------------------------------------------- 数据源 */

export interface ProjectSourceOptions {
  /** 轮询间隔（毫秒）。默认 2500。设 0 关掉轮询（测试用）。 */
  readonly pollMs?: number
  /**
   * 写进这个信号而不是新建一个。
   *
   * 面板的 render 在 setup 之前就装配好了（和 Console 一样），所以状态信号必须是模块级
   * 存在的；`setup(ctx)` 里再把它交给数据源去驱动。
   */
  readonly sink?: Signal<ProjectState>
}

export function createProjectSource(
  ctx: DshClientContext | undefined,
  options: ProjectSourceOptions = {}
): ProjectSource {
  const pollMs = options.pollMs ?? 2500
  const projectState = options.sink ?? state<ProjectState>({ status: 'loading', message: '正在读取检查报告…' })
  projectState.value = { status: 'loading', message: '正在读取检查报告…' }

  const session = pickSession(ctx)
  const api = workspaceFilesOf(ctx)

  if (session === undefined || api === undefined) {
    projectState.value = {
      status: 'unavailable',
      message: session === undefined
        ? '读不到会话列表（sessions 服务不可用），因此不知道工作区在哪。'
        : '读不到 workspace-files 服务（remote.workspaceFiles 不可用），因此读不了工作区文件。'
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
        message: `报告来自 ${workspace ?? '工作区'}`,
        report
      }
    } catch (error) {
      if (disposed) return
      const message = error instanceof Error ? error.message : String(error)
      // 文件不存在是最常见的「正常」情况：还没跑过检查。不当作错误。
      if (/not.?found|ENOENT|lookup-not-found/iu.test(message)) {
        projectState.value = {
          status: 'missing',
          sessionId,
          workspace,
          message: `还没有 ${REPORT_PATH}`
        }
      } else {
        fail(message)
      }
    } finally {
      inFlight = false
    }
  }

  /** 轻量探测：只有 version 变了才重读文件。 */
  const tick = async (): Promise<void> => {
    if (disposed) return
    try {
      if (typeof api.stat === 'function') {
        const info = await api.stat(sessionId, REPORT_PATH)
        const version = info?.version
        if (version === undefined || version === lastVersion) {
          // 探测不到版本号，或没变化 —— 仍然保证首次能读到内容
          if (projectState.value.status === 'loading') await load()
          return
        }
        lastVersion = version
      }
      await load()
    } catch {
      // stat 失败通常就是文件不存在 —— 交给 load 去区分「没跑过」和「真出错」
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
