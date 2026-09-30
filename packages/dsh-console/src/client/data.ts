import { memo, state, type ReadableSignal, type Signal } from '@vobs/vobs'
import type { DshClientContext } from '@vobs/dsh'

/* ------------------------------------------------------------------ 数据模型 */

export type ConsoleEventStatus = 'ok' | 'warn' | 'err' | 'run'

/** 一条运行态事件。字段刻意保持扁平，便于从 DSH 的 session 事件流直接映射。 */
export interface ConsoleEvent {
  /** 全局递增序号，用作 keyed list 的 key。 */
  seq: number
  /** epoch 毫秒。 */
  time: number
  sessionId: string
  sessionTitle: string
  /** 事件类型，沿用 DSH 的命名：turn/start、tool/end、approval/request … */
  kind: string
  detail: string
  durationMs?: number
  status?: ConsoleEventStatus
  /** 该事件属于哪个工具（tool/start、tool/end 才有）。 */
  tool?: string
}

export type SessionState = 'run' | 'wait' | 'ok' | 'idle'

export interface SessionSummary {
  id: string
  title: string
  state: SessionState
  tokens: number
  durationMs: number
  lastActivity: number
}

export interface ToolStat {
  name: string
  calls: number
  failures: number
  p50: number
  p95: number
  totalMs: number
  /** 最近若干次调用的耗时序列，用于画迷你趋势线。 */
  trend: readonly number[]
}

export interface ToolTotals {
  calls: number
  failures: number
  successRate: number
  p50: number
  p95: number
}

export interface ConsoleSnapshot {
  events: readonly ConsoleEvent[]
  sessions: readonly SessionSummary[]
}

export type ConsolePatch =
  | { type: 'event'; event: ConsoleEvent }
  | { type: 'sessions'; sessions: readonly SessionSummary[] }
  /** 数据源被换掉（例如从演示数据切到真实服务）：丢弃已有聚合，按新源重建。 */
  | { type: 'reset' }

/**
 * 数据源。UI 只认这个接口，因此「换真实数据」不需要动任何视图代码。
 *
 * `note` 会被渲染成界面上的接入状态说明 —— 演示数据必须自报家门，
 * 不能让看的人以为这是真实运行态。
 */
export interface ConsoleSource {
  readonly kind: 'synthetic' | 'dsh'
  readonly label: string
  readonly note: string
  snapshot(): ConsoleSnapshot
  subscribe(listener: (patch: ConsolePatch) => void): () => void
  dispose(): void
}

/* -------------------------------------------------------------------- 常量 */

/** 事件环形缓冲上限：超出后丢弃最旧的，避免长时间运行把内存吃光。 */
export const EVENT_LIMIT = 5000

/** 每个工具保留的耗时样本数，用于计算 P50/P95。 */
export const TOOL_SAMPLE_LIMIT = 240

/** 趋势线保留的最近调用次数。 */
export const TREND_LENGTH = 24

/* ------------------------------------------------------------------ 格式化 */

const pad = (value: number): string => (value < 10 ? `0${value}` : String(value))

export function formatClock(time: number): string {
  const date = new Date(time)
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.round((ms % 60_000) / 1000)
  return `${minutes}m${pad(seconds)}s`
}

export function formatTokens(tokens: number): string {
  if (tokens < 1000) return String(tokens)
  if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(1)}k`
  return `${(tokens / 1_000_000).toFixed(2)}M`
}

/**
 * 把一串数值折成 SVG 折线路径。返回的是 `<path d>` 的值，纯函数、可单测。
 *
 * @param values - 数值序列
 * @param width - 目标宽度
 * @param height - 目标高度
 * @param padding - 上下留白，避免线贴边
 */
export function buildSparkline(values: readonly number[], width: number, height: number, padding = 2): string {
  if (values.length === 0) return ''
  const max = Math.max(...values)
  const min = Math.min(...values)
  const span = max - min || 1
  const usable = height - padding * 2
  const stepX = values.length === 1 ? 0 : width / (values.length - 1)

  return values
    .map((value, index) => {
      const x = index * stepX
      const y = padding + (1 - (value - min) / span) * usable
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
    })
    .join(' ')
}

/* -------------------------------------------------------------- 工具聚合 */

interface ToolBucket {
  name: string
  durations: number[]
  failures: number
  trend: number[]
}

function percentile(sorted: readonly number[], ratio: number): number {
  if (sorted.length === 0) return 0
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))
  return sorted[index] ?? 0
}

function toToolStats(buckets: ReadonlyMap<string, ToolBucket>): ToolStat[] {
  return [...buckets.values()]
    .map(bucket => {
      const sorted = [...bucket.durations].sort((a, b) => a - b)
      const totalMs = bucket.durations.reduce((sum, value) => sum + value, 0)
      return {
        name: bucket.name,
        // 每次 tool/end 恰好压入一个耗时样本，失败是它的子集，不能重复计入。
        calls: bucket.durations.length,
        failures: bucket.failures,
        p50: percentile(sorted, 0.5),
        p95: percentile(sorted, 0.95),
        totalMs,
        trend: [...bucket.trend]
      } satisfies ToolStat
    })
    .sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name))
}

/**
 * 把一条事件折进工具统计。只有 `tool/end` 才算一次调用：
 * `tool/start` 只是开始，既没有耗时也不构成调用计数。
 */
function recordTool(buckets: Map<string, ToolBucket>, event: ConsoleEvent): boolean {
  if (event.kind !== 'tool/end' || event.tool === undefined) return false
  const name = event.tool
  let bucket = buckets.get(name)
  if (bucket === undefined) {
    bucket = { name, durations: [], failures: 0, trend: [] }
    buckets.set(name, bucket)
  }

  const duration = event.durationMs ?? 0
  bucket.durations.push(duration)
  if (bucket.durations.length > TOOL_SAMPLE_LIMIT) bucket.durations.shift()
  bucket.trend.push(duration)
  if (bucket.trend.length > TREND_LENGTH) bucket.trend.shift()
  if (event.status === 'err' || event.status === 'warn') bucket.failures += 1
  return true
}

/* -------------------------------------------------------------------- 商店 */

export interface ConsoleStore {
  readonly source: ConsoleSource
  readonly events: Signal<readonly ConsoleEvent[]>
  readonly sessions: Signal<readonly SessionSummary[]>
  readonly tools: Signal<readonly ToolStat[]>
  readonly paused: Signal<boolean>
  /** 暂停期间被丢弃的事件数，恢复时清零。 */
  readonly droppedWhilePaused: Signal<number>
  readonly revision: Signal<number>
  readonly totals: ReadableSignal<ToolTotals>
  pause(): void
  resume(): void
  clear(): void
  dispose(): void
}

/**
 * 把数据源的事件折叠成 UI 需要的三份状态：事件缓冲、会话列表、工具聚合。
 *
 * 工具统计是**增量**维护的：每条 `tool/end` 只更新它所属的那个 bucket，
 * 不会为了算 P95 去重扫全量事件。
 */
export function createConsoleStore(source: ConsoleSource): ConsoleStore {
  const seed = source.snapshot()
  const events = state<readonly ConsoleEvent[]>(seed.events.slice())
  const sessions = state<readonly SessionSummary[]>(seed.sessions.slice())
  const paused = state(false)
  const droppedWhilePaused = state(0)
  const revision = state(0)

  const buckets = new Map<string, ToolBucket>()
  for (const event of [...seed.events].reverse()) recordTool(buckets, event)
  const tools = state<readonly ToolStat[]>(toToolStats(buckets))

  const totals = memo<ToolTotals>(() => {
    const list = tools.value
    let calls = 0
    let failures = 0
    let maxP95 = 0
    let weighted = 0
    let counted = 0
    for (const stat of list) {
      calls += stat.calls
      failures += stat.failures
      maxP95 = Math.max(maxP95, stat.p95)
      weighted += stat.p50 * stat.calls
      counted += stat.calls
    }
    return {
      calls,
      failures,
      successRate: calls === 0 ? 1 : (calls - failures) / calls,
      p50: counted === 0 ? 0 : Math.round(weighted / counted),
      p95: maxP95
    }
  })

  const unsubscribe = source.subscribe(patch => {
    if (patch.type === 'sessions') {
      sessions.value = patch.sessions
      return
    }

    if (patch.type === 'reset') {
      const fresh = source.snapshot()
      events.value = fresh.events.slice()
      sessions.value = fresh.sessions.slice()
      buckets.clear()
      for (const event of [...fresh.events].reverse()) recordTool(buckets, event)
      tools.value = toToolStats(buckets)
      droppedWhilePaused.value = 0
      revision.value += 1
      return
    }

    if (paused.value) {
      droppedWhilePaused.value += 1
      return
    }

    const next = [patch.event, ...events.value]
    events.value = next.length > EVENT_LIMIT ? next.slice(0, EVENT_LIMIT) : next
    if (recordTool(buckets, patch.event)) tools.value = toToolStats(buckets)
    revision.value += 1
  })

  return {
    source,
    events,
    sessions,
    tools,
    paused,
    droppedWhilePaused,
    revision,
    totals,
    pause(): void {
      paused.value = true
    },
    resume(): void {
      paused.value = false
      droppedWhilePaused.value = 0
    },
    clear(): void {
      events.value = []
      buckets.clear()
      tools.value = []
      revision.value += 1
    },
    dispose(): void {
      unsubscribe()
      source.dispose()
    }
  }
}

/* -------------------------------------------------------------- 演示数据源 */

export interface SyntheticSourceOptions {
  seed?: number
  /** tick 的默认步数。 */
  stepsPerTick?: number
  /** 起始时间，便于测试固定时间轴。 */
  startTime?: number
}

export interface SyntheticSource extends ConsoleSource {
  /** 手动推进，便于测试与"暂停后单步"的演示。 */
  tick(steps?: number): void
}

interface SyntheticSessionSeed {
  id: string
  title: string
  state: SessionState
  tokens: number
  durationMs: number
}

const SYNTHETIC_SESSIONS: readonly SyntheticSessionSeed[] = [
  { id: 's-51aaec91', title: 'DSH 插件接入方案', state: 'run', tokens: 41_200, durationMs: 138_000 },
  { id: 's-2f0d1c33', title: 'KitSidebar 菜单钉靠', state: 'run', tokens: 27_600, durationMs: 64_000 },
  { id: 's-8b71e204', title: 'Combobox 方向对齐', state: 'wait', tokens: 18_100, durationMs: 96_000 },
  { id: 's-4c9a77de', title: 'runtime SVG namespace', state: 'run', tokens: 53_900, durationMs: 221_000 },
  { id: 's-77e0b218', title: 'compiler 多态插入重构', state: 'ok', tokens: 12_400, durationMs: 51_000 },
  { id: 's-1d3f5a90', title: 'npm release 1.7.5', state: 'ok', tokens: 8_900, durationMs: 33_000 },
  { id: 's-9a2c4e61', title: '表格列设置持久化', state: 'idle', tokens: 0, durationMs: 0 },
  { id: 's-6f5b8d02', title: 'i18n 回退链', state: 'idle', tokens: 0, durationMs: 0 }
]

const SYNTHETIC_TOOLS: readonly { name: string; base: number; spread: number; failureRate: number }[] = [
  { name: 'read', base: 6, spread: 14, failureRate: 0 },
  { name: 'grep', base: 18, spread: 70, failureRate: 0 },
  { name: 'pwsh', base: 420, spread: 3600, failureRate: 0.04 },
  { name: 'edit', base: 4, spread: 9, failureRate: 0 },
  { name: 'glob', base: 9, spread: 22, failureRate: 0 },
  { name: 'write', base: 5, spread: 12, failureRate: 0 },
  { name: 'web_search', base: 1200, spread: 1900, failureRate: 0 },
  { name: 'web_fetch', base: 640, spread: 1700, failureRate: 0.07 },
  { name: 'subagent', base: 48_000, spread: 82_000, failureRate: 0 },
  { name: 'todo_write', base: 3, spread: 5, failureRate: 0 },
  { name: 'present', base: 2, spread: 3, failureRate: 0 }
]

const SYNTHETIC_DETAILS: Record<string, readonly string[]> = {
  read: ['packages/dsh/src/host.ts', 'packages/dsh/src/plugin.ts', 'package.json'],
  grep: ['/usr|pwsh/ · 9 处匹配 · 2 个文件', '/insertList|bindText/ · 14 处 · 5 个文件'],
  pwsh: ['node scripts/build-dsh-plugins.mjs', 'pnpm exec vitest --run packages/dsh', 'git status --porcelain'],
  edit: ['packages/dsh-plugin/src/client/index.tsx +18 −4', 'packages/dsh/src/vite.ts +41 −7'],
  glob: ['packages/dsh-console/src/**/*.tsx · 6 个文件'],
  write: ['lib/client.js · 57.9 KiB'],
  web_search: ['pnpm git subdirectory install', 'DSH plugin manifest'],
  web_fetch: ['https://pnpm.io/package-sources'],
  subagent: ['审查 @vobs/dsh 的纯度门禁实现'],
  todo_write: ['3 项待办 · 1 项进行中'],
  present: ['01-console-overview.png']
}

/** 确定性 PRNG（mulberry32），保证同一 seed 下测试与预览完全可复现。 */
function createRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * 演示数据源：按确定性随机生成一批像样的 DSH 运行事件。
 *
 * 存在的意义有两个：
 *   1. 真实事件流接线完成前，Console 本身可以被开发、被测试、被演示；
 *   2. 它是「事件风暴」的现成压测夹具 —— `tick(200)` 就能一次灌 200 条。
 *
 * 它**不是**真实数据，界面会通过 `note` 明确标注。
 */
export function createSyntheticSource(options: SyntheticSourceOptions = {}): SyntheticSource {
  const random = createRandom(options.seed ?? 20260101)
  const stepsPerTick = options.stepsPerTick ?? 2
  const baseTime = options.startTime ?? Date.now()
  let clock = baseTime - 60 * 60 * 1000
  let seq = 0

  // 会话按顺序轻微错开最近活动时间，保证列表顺序稳定可预期。
  const sessions: SessionSummary[] = SYNTHETIC_SESSIONS.map((session, index) => ({
    id: session.id,
    title: session.title,
    state: session.state,
    tokens: session.tokens,
    durationMs: session.durationMs,
    lastActivity: baseTime - index * 137_000
  }))

  const events: ConsoleEvent[] = []
  const listeners = new Set<(patch: ConsolePatch) => void>()
  let disposed = false

  const pick = <T,>(list: readonly T[]): T => list[Math.floor(random() * list.length)] as T

  const emit = (event: ConsoleEvent): void => {
    events.unshift(event)
    if (events.length > EVENT_LIMIT) events.pop()
    for (const listener of listeners) listener({ type: 'event', event })
  }

  const step = (): void => {
    const session = pick(SYNTHETIC_SESSIONS)
    clock += 120 + Math.floor(random() * 900)
    seq += 1

    const roll = random()
    if (roll < 0.08) {
      emit({
        seq,
        time: clock,
        sessionId: session.id,
        sessionTitle: session.title,
        kind: 'turn/start',
        detail: 'deepseek-flash · reasoning high',
        status: 'run'
      })
      return
    }
    if (roll < 0.16) {
      const tokens = 8_000 + Math.floor(random() * 60_000)
      emit({
        seq,
        time: clock,
        sessionId: session.id,
        sessionTitle: session.title,
        kind: 'turn/end',
        detail: `reason: completed · ${formatTokens(tokens)} tok`,
        durationMs: 20_000 + Math.floor(random() * 200_000),
        status: 'ok'
      })
      return
    }
    if (roll < 0.2) {
      emit({
        seq,
        time: clock,
        sessionId: session.id,
        sessionTitle: session.title,
        kind: 'approval/request',
        detail: '等待用户批准 · pwsh 沙箱外写文件',
        durationMs: 1_000 + Math.floor(random() * 30_000),
        status: 'warn'
      })
      return
    }

    const tool = pick(SYNTHETIC_TOOLS)
    const failed = random() < tool.failureRate
    const duration = Math.round(tool.base + random() * tool.spread)
    emit({
      seq,
      time: clock,
      sessionId: session.id,
      sessionTitle: session.title,
      kind: 'tool/end',
      tool: tool.name,
      detail: pick(SYNTHETIC_DETAILS[tool.name] ?? ['—']),
      durationMs: duration,
      status: failed ? 'err' : 'ok'
    })
  }

  return {
    kind: 'synthetic',
    label: '演示数据',
    note: '未接入 DSH 事件流，以下内容由本地确定性生成器产出，仅用于预览与压测。',
    tick(steps = stepsPerTick): void {
      if (disposed) return
      for (let index = 0; index < steps; index += 1) step()
    },
    snapshot(): ConsoleSnapshot {
      return { events: [...events], sessions: [...sessions] }
    },
    subscribe(listener): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    dispose(): void {
      disposed = true
      listeners.clear()
    }
  }
}

/* ---------------------------------------------------------- DSH 真实数据源 */

export interface ConsoleServiceProbe {
  /** 是否探测到 DSH 的 session-controller 客户端服务。 */
  liveServiceFound: boolean
  /** 面向使用者的状态说明，会渲染在界面上。 */
  note: string
}

/* ------------------------------------------------------------ DSH 真实服务 */

/**
 * `@deepseek-ai/dsh-api-session-controller` 在客户端提供的服务面。
 *
 * 方法名与行字段都是从已安装 DSH 的 `lib/client.js` 里读出来的（`ClientSessions`
 * 通过 `rootCtx.reflect.provide("sessions", this, void 0)` 发布）：
 *   - `list`：快照仓库，`getSnapshot()` → `{ ids, byId, phase, projectionsBySession }`，
 *     行字段含 `sessionId / title / running / blank / updatedAt / parentSessionId / depth`；
 *   - `retainInfo(id)`：`{ getSnapshot, subscribe }`，给出 `retainedBy` 引用计数。
 *
 * 全部可选：字段缺失时按缺省处理，绝不因为 DSH 换了内部形状就崩。
 */
interface DshSessionSummaryLike {
  sessionId?: unknown
  id?: unknown
  title?: unknown
  running?: unknown
  blank?: unknown
  updatedAt?: unknown
  depth?: unknown
}

interface DshSnapshotStore<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

interface DshSessionListSnapshot {
  ids?: unknown
  byId?: Record<string, DshSessionSummaryLike>
  phase?: unknown
}

interface DshSessionStatusLike {
  running?: unknown
  removed?: unknown
  pendingInteraction?: unknown
}

interface DshSessionsService {
  list?: DshSnapshotStore<DshSessionListSnapshot>
}

interface DshUiSessionService {
  sessionStatus?: DshSnapshotStore<Map<string, DshSessionStatusLike>>
}

/** 从一行列表快照映射成 Console 的会话模型。 */
function toSessionSummary(
  id: string,
  row: DshSessionSummaryLike,
  status: DshSessionStatusLike | undefined
): SessionSummary {
  const removed = status?.removed === true
  const pending = status?.pendingInteraction !== undefined && status?.pendingInteraction !== null
  const running = row.running === true || status?.running === true

  let state: SessionState = 'idle'
  if (!removed) {
    if (pending) state = 'wait'
    else if (running) state = 'run'
  }

  return {
    id,
    title: typeof row.title === 'string' && row.title !== '' ? row.title : id,
    state,
    // 会话级列表快照里没有 token / 耗时；这两项保持 0，界面显示为「—」。
    tokens: 0,
    durationMs: 0,
    lastActivity: typeof row.updatedAt === 'number' ? row.updatedAt : 0
  }
}

function buildSessions(
  list: DshSessionListSnapshot,
  statusMap: Map<string, DshSessionStatusLike> | undefined
): SessionSummary[] {
  const byId = list.byId ?? {}
  const ids = Array.isArray(list.ids) ? (list.ids as unknown[]).map(String) : Object.keys(byId)
  const rows = ids.length > 0 ? ids : Object.keys(byId)
  return rows
    .map(id => {
      const row = byId[id]
      return row === undefined ? undefined : toSessionSummary(id, row, statusMap?.get(id))
    })
    .filter((value): value is SessionSummary => value !== undefined)
    .sort((a, b) => b.lastActivity - a.lastActivity)
}

export interface DshSourceOptions {
  /** 每个会话保留的事件上限（防止长时间运行把内存吃光）。 */
  historyLimit?: number
}

/**
 * 从 DSH 的真实客户端服务构造数据源；服务不在就返回 `undefined`，由调用方回退。
 *
 * **能拿到什么**：会话目录（标题、更新时间、是否运行、是否等待审批）与它们的实时变更。
 * **拿不到什么**：逐会话的 token / 耗时，以及工具级事件 —— 前者不在列表快照里，
 * 后者要 `retain()` 打开每个会话来跟事件流。DSH 自己刻意避免「为了列表去打开冷会话」，
 * 本适配器同样不越这条线：它只做**目录级**观测，并把这件事如实写在来源说明里。
 */
export function createDshSource(
  ctx: DshClientContext | undefined,
  options: DshSourceOptions = {}
): ConsoleSource | undefined {
  const sessions = ctx?.get?.('sessions') as DshSessionsService | undefined
  const list = sessions?.list
  if (list === undefined || typeof list.getSnapshot !== 'function' || typeof list.subscribe !== 'function') {
    return undefined
  }

  const uiSession = ctx?.get?.('uiSession') as DshUiSessionService | undefined
  const statusStore = uiSession?.sessionStatus

  const listeners = new Set<(patch: ConsolePatch) => void>()
  const historyLimit = options.historyLimit ?? 200
  const events: ConsoleEvent[] = []
  let seq = 0
  let disposed = false

  /** 上一次观测到的会话状态，用来把「变化」变成事件。 */
  const previous = new Map<string, { state: SessionState; title: string }>()
  let current: readonly SessionSummary[] = []

  const emit = (event: ConsoleEvent): void => {
    events.unshift(event)
    if (events.length > historyLimit) events.pop()
    for (const listener of listeners) listener({ type: 'event', event })
  }

  const readSessions = (): SessionSummary[] =>
    buildSessions(list.getSnapshot(), statusStore?.getSnapshot())

  const eventFor = (
    summary: SessionSummary,
    before: { state: SessionState; title: string } | undefined
  ): ConsoleEvent | undefined => {
    seq += 1
    const base = {
      seq,
      time: summary.lastActivity > 0 ? summary.lastActivity : Date.now(),
      sessionId: summary.id,
      sessionTitle: summary.title
    }

    if (before === undefined) {
      return { ...base, kind: 'session/open', detail: '会话进入目录', status: 'ok' }
    }
    if (before.state !== summary.state) {
      if (summary.state === 'run') return { ...base, kind: 'turn/start', detail: '会话开始运行', status: 'run' }
      if (summary.state === 'wait') {
        return { ...base, kind: 'approval/request', detail: '等待用户输入或批准', status: 'warn' }
      }
      return { ...base, kind: 'turn/end', detail: '会话停止运行', status: 'ok' }
    }
    if (before.title !== summary.title) {
      return { ...base, kind: 'session/update', detail: `标题更新为「${summary.title}」`, status: 'ok' }
    }
    return undefined
  }

  const refresh = (emitEvents: boolean): void => {
    if (disposed) return
    const next = readSessions()
    current = next

    if (emitEvents) {
      const seen = new Set<string>()
      for (const summary of next) {
        seen.add(summary.id)
        const event = eventFor(summary, previous.get(summary.id))
        if (event !== undefined) emit(event)
      }
      for (const [id, before] of [...previous]) {
        if (seen.has(id)) continue
        seq += 1
        emit({
          seq,
          time: Date.now(),
          sessionId: id,
          sessionTitle: before.title,
          kind: 'session/close',
          detail: '会话离开目录',
          status: 'ok'
        })
      }
    }

    previous.clear()
    for (const summary of next) previous.set(summary.id, { state: summary.state, title: summary.title })
    for (const listener of listeners) listener({ type: 'sessions', sessions: next })
  }

  // 首次读数：只建基线，不造事件（否则一进页面就刷一屏历史）
  refresh(false)

  const unsubscribes: Array<() => void> = []
  try {
    unsubscribes.push(list.subscribe(() => refresh(true)))
    if (statusStore !== undefined) unsubscribes.push(statusStore.subscribe(() => refresh(true)))
  } catch {
    // 订阅失败不致命：至少保留首次快照
  }

  return {
    kind: 'dsh',
    label: 'DSH 运行态',
    note: '数据来自 DSH 的 sessions / uiSession 服务，为**会话级**观测：列表、运行状态与等待审批。token 与工具级事件不在目录快照里，因此显示为「—」。',
    snapshot(): ConsoleSnapshot {
      return { events: [...events], sessions: [...current] }
    },
    subscribe(listener): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    dispose(): void {
      disposed = true
      for (const unsubscribe of unsubscribes) {
        try {
          unsubscribe()
        } catch {
          // 忽略
        }
      }
      listeners.clear()
    }
  }
}

/* ------------------------------------------------------------ 数据源选择 */

export interface ConsoleSourceSelection {
  source: ConsoleSource
  /** 界面上的来源说明。 */
  note: string
}

/**
 * 选择数据源：能用真实服务就用真实的，否则退回演示数据并如实标注。
 *
 * @param ctx - DSH 客户端上下文
 * @param fallback - 复用调用方已经建好的演示源；不给就新建一个
 */
export function selectConsoleSource(
  ctx: DshClientContext | undefined,
  fallback?: ConsoleSource
): ConsoleSourceSelection {
  const live = createDshSource(ctx)
  if (live !== undefined) {
    return {
      source: live,
      note: `${live.note}（未打开任何会话，因此不采集逐会话的工具事件）`
    }
  }
  const demo = fallback ?? createSyntheticSource()
  return {
    source: demo,
    note: `${demo.note}未探测到 DSH 的 sessions 服务。`
  }
}

/**
 * 可热替换的数据源：Console 先以演示数据建好，一旦 `setup(ctx)` 探测到真实服务，
 * 就整体切过去并广播 `reset`，让商店丢掉演示数据、按真实源重建。
 */
export interface SwitchableSource extends ConsoleSource {
  switchTo(next: ConsoleSource): void
  readonly active: ConsoleSource
}

export function createSwitchableSource(initial: ConsoleSource): SwitchableSource {
  const listeners = new Set<(patch: ConsolePatch) => void>()
  let active = initial
  let unsubscribeInner = subscribeInner(active)

  function subscribeInner(source: ConsoleSource): () => void {
    return source.subscribe(patch => {
      // 只有当前生效的源才能推进状态
      if (source !== active) return
      for (const listener of listeners) listener(patch)
    })
  }

  return {
    get kind() {
      return active.kind
    },
    get label() {
      return active.label
    },
    get note() {
      return active.note
    },
    get active() {
      return active
    },
    switchTo(next: ConsoleSource): void {
      if (next === active) return
      unsubscribeInner()
      active.dispose()
      active = next
      unsubscribeInner = subscribeInner(active)
      for (const listener of listeners) listener({ type: 'reset' })
    },
    snapshot: () => active.snapshot(),
    subscribe(listener): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    dispose(): void {
      unsubscribeInner()
      active.dispose()
      listeners.clear()
    }
  }
}
