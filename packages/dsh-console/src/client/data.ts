import { memo, state, type ReadableSignal, type Signal } from '@vobs/vobs'
import type { DshClientContext } from '@vobs/dsh'

/* ------------------------------------------------------------------ Data model */

export type ConsoleEventStatus = 'ok' | 'warn' | 'err' | 'run'

/** One run-state event. Fields are deliberately flat for direct mapping from DSH's session event stream. */
export interface ConsoleEvent {
  /** Globally increasing sequence number; used as the keyed list key. */
  seq: number
  /** Epoch milliseconds. */
  time: number
  sessionId: string
  sessionTitle: string
  /** Event kind, following DSH's naming: turn/start, tool/end, approval/request … */
  kind: string
  detail: string
  durationMs?: number
  status?: ConsoleEventStatus
  /** Which tool this event belongs to (only for tool/start, tool/end). */
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
  /** Duration samples of the most recent calls, for drawing the mini trend line. */
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
  /** The data source was swapped (e.g. demo data → real services): drop existing aggregates and rebuild from the new source. */
  | { type: 'reset' }

/**
 * Data source. The UI only knows this interface, so "switching to real data" never touches view code.
 *
 * `note` is rendered as the on-screen source status note — demo data must identify itself,
 * never letting the viewer mistake it for real run states.
 */
export interface ConsoleSource {
  readonly kind: 'synthetic' | 'dsh'
  readonly label: string
  readonly note: string
  snapshot(): ConsoleSnapshot
  subscribe(listener: (patch: ConsolePatch) => void): () => void
  dispose(): void
}

/* -------------------------------------------------------------------- Constants */

/** Ring-buffer cap for events: beyond it the oldest are dropped, so long runs cannot exhaust memory. */
export const EVENT_LIMIT = 5000

/** Duration samples kept per tool, for computing P50/P95. */
export const TOOL_SAMPLE_LIMIT = 240

/** Number of recent calls kept for the trend line. */
export const TREND_LENGTH = 24

/* ------------------------------------------------------------------ Formatting */

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
 * Folds a list of numbers into an SVG polyline path. Returns the `<path d>` value; a pure
 * function, unit-testable.
 *
 * @param values - number sequence
 * @param width - target width
 * @param height - target height
 * @param padding - vertical padding so the line does not hug the edges
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

/* -------------------------------------------------------------- Tool aggregation */

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
        // Every tool/end pushes exactly one duration sample; failures are a subset and must not be double-counted.
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
 * Folds one event into the tool stats. Only `tool/end` counts as a call:
 * `tool/start` is just a beginning, with neither a duration nor a call count.
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

/* -------------------------------------------------------------------- Store */

export interface ConsoleStore {
  readonly source: ConsoleSource
  readonly events: Signal<readonly ConsoleEvent[]>
  readonly sessions: Signal<readonly SessionSummary[]>
  readonly tools: Signal<readonly ToolStat[]>
  readonly paused: Signal<boolean>
  /** Number of events dropped while paused; reset to zero on resume. */
  readonly droppedWhilePaused: Signal<number>
  readonly revision: Signal<number>
  readonly totals: ReadableSignal<ToolTotals>
  pause(): void
  resume(): void
  clear(): void
  dispose(): void
}

/**
 * Folds the data source's events into the three pieces of state the UI needs: the event
 * buffer, the session list, and the tool aggregates.
 *
 * Tool stats are maintained **incrementally**: each `tool/end` only updates its own bucket,
 * never rescanning all events just to compute a P95.
 */
export function createConsoleStore(source: ConsoleSource): ConsoleStore {
  const seed = source.snapshot()
  const events = state<readonly ConsoleEvent[]>(seed.events.slice(), 'events')
  const sessions = state<readonly SessionSummary[]>(seed.sessions.slice(), 'sessions')
  const paused = state(false, 'paused')
  const droppedWhilePaused = state(0, 'droppedWhilePaused')
  const revision = state(0, 'revision')

  const buckets = new Map<string, ToolBucket>()
  for (const event of [...seed.events].reverse()) recordTool(buckets, event)
  const tools = state<readonly ToolStat[]>(toToolStats(buckets), 'tools')

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

/* -------------------------------------------------------------- Demo data source */

export interface SyntheticSourceOptions {
  seed?: number
  /** Default number of steps per tick. */
  stepsPerTick?: number
  /** Start time, handy for pinning the timeline in tests. */
  startTime?: number
}

export interface SyntheticSource extends ConsoleSource {
  /** Advance manually; handy for tests and the "single step after pause" demo. */
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
  { id: 's-51aaec91', title: 'DSH plugin integration plan', state: 'run', tokens: 41_200, durationMs: 138_000 },
  { id: 's-2f0d1c33', title: 'KitSidebar menu pinning', state: 'run', tokens: 27_600, durationMs: 64_000 },
  { id: 's-8b71e204', title: 'Combobox direction alignment', state: 'wait', tokens: 18_100, durationMs: 96_000 },
  { id: 's-4c9a77de', title: 'runtime SVG namespace', state: 'run', tokens: 53_900, durationMs: 221_000 },
  { id: 's-77e0b218', title: 'compiler polymorphic insert refactor', state: 'ok', tokens: 12_400, durationMs: 51_000 },
  { id: 's-1d3f5a90', title: 'npm release 1.7.5', state: 'ok', tokens: 8_900, durationMs: 33_000 },
  { id: 's-9a2c4e61', title: 'table column settings persistence', state: 'idle', tokens: 0, durationMs: 0 },
  { id: 's-6f5b8d02', title: 'i18n fallback chain', state: 'idle', tokens: 0, durationMs: 0 }
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
  grep: ['/usr|pwsh/ · 9 matches · 2 files', '/insertList|bindText/ · 14 matches · 5 files'],
  pwsh: ['node scripts/build-dsh-plugins.mjs', 'pnpm exec vitest --run packages/dsh', 'git status --porcelain'],
  edit: ['packages/dsh-plugin/src/client/index.tsx +18 −4', 'packages/dsh/src/vite.ts +41 −7'],
  glob: ['packages/dsh-console/src/**/*.tsx · 6 files'],
  write: ['lib/client.js · 57.9 KiB'],
  web_search: ['pnpm git subdirectory install', 'DSH plugin manifest'],
  web_fetch: ['https://pnpm.io/package-sources'],
  subagent: ['review @vobs/dsh purity gate implementation'],
  todo_write: ['3 todos · 1 in progress'],
  present: ['01-console-overview.png']
}

/** Deterministic PRNG (mulberry32); guarantees full reproducibility for tests and previews under the same seed. */
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
 * Demo data source: generates a batch of plausible DSH run events with deterministic randomness.
 *
 * Its two reasons to exist:
 *   1. Until the real event stream is wired up, the Console itself can be developed, tested, and demonstrated;
 *   2. It is a ready-made stress fixture for "event storms" — `tick(200)` pours in 200 events at once.
 *
 * It is **not** real data; the UI says so explicitly via `note`.
 */
export function createSyntheticSource(options: SyntheticSourceOptions = {}): SyntheticSource {
  const random = createRandom(options.seed ?? 20260101)
  const stepsPerTick = options.stepsPerTick ?? 2
  const baseTime = options.startTime ?? Date.now()
  let clock = baseTime - 60 * 60 * 1000
  let seq = 0

  // Sessions get slightly staggered last-activity times in order, keeping the list order stable and predictable.
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
        detail: 'awaiting user approval · pwsh writing outside sandbox',
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
    label: 'Demo data',
    note: "Not connected to DSH's event stream; the content below is produced by a local deterministic generator, for preview and stress testing only.",
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

/* ---------------------------------------------------------- DSH real data source */

export interface ConsoleServiceProbe {
  /** Whether DSH's session-controller client service was detected. */
  liveServiceFound: boolean
  /** User-facing status note, rendered on screen. */
  note: string
}

/* ------------------------------------------------------------ DSH real services */

/**
 * The service surface `@deepseek-ai/dsh-api-session-controller` provides on the client.
 *
 * Method names and row fields were read from the installed DSH's `lib/client.js` (`ClientSessions`
 * publishes itself via `rootCtx.reflect.provide("sessions", this, void 0)`):
 *   - `list`: snapshot store, `getSnapshot()` → `{ ids, byId, phase, projectionsBySession }`,
 *     row fields include `sessionId / title / running / blank / updatedAt / parentSessionId / depth`;
 *   - `retainInfo(id)`: `{ getSnapshot, subscribe }`, giving the `retainedBy` reference count.
 *
 * Everything is optional: missing fields fall back to defaults, never crashing because DSH
 * changed its internal shape.
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

/** Maps one row of the list snapshot into the Console's session model. */
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
    // Session-level list snapshots carry no tokens / durations; these stay 0 and render as "—".
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
  /** Event history cap per session (prevents long runs from exhausting memory). */
  historyLimit?: number
}

/**
 * Builds a data source from DSH's real client services; returns `undefined` when the services
 * are absent, letting the caller fall back.
 *
 * **What you get**: the session catalog (titles, update times, running, awaiting approval) and
 * their live changes.
 * **What you don't**: per-session tokens / durations and tool-level events — the former is not
 * in the list snapshot, and the latter would require `retain()`-ing every session to follow its
 * event stream. DSH itself deliberately avoids "opening cold sessions just to list them",
 * and this adapter does not cross that line either: it only observes at the **catalog** level
 * and says so honestly in the source note.
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

  /** Last observed session states, used to turn "changes" into events. */
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
      return { ...base, kind: 'session/open', detail: 'session entered the catalog', status: 'ok' }
    }
    if (before.state !== summary.state) {
      if (summary.state === 'run') return { ...base, kind: 'turn/start', detail: 'session started running', status: 'run' }
      if (summary.state === 'wait') {
        return { ...base, kind: 'approval/request', detail: 'awaiting user input or approval', status: 'warn' }
      }
      return { ...base, kind: 'turn/end', detail: 'session stopped running', status: 'ok' }
    }
    if (before.title !== summary.title) {
      return { ...base, kind: 'session/update', detail: `title updated to "${summary.title}"`, status: 'ok' }
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
          detail: 'session left the catalog',
          status: 'ok'
        })
      }
    }

    previous.clear()
    for (const summary of next) previous.set(summary.id, { state: summary.state, title: summary.title })
    for (const listener of listeners) listener({ type: 'sessions', sessions: next })
  }

  // First read: build the baseline only, no synthetic events (otherwise the page floods with history on entry)
  refresh(false)

  const unsubscribes: Array<() => void> = []
  try {
    unsubscribes.push(list.subscribe(() => refresh(true)))
    if (statusStore !== undefined) unsubscribes.push(statusStore.subscribe(() => refresh(true)))
  } catch {
    // Subscription failure is not fatal: at least the first snapshot is kept
  }

  return {
    kind: 'dsh',
    label: 'DSH run states',
    note: "Data comes from DSH's sessions / uiSession services and is a **session-level** observation: list, run states, and awaiting approval. Tokens and tool-level events are not in the catalog snapshot, so they render as an em dash.",
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
          // ignored
        }
      }
      listeners.clear()
    }
  }
}

/* ------------------------------------------------------------ Source selection */

export interface ConsoleSourceSelection {
  source: ConsoleSource
  /** The on-screen source note. */
  note: string
}

/**
 * Pick a data source: use real services when available, otherwise fall back to demo data, labeled honestly.
 *
 * @param ctx - DSH client context
 * @param fallback - reuse a demo source the caller already built; a new one is created if omitted
 */
export function selectConsoleSource(
  ctx: DshClientContext | undefined,
  fallback?: ConsoleSource
): ConsoleSourceSelection {
  const live = createDshSource(ctx)
  if (live !== undefined) {
    return {
      source: live,
      note: `${live.note} (no sessions opened, so per-session tool events are not collected)`
    }
  }
  const demo = fallback ?? createSyntheticSource()
  return {
    source: demo,
    note: `${demo.note}DSH's sessions service was not detected.`
  }
}

/**
 * Hot-swappable data source: the Console starts on demo data, and once `setup(ctx)` detects
 * real services it switches wholesale and broadcasts `reset`, so the store drops the demo data
 * and rebuilds from the real source.
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
      // Only the currently active source may advance state
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
