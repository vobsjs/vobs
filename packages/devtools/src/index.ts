import {
  getDebugHooks,
  getOwnerDebugName,
  getSignalDebugName,
  setDebugHooks,
  untrack,
  type Dependency,
  type Effect,
  type Owner,
  type ReactivityDebugHooks,
  type Signal,
  type Subscriber
} from '@vobs/reactivity'
import {
  getRuntimeDebugHooks,
  getRuntimeDebugContext,
  setRuntimeDebugHooks,
  type RuntimeDebugHooks,
  type RuntimeDomMutation,
  type RuntimeErrorEvent,
  type RuntimeHydrationMismatch
} from '@vobs/runtime'
import { normalizeVobsError } from '@vobs/runtime'
import type { VobsContext, VobsPlugin } from '@vobs/vobs'
import {
  getHTTPDebugHooks,
  setHTTPDebugHooks,
  type HTTPDebugRequest
} from '@vobs/http'

export type DependencyEdgeType =
  | 'state-to-effect'
  | 'state-to-memo'
  | 'memo-to-effect'
  | 'memo-to-memo'

export interface ComponentDebugNode {
  readonly id: string
  readonly name: string
  readonly ownerId: string
  readonly signals: readonly string[]
  readonly effects: readonly string[]
  readonly recentUpdates: readonly string[]
  readonly domUpdates: number
  readonly children: readonly ComponentDebugNode[]
  readonly mounted: boolean
}

export interface SignalDebugInfo {
  readonly id: string
  readonly name: string
  readonly value: unknown
  readonly component: string
  readonly subscribers: number
  readonly createdAt: number
  readonly kind?: 'state' | 'memo'
}

export interface DebugErrorInfo {
  readonly name: string
  readonly message: string
  readonly stack?: string
  readonly phase?: string
  readonly source?: string
  readonly code?: string
  readonly hint?: string
  readonly cause?: string
  readonly fix?: string
  readonly location?: { readonly file: string; readonly line: number; readonly column: number }
  readonly hydration?: RuntimeHydrationMismatch
}

export interface EffectDebugInfo {
  readonly id: string
  readonly name: string
  readonly component: string
  readonly dependencies: readonly string[]
  readonly status: 'idle' | 'dirty' | 'running' | 'success' | 'error'
  readonly executionCount: number
  readonly lastExecutionTime: number
  readonly lastRunStatus?: 'success' | 'error' | 'cancelled'
  readonly lastDuration?: number
  readonly lastUpdateId?: string
  readonly lastError?: DebugErrorInfo
  readonly lastDomUpdates?: number
}

export interface DependencyEdge {
  readonly from: string
  readonly to: string
  readonly type: DependencyEdgeType
}

export interface EffectExecutionInfo {
  readonly effectId: string
  readonly component: string
  readonly duration: number
  readonly domUpdates: number
  readonly status?: 'success' | 'error' | 'cancelled'
  readonly error?: DebugErrorInfo
}

export interface DomUpdateInfo {
  readonly operation: 'text' | 'property' | 'attribute' | 'insert' | 'remove'
  readonly target: string
  readonly parent?: string
  readonly key?: string
  readonly previousValue?: unknown
  readonly nextValue?: unknown
  readonly effectId?: string
  readonly route?: string
  readonly navigationId?: number
  readonly requestId?: number
}

export interface UpdateTrace {
  readonly id: string
  readonly signalId: string
  readonly signalName: string
  readonly previousValue: unknown
  readonly nextValue: unknown
  readonly timestamp: number
  readonly effects: readonly EffectExecutionInfo[]
  readonly affectedSignals: readonly string[]
  readonly affectedEffects: readonly string[]
  readonly domUpdates: readonly DomUpdateInfo[]
  readonly status: 'completed' | 'error' | 'cancelled'
  readonly error?: DebugErrorInfo
  readonly duration: number
  readonly route?: string
  readonly navigationId?: number
  readonly requestIds?: readonly number[]
}

export type LifecycleEventType =
  | 'owner-created' | 'owner-named' | 'owner-disposed'
  | 'signal-created' | 'signal-named' | 'signal-changed' | 'signal-disposed'
  | 'memo-created' | 'memo-invalidated'
  | 'effect-created' | 'effect-invalidated' | 'effect-run-start' | 'effect-run' | 'effect-disposed'

export interface LifecycleEvent {
  readonly id: string
  readonly type: LifecycleEventType
  readonly timestamp: number
  readonly targetId: string
  readonly name?: string
  readonly ownerId?: string
  readonly status?: 'success' | 'error' | 'cancelled'
}

export interface NetworkRequestTrace {
  readonly id: number
  readonly url: string
  readonly method: string
  readonly status: 'loading' | 'retrying' | 'success' | 'error' | 'cancelled'
  readonly headers: Readonly<Record<string, string>>
  readonly requestBody?: unknown
  readonly startedAt: number
  readonly endedAt?: number
  readonly duration?: number
  readonly attempt: number
  readonly retries: number
  readonly responseStatus?: number
  readonly responseBody?: unknown
  readonly error?: { readonly name: string; readonly message: string }
  readonly source?: 'http' | 'router' | 'ssr'
  readonly test?: boolean
  readonly route?: string
  readonly navigationId?: number
  readonly dataRequestId?: number
  readonly environment?: 'client' | 'server'
}

export type DevToolsErrorPhase = 'effect' | 'network' | 'global' | 'unhandledrejection' | 'route' | 'hydration' | 'render' | 'boundary' | 'application' | 'event'
export type DevToolsErrorOrigin = 'framework' | 'usage' | 'application' | 'unknown'
export type DevToolsErrorRecovery = 'propagated' | 'handled' | 'fallback' | 'retrying' | 'recovered'

export interface DevToolsErrorContext {
  readonly updateId?: string
  readonly effectId?: string
  readonly requestId?: number
  readonly navigationId?: number
  readonly route?: string
  readonly source?: string
  readonly ownerId?: string
  readonly component?: string
  readonly origin?: DevToolsErrorOrigin
  readonly code?: string
  readonly hint?: string
  readonly handled?: boolean
  readonly recovery?: DevToolsErrorRecovery
}

export interface DevToolsErrorTrace extends DebugErrorInfo {
  readonly id: number
  readonly phase: DevToolsErrorPhase
  readonly firstOccurredAt: number
  readonly lastOccurredAt: number
  readonly count: number
  readonly phases: readonly DevToolsErrorPhase[]
  readonly origin: DevToolsErrorOrigin
  readonly handled: boolean
  readonly recovery: DevToolsErrorRecovery
  readonly updateId?: string
  readonly effectId?: string
  readonly requestId?: number
  readonly navigationId?: number
  readonly route?: string
  readonly ownerId?: string
  readonly component?: string
}

export interface DevToolsCollectionState {
  readonly paused: boolean
}

export interface DevToolsPrivacyOptions {
  /** Additional case-insensitive header names or fragments to omit. */
  readonly redactedHeaders?: readonly string[]
  /** Object keys whose values are replaced in captured/exported values. */
  readonly redactedFields?: readonly string[]
  /** Replace DOM values in diagnostics with the configured replacement. */
  readonly redactDomValues?: boolean
  readonly replacement?: string
}

export interface DevToolsPerformanceEntry {
  readonly kind: 'update' | 'effect' | 'request'
  readonly id: string | number
  readonly label: string
  readonly duration: number
  readonly timestamp: number
  readonly status: string
}

export interface DevToolsInspector {
  readonly label?: string
  inspect(value: unknown): unknown
}

export interface DevToolsTimeline {
  readonly label?: string
  readonly getEvents?: () => readonly DevToolsTimelineEvent[]
}

export interface DevToolsTimelineEvent {
  readonly id: string
  readonly timestamp: number
  readonly title: string
  readonly data?: unknown
}

export interface DevToolsMetric {
  readonly label?: string
  read(): number | string
}

export interface DevToolsExtensionSnapshot {
  readonly inspectors: readonly string[]
  readonly timelines: readonly string[]
  readonly timelineEvents: Readonly<Record<string, readonly DevToolsTimelineEvent[]>>
  readonly metrics: Readonly<Record<string, number | string>>
}

export interface DevToolsDiagnosticSnapshot {
  readonly version: 1
  readonly exportedAt: number
  readonly updates: readonly UpdateTrace[]
  readonly lifecycle: readonly LifecycleEvent[]
  readonly network: readonly NetworkRequestTrace[]
  readonly errors: readonly DevToolsErrorTrace[]
  readonly performance: PerformanceMetrics
  readonly memory: MemorySnapshot
  readonly extensions: DevToolsExtensionSnapshot
}

export interface DevToolsSSRRequestSnapshot {
  readonly version: 1
  readonly environment: 'server'
  readonly requests: readonly HTTPDebugRequest[]
}

export type DevToolsSelection =
  | { readonly type: 'component'; readonly id: string }
  | { readonly type: 'signal'; readonly id: string }
  | { readonly type: 'effect'; readonly id: string }
  | { readonly type: 'update'; readonly id: string }
  | { readonly type: 'request'; readonly id: number }
  | { readonly type: 'error'; readonly id: number }

export const DEVTOOLS_REACTIVITY_EVENTS = [
  'owner-created', 'owner-named', 'owner-disposed',
  'signal-created', 'signal-named', 'signal-update', 'signal-disposed',
  'effect-created', 'effect-invalidated', 'effect-run-start', 'effect-run', 'effect-disposed',
  'memo-created', 'memo-update', 'update'
] as const

export const DEVTOOLS_EVENTS = [...DEVTOOLS_REACTIVITY_EVENTS, 'lifecycle', 'dom-update', 'network-request', 'router', 'error', 'collection', 'collection-cleared', 'extension'] as const

export interface PerformanceMetrics {
  readonly updateCount: number
  readonly averageUpdateDuration: number
  readonly slowUpdateCount: number
  readonly effectExecutionCount: number
  readonly slowEffectCount: number
  readonly slowRequestCount: number
  readonly maxUpdateDuration: number
  readonly maxEffectDuration: number
  readonly maxRequestDuration: number
}

export interface MemorySnapshot {
  readonly signalCount: number
  readonly effectCount: number
  readonly ownerCount: number
  readonly dependencyEdgeCount: number
  readonly leakedOwners: number
}

export interface DevToolsTarget {
  __VOBS_DEVTOOLS__?: DevToolsAPI
  addEventListener?: (type: string, listener: (...args: any[]) => void) => void
  removeEventListener?: (type: string, listener: (...args: any[]) => void) => void
}

export interface DevToolsOptions {
  readonly expose?: boolean
  readonly target?: DevToolsTarget
  readonly maxUpdates?: number
  readonly slowUpdateThreshold?: number
  readonly privacy?: DevToolsPrivacyOptions
  /** Explicit opt-in for state-changing debug actions. Disabled by default. */
  readonly allowMutations?: boolean
  /** Optional Router-like source for associating navigation/data events. */
  readonly router?: DevToolsRouterSource
}

export interface DevToolsRouterSource {
  readonly devtools: {
    subscribe(event: string, callback: (payload: unknown) => void): () => void
  }
}

export interface DevToolsAPI {
  getComponentTree(): readonly ComponentDebugNode[]
  getComponent(ownerId: string): ComponentDebugNode | null
  getSignals(): readonly SignalDebugInfo[]
  getSignal(signalId: string): SignalDebugInfo | null
  canMutate(): boolean
  setSignalValue(signalId: string, value: unknown): boolean
  getDependencies(signalId: string): readonly DependencyEdge[]
  getDependents(subscriberId: string): readonly DependencyEdge[]
  getEffects(): readonly EffectDebugInfo[]
  getUpdates(): readonly UpdateTrace[]
  getLifecycleEvents(): readonly LifecycleEvent[]
  getNetworkRequests(): readonly NetworkRequestTrace[]
  importSSRRequests(snapshot: unknown): void
  getRouterContext(): DevToolsRouterContext | null
  attachRouter(router: DevToolsRouterSource): () => void
  getErrors(): readonly DevToolsErrorTrace[]
  getPerformanceEntries(): readonly DevToolsPerformanceEntry[]
  getCollectionState(): DevToolsCollectionState
  setCollectionPaused(paused: boolean): void
  clearUpdates(): void
  clearNetworkRequests(): void
  clearErrors(): void
  clearLifecycleEvents(): void
  reportError(phase: DevToolsErrorPhase, error: unknown, context?: DevToolsErrorContext): void
  getPerformanceMetrics(): PerformanceMetrics
  takeMemorySnapshot(): MemorySnapshot
  exportDiagnostics(): DevToolsDiagnosticSnapshot
  importDiagnostics(snapshot: unknown): void
  registerInspector(id: string, inspector: DevToolsInspector): () => void
  registerTimeline(id: string, timeline?: DevToolsTimeline): () => void
  registerMetric(id: string, metric: DevToolsMetric): () => void
  getExtensionSnapshot(): DevToolsExtensionSnapshot
  inspectExtension(id: string, value: unknown): unknown
  onUpdate(callback: (trace: UpdateTrace) => void): () => void
  subscribe(event: string, callback: (...args: any[]) => void): () => void
  dispose(): void
}

export interface DevToolsRouterContext {
  readonly route?: string
  readonly navigationId?: number
  readonly navigationStatus?: string
  readonly dataRequests: readonly {
    readonly id: number
    readonly kind: string
    readonly key: string
    readonly route?: string
    readonly status: string
    readonly startedAt?: number
    readonly endedAt?: number
    readonly duration?: number
    readonly navigationId?: number
    readonly trigger?: string
    readonly result?: unknown
    readonly error?: string
    readonly environment?: 'client' | 'server'
  }[]
}

export interface DevToolsWireRequest {
  readonly source: 'vobs-devtools'
  readonly type: 'request'
  readonly id: string
  readonly method: string
  readonly args?: readonly unknown[]
}

export interface DevToolsWireResponse {
  readonly source: 'vobs-devtools'
  readonly type: 'response'
  readonly id: string
  readonly ok: boolean
  readonly result?: unknown
  readonly error?: string
}

export interface DevToolsWireEvent {
  readonly source: 'vobs-devtools'
  readonly type: 'event'
  readonly event: string
  readonly payload: unknown
}

export interface DevToolsMessageTarget {
  addEventListener(type: string, listener: (event: DevToolsMessageEvent) => void): void
  removeEventListener(type: string, listener: (event: DevToolsMessageEvent) => void): void
  postMessage(message: unknown, targetOrigin: string): void
}

export interface DevToolsMessageEvent {
  readonly data?: unknown
  readonly source?: unknown
}

export interface DevToolsBridgeOptions {
  readonly target?: DevToolsMessageTarget
  readonly api?: DevToolsAPI | null
}

export interface DevToolsPluginOptions extends DevToolsOptions {
  readonly enabled?: boolean
}

interface OwnerRecord {
  readonly owner: Owner
  readonly id: string
  readonly parentId: string | null
  name: string
  disposed: boolean
}

interface SignalRecord {
  readonly signal: Signal<unknown>
  readonly id: string
  readonly ownerId: string | null
  readonly createdAt: number
  name: string
  explicitName: boolean
  kind: 'state' | 'memo'
  disposed: boolean
}

interface EffectRecord {
  readonly effect: Effect
  readonly id: string
  readonly ownerId: string | null
  status: 'idle' | 'dirty' | 'running' | 'success' | 'error'
  executionCount: number
  lastExecutionTime: number
  lastRunStatus: 'success' | 'error' | 'cancelled' | undefined
  lastDuration: number
  lastUpdateId: string | undefined
  lastError: DebugErrorInfo | undefined
  lastDomUpdates: number
  runningSince: number | null
  disposed: boolean
}

interface PendingUpdate {
  readonly id: string
  readonly signal: SignalRecord
  readonly timestamp: number
  previousValue: unknown
  nextValue: unknown
  readonly affectedSignals: Set<string>
  readonly effectIds: Set<string>
  readonly executions: Map<string, EffectExecutionInfo>
  readonly domUpdates: DomUpdateInfo[]
  status: 'completed' | 'error' | 'cancelled'
  error: DebugErrorInfo | undefined
  context: {
    readonly route?: string
    readonly navigationId?: number
    readonly requestIds: Set<number>
  }
}

let activeDevTools: DevToolsAPI | null = null

export function createDevTools(options: DevToolsOptions = {}): DevToolsAPI {
  activeDevTools?.dispose()

  const owners = new Map<string, OwnerRecord>()
  const ownerIds = new WeakMap<object, string>()
  const signals = new Map<string, SignalRecord>()
  const signalIds = new WeakMap<object, string>()
  const effects = new Map<string, EffectRecord>()
  const effectIds = new WeakMap<object, string>()
  const memoSignalIds = new WeakMap<object, string>()
  const edges = new Map<string, DependencyEdge>()
  const listeners = new Map<string, Set<(...args: any[]) => void>>()
  const updates: UpdateTrace[] = []
  const lifecycleEvents: LifecycleEvent[] = []
  const networkRequests = new Map<number, NetworkRequestTrace>()
  const errors = new Map<string, DevToolsErrorTrace>()
  const inspectors = new Map<string, DevToolsInspector>()
  const timelines = new Map<string, DevToolsTimeline>()
  const metrics = new Map<string, DevToolsMetric>()
  let routerContext: DevToolsRouterContext | null = null
  const routerStops = new Map<DevToolsRouterSource, { readonly stop: () => void; refs: number }>()
  let nextErrorId = 1
  let collectionPaused = false
  const pendingUpdates: PendingUpdate[] = []
  const updateDurations: number[] = []
  const maxUpdates = Math.max(1, Math.floor(options.maxUpdates ?? 100))
  const slowUpdateThreshold = Math.max(0, options.slowUpdateThreshold ?? 16)
  let nextId = 1
  let updateCount = 0
  let effectExecutionCount = 0
  let disposed = false
  let pendingFlushScheduled = false
  let activeEffectId: string | null = null
  const privacy = normalizePrivacyOptions(options.privacy)
  const allowMutations = options.allowMutations === true

  function now(): number {
    return typeof performance === 'undefined' ? Date.now() : performance.now()
  }

  function emit(event: string, ...args: any[]): void {
    if (collectionPaused && event !== 'collection' && event !== 'collection-cleared') return
    const callbacks = [
      ...(listeners.get(event) ?? []),
      ...(listeners.get('*') ?? [])
    ]
    for (const callback of callbacks) {
      try {
        callback(...args)
      } catch {
        // A DevTools listener must never affect the application.
      }
    }
  }

  function safeExtensionCall<T>(read: () => T, fallback: T): T {
    try { return read() } catch { return fallback }
  }

  function getExtensionSnapshot(): DevToolsExtensionSnapshot {
    const extensionMetrics: Record<string, number | string> = {}
    const extensionTimelineEvents: Record<string, readonly DevToolsTimelineEvent[]> = {}
    for (const [id, timeline] of timelines) {
      const events = safeExtensionCall(() => timeline.getEvents?.() ?? [], [])
      extensionTimelineEvents[id] = events.map(event => ({
        ...event,
        data: serializeForDevTools(event.data, new Set<object>(), 0, privacy)
      })).slice(-maxUpdates)
    }
    for (const [id, metric] of metrics) {
      const value = safeExtensionCall(() => metric.read(), 0)
      extensionMetrics[id] = typeof value === 'number' || typeof value === 'string' ? value : 0
    }
    return {
      inspectors: [...inspectors.keys()],
      timelines: [...timelines.keys()],
      timelineEvents: extensionTimelineEvents,
      metrics: extensionMetrics
    }
  }

  function recordLifecycle(
    type: LifecycleEventType,
    targetId: string,
    name?: string,
    ownerId?: string,
    status?: LifecycleEvent['status']
  ): void {
    if (disposed || collectionPaused || isInternalOwnerId(targetId) || (ownerId !== undefined && isInternalOwnerId(ownerId))) return
    const event: LifecycleEvent = {
      id: `lifecycle-${nextId++}`,
      type,
      timestamp: now(),
      targetId,
      name,
      ownerId,
      status
    }
    lifecycleEvents.push(event)
    while (lifecycleEvents.length > maxUpdates) lifecycleEvents.shift()
    emit('lifecycle', event)
  }

  function reportError(
    phase: DevToolsErrorPhase,
    error: unknown,
    context: DevToolsErrorContext = {}
  ): void {
    if (collectionPaused) return
    const debugError = toDebugError(error, phase)
    const metadata = classifyError(phase, error, context)
    const code = context.code ?? debugError.code ?? metadata.code
    const hint = context.hint ?? debugError.hint ?? metadata.hint
    const origin = context.origin ?? metadata.origin
    const ownerId = context.ownerId ?? readErrorProperty(error, 'vobsOwnerId')
    const component = context.component ?? readErrorProperty(error, 'vobsComponent')
    const source = context.source ?? debugError.source ?? readErrorProperty(error, 'vobsSource')
    const activeRoute = context.route ?? getRuntimeDebugContext()?.route ?? routerContext?.route
    const activeNavigationId = context.navigationId ?? getRuntimeDebugContext()?.navigationId ?? routerContext?.navigationId
    // The same exception can pass through effect -> boundary -> application
    // handlers. Keep one diagnostic and accumulate its phases instead of
    // presenting the propagation chain as duplicate errors.
    const key = diagnosticErrorKey({ origin, code, name: debugError.name, message: debugError.message, source, component })
    const previous = errors.get(key)
    const nowValue = Date.now()
    const trace: DevToolsErrorTrace = previous
      ? {
          ...previous,
          ...context,
          phase,
          phases: previous.phases.includes(phase) ? previous.phases : [...previous.phases, phase],
          lastOccurredAt: nowValue,
          count: previous.count + 1,
          code,
          hint,
          origin,
          handled: context.handled ?? previous.handled,
          recovery: mergeRecovery(previous.recovery, context.recovery),
          ownerId: ownerId ?? previous.ownerId,
          component: component ?? previous.component,
          source: source ?? previous.source,
          updateId: context.updateId ?? previous.updateId,
          effectId: context.effectId ?? previous.effectId,
          requestId: context.requestId ?? previous.requestId,
          route: activeRoute ?? previous.route,
          navigationId: activeNavigationId ?? previous.navigationId
        }
      : {
          ...debugError,
          ...context,
          source,
          code,
          hint,
          id: nextErrorId++,
          phase,
          phases: [phase],
          origin,
          handled: context.handled ?? false,
          recovery: context.recovery ?? 'propagated',
          firstOccurredAt: nowValue,
          lastOccurredAt: nowValue,
          count: 1,
          ownerId,
          component,
          route: activeRoute,
          navigationId: activeNavigationId
        }
    errors.set(key, trace)
    while (errors.size > maxUpdates) {
      const oldest = errors.keys().next().value
      if (typeof oldest !== 'string') break
      errors.delete(oldest)
    }
    emit('error', trace)
  }

  function ensureOwner(owner: Owner): OwnerRecord {
    const existingId = ownerIds.get(owner)
    if (existingId) {
      const existing = owners.get(existingId)
      if (existing) return existing
    }

    const record: OwnerRecord = {
      owner,
      id: owner.id,
      parentId: owner.parent?.id ?? null,
      name: getOwnerDebugName(owner) ?? (owner.parent ? 'Owner' : 'App'),
      disposed: owner.disposed
    }
    ownerIds.set(owner, record.id)
    owners.set(record.id, record)
    return record
  }

  function isInternalOwnerId(ownerId: string | null | undefined): boolean {
    const visited = new Set<string>()
    let current = ownerId === undefined ? null : ownerId
    while (current && !visited.has(current)) {
      visited.add(current)
      const record = owners.get(current)
      if (!record) return false
      if (debugComponentName(record.name).startsWith('DevTools')) return true
      current = record.parentId
    }
    return false
  }

  function isInternalSignal(record: SignalRecord): boolean {
    return isInternalOwnerId(record.ownerId)
  }

  function isNoisyViewportSignal(record: SignalRecord): boolean {
    return record.explicitName
      && (record.name === 'layout.viewport.width' || record.name === 'layout.viewport.height')
  }

  function hasMeaningfulDomUpdate(updates: readonly DomUpdateInfo[]): boolean {
    return updates.some(update => update.operation === 'insert'
      || update.operation === 'remove'
      || !Object.is(update.previousValue, update.nextValue))
  }

  function isInternalEffect(record: EffectRecord): boolean {
    return isInternalOwnerId(record.ownerId)
  }

  function errorComponentForOwner(ownerId: string | undefined): string | undefined {
    if (!ownerId) return undefined
    const record = owners.get(ownerId)
    if (!record) return undefined
    if (record.name !== 'Owner' && record.name !== 'dynamic') return record.name
    return errorComponentForOwner(record.parentId ?? undefined)
  }

  function ensureSignal(signal: Signal<unknown>, owner: Owner | null = null): SignalRecord {
    const existingId = signalIds.get(signal)
    if (existingId) {
      const existing = signals.get(existingId)
      if (existing) return existing
    }

    const id = `signal-${nextId++}`
    const explicitName = getSignalDebugName(signal)
    const ownerName = owner ? getOwnerDebugName(owner) : undefined
    const record: SignalRecord = {
      signal,
      id,
      ownerId: owner ? ensureOwner(owner).id : null,
      createdAt: Date.now(),
      name: explicitName ?? (ownerName ? `${ownerName} state` : 'runtime state'),
      explicitName: explicitName !== undefined,
      kind: 'state',
      disposed: false
    }
    signalIds.set(signal, id)
    signals.set(id, record)
    return record
  }

  function ensureEffect(effect: Effect, owner: Owner | null = null): EffectRecord {
    const existingId = effectIds.get(effect)
    if (existingId) {
      const existing = effects.get(existingId)
      if (existing) return existing
    }

    const id = `effect-${nextId++}`
    const record: EffectRecord = {
      effect,
      id,
      ownerId: owner ? ensureOwner(owner).id : null,
      status: 'dirty',
      executionCount: 0,
      lastExecutionTime: 0,
      lastRunStatus: undefined,
      lastDuration: 0,
      lastUpdateId: undefined,
      lastError: undefined,
      lastDomUpdates: 0,
      runningSince: null,
      disposed: effect.disposed
    }
    effectIds.set(effect, id)
    effects.set(id, record)
    return record
  }

  function ensureDependencySignal(dependency: Dependency): SignalRecord | null {
    const existingId = signalIds.get(dependency as object)
    if (existingId) return signals.get(existingId) ?? null
    if (!('value' in (dependency as object))) return null
    return ensureSignal(dependency as Signal<unknown>)
  }

  function edgeKey(from: string, to: string): string {
    return `${from}->${to}`
  }

  function trackDependency(dependency: Dependency, subscriber: Subscriber): void {
    const source = ensureDependencySignal(dependency)
    if (!source) return

    const memoId = memoSignalIds.get(subscriber as object)
    const effectId = effectIds.get(subscriber as object)
    const targetId = memoId ?? effectId
    if (!targetId) return

    const type: DependencyEdgeType = memoId
      ? source.kind === 'memo' ? 'memo-to-memo' : 'state-to-memo'
      : source.kind === 'memo' ? 'memo-to-effect' : 'state-to-effect'
    edges.set(edgeKey(source.id, targetId), {
      from: source.id,
      to: targetId,
      type
    })
  }

  function collectEffectIds(signalId: string): Set<string> {
    const effectsForSignal = new Set<string>()
    const visited = new Set<string>()
    const visit = (sourceId: string): void => {
      if (visited.has(sourceId)) return
      visited.add(sourceId)
      for (const edge of edges.values()) {
        if (edge.from !== sourceId) continue
        if (effects.has(edge.to)) {
          const effect = effects.get(edge.to)
          if (effect && !isInternalEffect(effect)) effectsForSignal.add(edge.to)
        }
        else visit(edge.to)
      }
    }
    visit(signalId)
    return effectsForSignal
  }

  function collectAffectedSignals(signalId: string): Set<string> {
    const affected = new Set<string>()
    const visited = new Set<string>()
    const visit = (sourceId: string): void => {
      if (visited.has(sourceId)) return
      visited.add(sourceId)
      if (signals.has(sourceId)) affected.add(sourceId)
      for (const edge of edges.values()) {
        if (edge.from === sourceId && signals.has(edge.to)) visit(edge.to)
      }
    }
    visit(signalId)
    return affected
  }

  function untrackDependency(dependency: Dependency, subscriber: Subscriber): void {
    const source = ensureDependencySignal(dependency)
    if (!source) return
    const targetId = memoSignalIds.get(subscriber as object) ?? effectIds.get(subscriber as object)
    if (targetId) edges.delete(edgeKey(source.id, targetId))
  }

  function signalInfo(record: SignalRecord, readValue = true): SignalDebugInfo {
    return {
      id: record.id,
      name: record.name,
      value: readValue ? serializeForDevTools(readSignal(record.signal), new Set<object>(), 0, privacy) : undefined,
      component: record.ownerId ? owners.get(record.ownerId)?.name ?? 'unknown' : 'unknown',
      subscribers: [...edges.values()].filter(edge => edge.from === record.id).length,
      createdAt: record.createdAt,
      kind: record.kind
    }
  }

  function readSignal(signal: Signal<unknown>): unknown {
    try {
      return untrack(() => signal.value)
    } catch (error) {
      return { type: 'thrown', message: toErrorMessage(error) }
    }
  }

  function effectInfo(record: EffectRecord): EffectDebugInfo {
    const component = record.ownerId ? owners.get(record.ownerId)?.name ?? 'unknown' : 'runtime'
    return {
      id: record.id,
      name: `${debugComponentName(component)} effect`,
      component,
      dependencies: [...edges.values()]
        .filter(edge => edge.to === record.id)
        .map(edge => edge.from),
      status: record.status,
      executionCount: record.executionCount,
      lastExecutionTime: record.lastExecutionTime,
      lastRunStatus: record.lastRunStatus,
      lastDuration: record.lastDuration,
      lastUpdateId: record.lastUpdateId,
      lastError: record.lastError,
      lastDomUpdates: record.lastDomUpdates
    }
  }

  function removeEdgesFor(ids: ReadonlySet<string>): void {
    for (const [key, edge] of edges) {
      if (ids.has(edge.from) || ids.has(edge.to)) edges.delete(key)
    }
  }

  function cleanupSignalRecord(record: SignalRecord): void {
    if (signals.get(record.id) !== record) return
    removeEdgesFor(new Set([record.id]))
    signals.delete(record.id)
  }

  function cleanupEffectRecord(record: EffectRecord): void {
    if (effects.get(record.id) !== record) return
    removeEdgesFor(new Set([record.id]))
    effects.delete(record.id)
  }

  function cleanupOwnerRecord(record: OwnerRecord): void {
    if (owners.get(record.id) !== record) return
    const removedIds = new Set<string>([record.id])
    for (const [id, signal] of signals) {
      if (signal.ownerId === record.id) {
        removedIds.add(id)
        signals.delete(id)
      }
    }
    for (const [id, effect] of effects) {
      if (effect.ownerId === record.id) {
        removedIds.add(id)
        effects.delete(id)
      }
    }
    removeEdgesFor(removedIds)
    owners.delete(record.id)
  }

  function debugComponentName(value: string): string {
    const separator = value.indexOf(' (')
    return separator > 0 ? value.slice(0, separator) : value
  }

  function buildComponentNode(record: OwnerRecord, activeIds: ReadonlySet<string>): ComponentDebugNode {
    const componentEffects = [...effects.values()]
      .filter(effect => !effect.disposed && effect.ownerId === record.id)
    const componentEffectIds = new Set(componentEffects.map(effect => effect.id))
    const componentUpdates = updates.filter(update => update.effects.some(effect => componentEffectIds.has(effect.effectId)))
    return {
      id: record.id,
      name: record.name,
      ownerId: record.id,
      signals: [...signals.values()]
        .filter(signal => !signal.disposed && signal.ownerId === record.id)
        .map(signal => signal.id),
      effects: componentEffects.map(effect => effect.id),
      recentUpdates: componentUpdates.slice(-10).map(update => update.id),
      domUpdates: componentUpdates.reduce((count, update) => count + update.domUpdates.length, 0),
      children: [...owners.values()]
        .filter(child => !child.disposed && child.parentId === record.id && activeIds.has(child.id))
        .map(child => buildComponentNode(child, activeIds)),
      mounted: !record.disposed
    }
  }

  function recordUpdate(pending: PendingUpdate): void {
    if (disposed || collectionPaused || isInternalSignal(pending.signal)) return
    if (isNoisyViewportSignal(pending.signal) && !hasMeaningfulDomUpdate(pending.domUpdates)) return
    const duration = Math.max(0, now() - pending.timestamp)
    const trace: UpdateTrace = {
      id: pending.id,
      signalId: pending.signal.id,
      signalName: pending.signal.name,
      previousValue: serializeForDevTools(pending.previousValue, new Set<object>(), 0, privacy),
      nextValue: serializeForDevTools(pending.nextValue, new Set<object>(), 0, privacy),
      timestamp: pending.timestamp,
      effects: [...pending.executions.values()],
      affectedSignals: [...pending.affectedSignals],
      affectedEffects: [...pending.effectIds],
      domUpdates: pending.domUpdates.slice(),
      status: pending.status,
      error: pending.error,
      duration,
      route: pending.context.route,
      navigationId: pending.context.navigationId,
      requestIds: [...pending.context.requestIds]
    }
    updates.push(trace)
    while (updates.length > maxUpdates) updates.shift()
    updateDurations.push(duration)
    while (updateDurations.length > maxUpdates) updateDurations.shift()
    updateCount++
    emit('update', trace)
  }

  function onFlushEnd(): void {
    const current = pendingUpdates.splice(0)
    for (const pending of current) recordUpdate(pending)
  }

  function schedulePendingFlush(): void {
    if (pendingFlushScheduled) return
    pendingFlushScheduled = true
    queueMicrotask(() => {
      if (disposed) {
        pendingUpdates.length = 0
        return
      }
      pendingFlushScheduled = false
      for (let index = pendingUpdates.length - 1; index >= 0; index--) {
        const pending = pendingUpdates[index]
        if (!pending || pending.effectIds.size > 0) continue
        pendingUpdates.splice(index, 1)
        recordUpdate(pending)
      }
    })
  }

  const hooks: ReactivityDebugHooks = {
    ownerCreated(owner) {
      const record = ensureOwner(owner)
      recordLifecycle('owner-created', record.id, record.name, record.parentId ?? undefined)
      emit('owner-created', record)
    },

    ownerNamed(owner, name) {
      const record = ensureOwner(owner)
      record.name = name
      if (isInternalOwnerId(record.id)) return
      for (const signal of signals.values()) {
        if (signal.ownerId === record.id && !signal.explicitName) signal.name = `${name} state`
      }
      recordLifecycle('owner-named', record.id, name, record.parentId ?? undefined)
      emit('owner-named', record)
    },

    ownerDisposed(owner) {
      const record = ensureOwner(owner)
      record.disposed = true
      const internal = isInternalOwnerId(record.id)
      if (!internal) {
        recordLifecycle('owner-disposed', record.id, record.name, record.parentId ?? undefined)
        emit('owner-disposed', record)
      }
      cleanupOwnerRecord(record)
    },

    signalCreated(signal, owner) {
      const record = ensureSignal(signal, owner)
      if (isInternalSignal(record)) return
      recordLifecycle('signal-created', record.id, record.name, record.ownerId ?? undefined)
      emit('signal-created', signalInfo(record, false))
    },

    signalNamed(signal, name) {
      const record = ensureSignal(signal)
      record.name = name
      record.explicitName = true
      if (isInternalSignal(record)) return
      recordLifecycle('signal-named', record.id, name, record.ownerId ?? undefined)
      emit('signal-named', signalInfo(record))
    },

    signalRead(signal, subscriber) {
      ensureSignal(signal)
      emit('signal-read', signal, subscriber)
    },

    signalChanged(signal, previousValue, nextValue) {
      const record = ensureSignal(signal)
      if (isInternalSignal(record)) return
      let pending = pendingUpdates.find(item => item.signal.signal === signal)
      if (pending) {
        pending.nextValue = nextValue
        const context = getRuntimeDebugContext()
        if (context?.route) pending.context = { ...pending.context, route: context.route }
        if (context?.navigationId !== undefined) pending.context = { ...pending.context, navigationId: context.navigationId }
        if (context?.dataRequestId !== undefined) pending.context.requestIds.add(context.dataRequestId)
      } else {
        pending = {
          id: `update-${nextId++}`,
          signal: record,
          timestamp: now(),
          previousValue,
          nextValue,
          affectedSignals: collectAffectedSignals(record.id),
          effectIds: collectEffectIds(record.id),
          executions: new Map(),
          domUpdates: [],
          status: 'completed',
          error: undefined,
          context: {
            route: getRuntimeDebugContext()?.route,
            navigationId: getRuntimeDebugContext()?.navigationId,
            requestIds: new Set(
              getRuntimeDebugContext()?.dataRequestId === undefined
                ? []
                : [getRuntimeDebugContext()!.dataRequestId!]
            )
          }
        }
        pendingUpdates.push(pending)
      }
      emit('signal-update', {
        ...signalInfo(record),
        previousValue: serializeForDevTools(previousValue, new Set<object>(), 0, privacy),
        nextValue: serializeForDevTools(nextValue, new Set<object>(), 0, privacy),
        updateId: pending.id
      })
      recordLifecycle('signal-changed', record.id, record.name, record.ownerId ?? undefined)
      if (pending.effectIds.size === 0) schedulePendingFlush()
    },

    signalDisposed(signal) {
      const record = ensureSignal(signal)
      record.disposed = true
      const internal = isInternalSignal(record)
      if (!internal) {
        recordLifecycle('signal-disposed', record.id, record.name, record.ownerId ?? undefined)
        emit('signal-disposed', record)
      }
      cleanupSignalRecord(record)
    },

    dependencyTracked(dependency, subscriber) {
      trackDependency(dependency, subscriber)
    },

    dependencyUntracked(dependency, subscriber) {
      untrackDependency(dependency, subscriber)
    },

    effectCreated(effect, owner) {
      const record = ensureEffect(effect, owner)
      if (isInternalEffect(record)) return
      recordLifecycle('effect-created', record.id, effectInfo(record).name, record.ownerId ?? undefined)
      emit('effect-created', effectInfo(record))
    },

    effectInvalidated(effect) {
      const record = ensureEffect(effect)
      if (isInternalEffect(record)) return
      record.status = 'dirty'
      recordLifecycle('effect-invalidated', record.id, effectInfo(record).name, record.ownerId ?? undefined)
      emit('effect-invalidated', effectInfo(record))
    },

    effectRunStart(effect) {
      const record = ensureEffect(effect)
      if (isInternalEffect(record)) return
      record.status = 'running'
      record.runningSince = now()
      activeEffectId = record.id
      recordLifecycle('effect-run-start', record.id, effectInfo(record).name, record.ownerId ?? undefined)
      emit('effect-run-start', effectInfo(record))
    },

    effectRunEnd(effect, error, handled = false) {
      const record = ensureEffect(effect)
      if (isInternalEffect(record)) return
      const end = now()
      const duration = record.runningSince === null ? 0 : Math.max(0, end - record.runningSince)
      const runStatus = error === undefined ? 'success' : 'error'
      const debugError = error === undefined ? undefined : toDebugError(error, 'effect')
      record.status = runStatus
      record.runningSince = null
      record.executionCount++
      record.lastExecutionTime = end
      record.lastRunStatus = runStatus
      record.lastDuration = duration
      record.lastError = debugError
      effectExecutionCount++
      const execution: EffectExecutionInfo = {
        effectId: record.id,
        component: record.ownerId ? owners.get(record.ownerId)?.name ?? 'unknown' : 'unknown',
        duration,
        domUpdates: 0,
        status: runStatus,
        error: debugError
      }
      for (const pending of pendingUpdates) {
        if (!pending.effectIds.has(record.id)) continue
        const domUpdates = pending.domUpdates.filter(update => update.effectId === record.id).length
        const completedExecution = { ...execution, domUpdates }
        pending.executions.set(record.id, completedExecution)
        if (error !== undefined) {
          pending.status = 'error'
          pending.error = debugError
        }
        record.lastUpdateId = pending.id
        record.lastDomUpdates = domUpdates
      }
      activeEffectId = null
      if (error !== undefined) {
        const update = [...pendingUpdates].reverse().find(item => item.effectIds.has(record.id))
        const errorOwnerId = readErrorProperty(error, 'vobsOwnerId')
        const errorComponent = readErrorProperty(error, 'vobsComponent')
        reportError('effect', error, {
          effectId: record.id,
          updateId: update?.id,
          ownerId: errorOwnerId ?? record.ownerId ?? undefined,
          component: errorComponent ?? errorComponentForOwner(record.ownerId ?? undefined),
          handled,
          recovery: handled ? 'handled' : 'propagated'
        })
      }
      recordLifecycle('effect-run', record.id, effectInfo(record).name, record.ownerId ?? undefined, runStatus)
      emit('effect-run', execution)
    },

    effectDisposed(effect) {
      const record = ensureEffect(effect)
      const internal = isInternalEffect(record)
      record.disposed = true
      record.status = 'idle'
      if (!internal) {
        recordLifecycle('effect-disposed', record.id, effectInfo(record).name, record.ownerId ?? undefined)
        emit('effect-disposed', record)
      }
      cleanupEffectRecord(record)
    },

    memoCreated(signal, subscriber, owner) {
      const record = ensureSignal(signal, owner)
      record.kind = 'memo'
      memoSignalIds.set(subscriber as object, record.id)
      if (isInternalSignal(record)) return
      recordLifecycle('memo-created', record.id, record.name, record.ownerId ?? undefined)
      emit('memo-created', signalInfo(record))
    },

    memoInvalidated(signal) {
      const record = ensureSignal(signal)
      if (isInternalSignal(record)) return
      recordLifecycle('memo-invalidated', record.id, record.name, record.ownerId ?? undefined)
      emit('memo-update', signalInfo(record))
    },

    flushEnd: onFlushEnd
  }

  const runtimeHooks: RuntimeDebugHooks = {
    domMutation(mutation: RuntimeDomMutation): void {
      if (!activeEffectId) return
      const effect = effects.get(activeEffectId)
      if (!effect || isInternalEffect(effect)) return
      const safeMutation: DomUpdateInfo = {
        ...mutation,
        previousValue: privacy.redactDomValues ? privacy.replacement : serializeForDevTools(mutation.previousValue, new Set<object>(), 0, privacy),
        nextValue: privacy.redactDomValues ? privacy.replacement : serializeForDevTools(mutation.nextValue, new Set<object>(), 0, privacy),
        effectId: activeEffectId,
        route: getRuntimeDebugContext()?.route,
        navigationId: getRuntimeDebugContext()?.navigationId,
        requestId: getRuntimeDebugContext()?.dataRequestId
      }
      for (const pending of pendingUpdates) {
        if (pending.effectIds.has(activeEffectId)) {
          pending.domUpdates.push(safeMutation)
          if (safeMutation.route) pending.context = { ...pending.context, route: safeMutation.route }
          if (safeMutation.navigationId !== undefined) pending.context = { ...pending.context, navigationId: safeMutation.navigationId }
          if (safeMutation.requestId !== undefined) pending.context.requestIds.add(safeMutation.requestId)
        }
      }
      emit('dom-update', safeMutation)
    },

    hydrationMismatch(event: RuntimeHydrationMismatch): void {
      reportError('hydration', Object.assign(new Error(event.message), {
        name: 'HydrationMismatchError',
        vobsCode: 'VOBS_HYDRATION_MISMATCH',
        vobsHydration: event
      }), {
        route: getRuntimeDebugContext()?.route,
        navigationId: getRuntimeDebugContext()?.navigationId
      })
    },

    error(event: RuntimeErrorEvent): void {
      const owner = ensureOwner(event.owner)
      const errorOwnerId = readErrorProperty(event.error, 'vobsOwnerId')
      const errorComponent = readErrorProperty(event.error, 'vobsComponent')
      reportError(event.phase === 'boundary' ? 'boundary' : 'event', event.error, {
        ownerId: errorOwnerId ?? owner.id,
        component: errorComponent ?? errorComponentForOwner(owner.id ?? undefined) ?? owner.name,
        handled: event.handled,
        recovery: event.recovery,
      })
    }
  }

  const httpHooks = {
    request(event: HTTPDebugRequest): void {
      if (collectionPaused) return
      const previous = networkRequests.get(event.id)
      const trace: NetworkRequestTrace = {
        id: event.id,
        url: event.url,
        method: event.method,
        status: event.status,
        headers: redactHeaders(event.headers, privacy),
        requestBody: serializeForDevTools(event.requestBody, new Set<object>(), 0, privacy),
        startedAt: previous?.startedAt ?? event.startedAt,
        endedAt: event.endedAt,
        duration: event.duration,
        attempt: Math.max(event.attempt, previous?.attempt ?? 0),
        retries: Math.max(event.retries, previous?.retries ?? 0),
        responseStatus: event.responseStatus,
        responseBody: serializeForDevTools(event.responseBody, new Set<object>(), 0, privacy),
        error: event.error,
        source: event.context?.environment === 'server' ? 'ssr' : 'http',
        test: event.context?.test,
        route: event.context?.route,
        navigationId: event.context?.navigationId,
        dataRequestId: event.context?.dataRequestId,
        environment: event.context?.environment
      }
      for (const pending of pendingUpdates) {
        if (event.context?.dataRequestId !== undefined && pending.context.requestIds.has(event.context.dataRequestId)) pending.context.requestIds.add(event.id)
        if (activeEffectId !== null && pending.effectIds.has(activeEffectId)) pending.context.requestIds.add(event.id)
      }
      networkRequests.set(event.id, trace)
      while (networkRequests.size > maxUpdates) {
        const oldest = networkRequests.keys().next().value
        if (typeof oldest !== 'number') break
        networkRequests.delete(oldest)
      }
      emit('network-request', trace)
      if (event.error) reportError('network', new Error(event.error.message), {
        requestId: event.id,
        route: event.context?.route,
        navigationId: event.context?.navigationId
      })
    }
  }

  function importSSRRequests(snapshot: unknown): void {
    if (disposed) return
    const events = parseSSRRequestSnapshot(snapshot)
    const ids = new Map<number, number>()
    for (const event of events) {
      const importedId = ids.get(event.id) ?? -(event.id + 1)
      ids.set(event.id, importedId)
      const trace: NetworkRequestTrace = {
        id: importedId,
        url: event.url,
        method: event.method,
        status: event.status,
        headers: redactHeaders(event.headers, privacy),
        requestBody: serializeForDevTools(event.requestBody, new Set<object>(), 0, privacy),
        startedAt: event.startedAt,
        endedAt: event.endedAt,
        duration: event.duration,
        attempt: event.attempt,
        retries: event.retries,
        responseStatus: event.responseStatus,
        responseBody: serializeForDevTools(event.responseBody, new Set<object>(), 0, privacy),
        error: event.error,
        source: 'ssr',
        test: event.context?.test,
        route: event.context?.route,
        navigationId: event.context?.navigationId,
        dataRequestId: event.context?.dataRequestId,
        environment: 'server'
      }
      networkRequests.set(importedId, trace)
    }
    while (networkRequests.size > maxUpdates) {
      const oldest = networkRequests.keys().next().value
      if (typeof oldest !== 'number') break
      networkRequests.delete(oldest)
    }
    emit('network-request', { source: 'ssr', imported: events.length })
  }

  const previousHooks = getDebugHooks()
  const previousRuntimeHooks = getRuntimeDebugHooks()
  const previousHTTPHooks = getHTTPDebugHooks()
  setDebugHooks(hooks)
  setRuntimeDebugHooks(runtimeHooks)
  setHTTPDebugHooks(httpHooks)

  const target = options.target ?? defaultTarget()
  const shouldExpose = options.expose ?? Boolean(target)
  const previousGlobal = target?.__VOBS_DEVTOOLS__
  let api!: DevToolsAPI
  const onGlobalError = (event: { readonly error?: unknown; readonly message?: unknown; readonly filename?: unknown; readonly lineno?: unknown; readonly colno?: unknown }): void => {
    const source = typeof event.filename === 'string' && event.filename
      ? `${event.filename}:${typeof event.lineno === 'number' ? event.lineno : 0}:${typeof event.colno === 'number' ? event.colno : 0}`
      : undefined
    reportError('global', event.error ?? event.message ?? 'Unknown global error', { source })
  }
  const onUnhandledRejection = (event: { readonly reason?: unknown }): void => {
    reportError('unhandledrejection', event.reason ?? 'Unhandled promise rejection')
  }
  target?.addEventListener?.('error', onGlobalError)
  target?.addEventListener?.('unhandledrejection', onUnhandledRejection)

  function subscribe(event: string, callback: (...args: any[]) => void): () => void {
    if (disposed) return () => undefined
    const callbacks = listeners.get(event) ?? new Set<(...args: any[]) => void>()
    callbacks.add(callback)
    listeners.set(event, callbacks)
    return () => {
      callbacks.delete(callback)
      if (callbacks.size === 0 && listeners.get(event) === callbacks) listeners.delete(event)
    }
  }

  function attachRouter(router: DevToolsRouterSource): () => void {
    const existing = routerStops.get(router)
    if (existing) {
      existing.refs++
      let released = false
      return () => {
        if (released) return
        released = true
        existing.refs--
        if (existing.refs === 0) existing.stop()
      }
    }
    const source = router.devtools as DevToolsRouterSource['devtools'] & {
      getCurrentRoute?: () => { readonly fullPath?: unknown }
      getNavigationState?: () => { readonly traceId?: unknown; readonly status?: unknown }
      getDataRequests?: () => readonly DevToolsRouterContext['dataRequests'][number][]
    }
    const initialRoute = source.getCurrentRoute?.()
    const initialState = source.getNavigationState?.()
    routerContext = {
      route: typeof initialRoute?.fullPath === 'string' ? initialRoute.fullPath : routerContext?.route,
      navigationId: typeof initialState?.traceId === 'number' ? initialState.traceId : routerContext?.navigationId,
      navigationStatus: typeof initialState?.status === 'string' ? initialState.status : routerContext?.navigationStatus,
      dataRequests: source.getDataRequests?.() ?? routerContext?.dataRequests ?? []
    }
    const stops = [
      router.devtools.subscribe('navigation:start', payload => {
        const value = payload as { readonly to?: unknown; readonly traceId?: unknown; readonly status?: unknown }
        routerContext = {
          route: typeof value.to === 'string' ? value.to : routerContext?.route,
          navigationId: typeof value.traceId === 'number' ? value.traceId : routerContext?.navigationId,
          navigationStatus: typeof value.status === 'string' ? value.status : undefined,
          dataRequests: routerContext?.dataRequests ?? []
        }
        emit('router', { type: 'navigation:start', payload })
      }),
      router.devtools.subscribe('navigation:end', payload => {
        const value = payload as { readonly to?: unknown; readonly id?: unknown; readonly status?: unknown }
        routerContext = {
          route: typeof value.to === 'string' ? value.to : routerContext?.route,
          navigationId: typeof value.id === 'number' ? value.id : routerContext?.navigationId,
          navigationStatus: typeof value.status === 'string' ? value.status : undefined,
          dataRequests: routerContext?.dataRequests ?? []
        }
        emit('router', { type: 'navigation:end', payload })
      }),
      router.devtools.subscribe('data-request', payload => {
        const request = payload as DevToolsRouterContext['dataRequests'][number]
        const requests = [...(routerContext?.dataRequests ?? [])]
        const existingIndex = requests.findIndex(item => item.id === request.id)
        if (existingIndex >= 0) requests[existingIndex] = request
        else requests.push(request)
        requests.splice(0, Math.max(0, requests.length - maxUpdates))
        routerContext = { ...routerContext, dataRequests: requests }
        emit('router', { type: 'data-request', payload })
      }),
      router.devtools.subscribe('route:update', payload => {
        const value = payload as { readonly fullPath?: unknown }
        if (typeof value.fullPath === 'string') routerContext = { ...routerContext, route: value.fullPath, dataRequests: routerContext?.dataRequests ?? [] }
        emit('router', { type: 'route:update', payload })
      }),
      router.devtools.subscribe('error', payload => {
        const value = payload as { readonly route?: unknown; readonly requestId?: unknown; readonly navigationId?: unknown; readonly message?: unknown; readonly stack?: unknown; readonly phase?: unknown }
        reportError('route', Object.assign(new Error(typeof value.message === 'string' ? value.message : 'Router error'), {
          stack: value.stack
        }), {
          route: typeof value.route === 'string' ? value.route : routerContext?.route,
          requestId: typeof value.requestId === 'number' ? value.requestId : undefined,
          navigationId: typeof value.navigationId === 'number' ? value.navigationId : undefined
        })
        emit('router', { type: 'error', payload })
      })
    ]
    const stop = () => {
      const current = routerStops.get(router)
      if (!current || current.stop !== stop) return
      for (const stop of stops) stop()
      routerStops.delete(router)
    }
    routerStops.set(router, { stop, refs: 1 })
    let released = false
    return () => {
      if (released) return
      released = true
      const current = routerStops.get(router)
      if (!current) return
      current.refs--
      if (current.refs === 0) current.stop()
    }
  }

  api = {
    getComponentTree(): readonly ComponentDebugNode[] {
      const active = [...owners.values()].filter(owner => !owner.disposed && !isInternalOwnerId(owner.id))
      const activeIds = new Set(active.map(owner => owner.id))
      return active
        .filter(owner => owner.parentId === null || !activeIds.has(owner.parentId))
        .map(owner => buildComponentNode(owner, activeIds))
    },

    getComponent(ownerId: string): ComponentDebugNode | null {
      const active = [...owners.values()].filter(owner => !owner.disposed && !isInternalOwnerId(owner.id))
      const activeIds = new Set(active.map(owner => owner.id))
      const find = (records: readonly OwnerRecord[]): ComponentDebugNode | null => {
        for (const record of records) {
          if (!activeIds.has(record.id)) continue
          if (record.id === ownerId) return buildComponentNode(record, activeIds)
          const child = find(active.filter(candidate => candidate.parentId === record.id))
          if (child) return child
        }
        return null
      }
      return find(active.filter(owner => owner.parentId === null || !activeIds.has(owner.parentId)))
    },

    getSignals(): readonly SignalDebugInfo[] {
      return [...signals.values()]
        .filter(signal => !signal.disposed && !isInternalSignal(signal))
        .map(signal => signalInfo(signal))
    },

    getSignal(signalId: string): SignalDebugInfo | null {
      const record = signals.get(signalId)
      return record && !record.disposed && !isInternalSignal(record) ? signalInfo(record) : null
    },

    canMutate(): boolean {
      return allowMutations && !disposed
    },

    setSignalValue(signalId: string, value: unknown): boolean {
      if (!allowMutations || disposed) return false
      const record = signals.get(signalId)
      if (!record || record.disposed || record.kind === 'memo') return false
      try {
        record.signal.value = value
        return true
      } catch (error) {
        reportError('render', error)
        return false
      }
    },

    getDependencies(signalId: string): readonly DependencyEdge[] {
      return [...edges.values()].filter(edge => edge.from === signalId)
    },

    getDependents(subscriberId: string): readonly DependencyEdge[] {
      return [...edges.values()].filter(edge => edge.to === subscriberId)
    },

    getEffects(): readonly EffectDebugInfo[] {
      return [...effects.values()]
        .filter(effect => !effect.disposed && !isInternalEffect(effect))
        .map(effectInfo)
    },

    getUpdates(): readonly UpdateTrace[] {
      return updates.slice()
    },

    getLifecycleEvents(): readonly LifecycleEvent[] {
      return lifecycleEvents.slice()
    },

    getNetworkRequests(): readonly NetworkRequestTrace[] {
      return [...networkRequests.values()]
    },

    importSSRRequests,

    getRouterContext(): DevToolsRouterContext | null {
      return routerContext ? { ...routerContext, dataRequests: [...routerContext.dataRequests] } : null
    },

    attachRouter,

    getErrors(): readonly DevToolsErrorTrace[] {
      return [...errors.values()]
    },

    getPerformanceEntries(): readonly DevToolsPerformanceEntry[] {
      const entries: DevToolsPerformanceEntry[] = []
      for (const update of updates) {
        entries.push({
          kind: 'update',
          id: update.id,
          label: update.signalName,
          duration: update.duration,
          timestamp: update.timestamp,
          status: update.status
        })
      }
      for (const effect of effects.values()) {
        if (effect.disposed || isInternalEffect(effect) || effect.lastDuration <= 0) continue
        entries.push({
          kind: 'effect',
          id: effect.id,
          label: effectInfo(effect).name,
          duration: effect.lastDuration,
          timestamp: effect.lastExecutionTime,
          status: effect.lastRunStatus ?? effect.status
        })
      }
      for (const request of networkRequests.values()) {
        if (request.duration === undefined) continue
        entries.push({
          kind: 'request',
          id: request.id,
          label: `${request.method} ${request.url}`,
          duration: request.duration,
          timestamp: request.startedAt,
          status: request.status
        })
      }
      return entries.sort((left, right) => right.duration - left.duration)
    },

    reportError,

    getCollectionState(): DevToolsCollectionState {
      return { paused: collectionPaused }
    },

    setCollectionPaused(paused: boolean): void {
      collectionPaused = paused
      if (paused) pendingUpdates.length = 0
      emit('collection', { paused })
    },

    clearUpdates(): void {
      pendingUpdates.length = 0
      updates.length = 0
      updateDurations.length = 0
      updateCount = 0
      emit('collection-cleared', 'updates')
    },

    clearNetworkRequests(): void {
      networkRequests.clear()
      emit('collection-cleared', 'network')
    },

    clearErrors(): void {
      errors.clear()
      emit('collection-cleared', 'errors')
    },

    clearLifecycleEvents(): void {
      lifecycleEvents.length = 0
      emit('collection-cleared', 'lifecycle')
    },

    getPerformanceMetrics(): PerformanceMetrics {
      const total = updateDurations.reduce((sum, duration) => sum + duration, 0)
      const effectDurations = [...effects.values()]
        .filter(effect => !effect.disposed)
        .map(effect => effect.lastDuration)
        .filter(duration => duration > 0)
      const requestDurations = [...networkRequests.values()]
        .map(request => request.duration ?? 0)
        .filter(duration => duration > 0)
      return {
        updateCount,
        averageUpdateDuration: updateDurations.length === 0 ? 0 : total / updateDurations.length,
        slowUpdateCount: updateDurations.filter(duration => duration > slowUpdateThreshold).length,
        effectExecutionCount,
        slowEffectCount: effectDurations.filter(duration => duration > slowUpdateThreshold).length,
        slowRequestCount: requestDurations.filter(duration => duration > slowUpdateThreshold).length,
        maxUpdateDuration: updateDurations.length === 0 ? 0 : Math.max(...updateDurations),
        maxEffectDuration: effectDurations.length === 0 ? 0 : Math.max(...effectDurations),
        maxRequestDuration: requestDurations.length === 0 ? 0 : Math.max(...requestDurations)
      }
    },

    takeMemorySnapshot(): MemorySnapshot {
      return {
        signalCount: [...signals.values()].filter(signal => !signal.disposed && !isInternalSignal(signal)).length,
        effectCount: [...effects.values()].filter(effect => !effect.disposed && !isInternalEffect(effect)).length,
        ownerCount: [...owners.values()].filter(owner => !owner.disposed && !isInternalOwnerId(owner.id)).length,
        dependencyEdgeCount: edges.size,
        leakedOwners: [...owners.values()].filter(owner => owner.disposed).length
      }
    },

    exportDiagnostics(): DevToolsDiagnosticSnapshot {
      return {
        version: 1,
        exportedAt: Date.now(),
        updates: api.getUpdates(),
        lifecycle: api.getLifecycleEvents(),
        network: api.getNetworkRequests(),
        errors: api.getErrors(),
        performance: api.getPerformanceMetrics(),
        memory: api.takeMemorySnapshot(),
        extensions: getExtensionSnapshot()
      }
    },

    importDiagnostics(snapshot: unknown): void {
      const imported = parseDiagnosticSnapshot(snapshot)
      updates.splice(0, updates.length, ...imported.updates.slice(-maxUpdates).map(update => sanitizeImportedUpdate(update, privacy)))
      lifecycleEvents.splice(0, lifecycleEvents.length, ...imported.lifecycle.slice(-maxUpdates))
      networkRequests.clear()
      for (const request of imported.network.slice(-maxUpdates)) networkRequests.set(request.id, sanitizeImportedRequest(request, privacy))
      errors.clear()
      for (const error of imported.errors.slice(-maxUpdates)) {
        const normalized = sanitizeImportedError(error)
        errors.set(diagnosticErrorKey(normalized), normalized)
      }
      updateDurations.splice(0, updateDurations.length, ...updates.map(update => update.duration))
      updateCount = imported.performance.updateCount
      effectExecutionCount = imported.performance.effectExecutionCount
      emit('collection', { imported: true })
    },

    registerInspector(id: string, inspector: DevToolsInspector): () => void {
      if (disposed || !id) return () => undefined
      inspectors.set(id, inspector)
      emit('extension', { type: 'inspector', id })
      return () => {
        if (inspectors.get(id) === inspector) inspectors.delete(id)
      }
    },

    registerTimeline(id: string, timeline: DevToolsTimeline = {}): () => void {
      if (disposed || !id) return () => undefined
      timelines.set(id, timeline)
      emit('extension', { type: 'timeline', id })
      return () => {
        if (timelines.get(id) === timeline) timelines.delete(id)
      }
    },

    registerMetric(id: string, metric: DevToolsMetric): () => void {
      if (disposed || !id) return () => undefined
      metrics.set(id, metric)
      emit('extension', { type: 'metric', id })
      return () => {
        if (metrics.get(id) === metric) metrics.delete(id)
      }
    },

    getExtensionSnapshot,

    inspectExtension(id: string, value: unknown): unknown {
      const inspector = inspectors.get(id)
      if (!inspector) return undefined
      return safeExtensionCall(
        () => serializeForDevTools(inspector.inspect(value), new Set<object>(), 0, privacy),
        undefined
      )
    },

    onUpdate(callback: (trace: UpdateTrace) => void): () => void {
      return subscribe('update', callback)
    },

    subscribe,

    dispose(): void {
      if (disposed) return
      disposed = true
      if (getDebugHooks() === hooks) setDebugHooks(previousHooks)
      if (getRuntimeDebugHooks() === runtimeHooks) setRuntimeDebugHooks(previousRuntimeHooks)
      if (getHTTPDebugHooks() === httpHooks) setHTTPDebugHooks(previousHTTPHooks)
      if (activeDevTools === api) activeDevTools = null
      if (target && target.__VOBS_DEVTOOLS__ === api) {
        if (previousGlobal) target.__VOBS_DEVTOOLS__ = previousGlobal
        else delete target.__VOBS_DEVTOOLS__
      }
      target?.removeEventListener?.('error', onGlobalError)
      target?.removeEventListener?.('unhandledrejection', onUnhandledRejection)
      listeners.clear()
      for (const { stop } of [...routerStops.values()]) stop()
      routerStops.clear()
      routerContext = null
      pendingUpdates.length = 0
      pendingFlushScheduled = false
      activeEffectId = null
      inspectors.clear()
      timelines.clear()
      metrics.clear()
    }
  }

  if (shouldExpose && target) target.__VOBS_DEVTOOLS__ = api
  activeDevTools = api
  if (options.router) attachRouter(options.router)
  return api
}

export function enableDevTools(options: DevToolsOptions = {}): DevToolsAPI {
  return createDevTools(options)
}

export function disableDevTools(): void {
  activeDevTools?.dispose()
}

export function getDevTools(): DevToolsAPI | null {
  return activeDevTools
}

/** Connects a browser panel through a small postMessage protocol. */
export function connectDevTools(options: DevToolsBridgeOptions = {}): () => void {
  const target = options.target ?? defaultMessageTarget()
  const api = options.api ?? activeDevTools
  if (!target || !api) return () => undefined

  const send = (message: DevToolsWireResponse | DevToolsWireEvent): void => {
    try {
      target.postMessage(message, '*')
    } catch {
      // A panel disappearing during navigation must not affect the application.
    }
  }
  const unsubscribes = DEVTOOLS_EVENTS.map(event => api.subscribe(event, (...args: unknown[]) => {
    send({
      source: 'vobs-devtools',
      type: 'event',
      event,
      payload: args.length === 1 ? args[0] : args
    })
  }))
  const onMessage = (event: DevToolsMessageEvent): void => {
    const request = parseRequest(event.data)
    if (!request) return
    try {
      send({
        source: 'vobs-devtools',
        type: 'response',
        id: request.id,
        ok: true,
        result: invokeRequest(api, request)
      })
    } catch (error) {
      send({
        source: 'vobs-devtools',
        type: 'response',
        id: request.id,
        ok: false,
        error: toErrorMessage(error)
      })
    }
  }
  target.addEventListener('message', onMessage)

  return () => {
    target.removeEventListener('message', onMessage)
    for (const unsubscribe of unsubscribes) unsubscribe()
  }
}

export function devtoolsPlugin(options: DevToolsPluginOptions = {}): VobsPlugin {
  return {
    name: '@vobs/devtools',
    version: '0.1.0',
    install(context: VobsContext) {
      if (options.enabled === false) return
      const devtools = createDevTools(options)
      const removeErrorObserver = context.onError(error => {
        const phase: DevToolsErrorPhase = readErrorProperty(error, 'vobsCode') === 'VOBS_HYDRATION_MISMATCH'
          || Boolean(readErrorProperty(error, 'vobsHydration'))
          ? 'hydration'
          : 'application'
        devtools.reportError(phase, error, {
          handled: false,
          recovery: 'propagated'
        })
      })
      return () => {
        removeErrorObserver()
        devtools.dispose()
      }
    }
  }
}

function defaultTarget(): DevToolsTarget | undefined {
  return typeof window === 'undefined' ? undefined : window
}

function defaultMessageTarget(): DevToolsMessageTarget | undefined {
  return typeof window === 'undefined' ? undefined : window as unknown as DevToolsMessageTarget
}

function parseRequest(value: unknown): DevToolsWireRequest | null {
  if (!value || typeof value !== 'object') return null
  const request = value as Partial<DevToolsWireRequest>
  if (request.source !== 'vobs-devtools' || request.type !== 'request') return null
  if (typeof request.id !== 'string' || typeof request.method !== 'string') return null
  return request as DevToolsWireRequest
}

function invokeRequest(api: DevToolsAPI, request: DevToolsWireRequest): unknown {
  const args = request.args ?? []
  switch (request.method) {
    case 'getComponentTree': return api.getComponentTree()
    case 'getComponent': return api.getComponent(String(args[0] ?? ''))
    case 'getSignals': return api.getSignals()
    case 'getSignal': return api.getSignal(String(args[0] ?? ''))
    case 'canMutate': return api.canMutate()
    case 'setSignalValue': return api.setSignalValue(String(args[0] ?? ''), args[1])
    case 'getDependencies': return api.getDependencies(String(args[0] ?? ''))
    case 'getDependents': return api.getDependents(String(args[0] ?? ''))
    case 'getEffects': return api.getEffects()
    case 'getUpdates': return api.getUpdates()
    case 'getLifecycleEvents': return api.getLifecycleEvents()
    case 'getNetworkRequests': return api.getNetworkRequests()
    case 'importSSRRequests': api.importSSRRequests(args[0]); return undefined
    case 'getRouterContext': return api.getRouterContext()
    case 'getErrors': return api.getErrors()
    case 'getPerformanceEntries': return api.getPerformanceEntries()
    case 'getCollectionState': return api.getCollectionState()
    case 'setCollectionPaused': api.setCollectionPaused(Boolean(args[0])); return undefined
    case 'clearUpdates': api.clearUpdates(); return undefined
    case 'clearNetworkRequests': api.clearNetworkRequests(); return undefined
    case 'clearErrors': api.clearErrors(); return undefined
    case 'clearLifecycleEvents': api.clearLifecycleEvents(); return undefined
    case 'getPerformanceMetrics': return api.getPerformanceMetrics()
    case 'takeMemorySnapshot': return api.takeMemorySnapshot()
    case 'exportDiagnostics': return api.exportDiagnostics()
    case 'importDiagnostics': api.importDiagnostics(args[0]); return undefined
    case 'getExtensionSnapshot': return api.getExtensionSnapshot()
    case 'inspectExtension': return api.inspectExtension(String(args[0] ?? ''), args[1])
    default: throw new Error(`Vobs DevTools: 未知请求 ${request.method}`)
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function toDebugError(error: unknown, phase?: string): DebugErrorInfo {
  const normalized = normalizeVobsError(error)
  const value = error as {
    name?: unknown
    message?: unknown
    stack?: unknown
    vobsSource?: { file?: unknown; line?: unknown; column?: unknown }
    vobsCode?: unknown
    code?: unknown
    vobsHint?: unknown
    vobsHydration?: RuntimeHydrationMismatch
  } | null
  const source = value?.vobsSource ?? normalized.location
  return {
    name: typeof value?.name === 'string' ? value.name : normalized.name,
    message: typeof value?.message === 'string' ? value.message : normalized.message,
    stack: typeof value?.stack === 'string' ? value.stack : normalized.stack,
    phase,
    source: source && typeof source.file === 'string'
      ? `${source.file}:${source.line ?? 0}:${source.column ?? 0}`
      : undefined,
    location: source && typeof source.file === 'string' && typeof source.line === 'number' && typeof source.column === 'number'
      ? { file: source.file, line: source.line, column: source.column }
      : undefined,
    code: typeof value?.vobsCode === 'string'
      ? value.vobsCode
      : typeof value?.code === 'string' ? value.code : undefined,
    hint: typeof value?.vobsHint === 'string' ? value.vobsHint : undefined,
    cause: normalized.cause instanceof Error ? `${normalized.cause.name}: ${normalized.cause.message}` : normalized.cause === undefined ? undefined : String(normalized.cause),
    fix: normalized.fix,
    hydration: value?.vobsHydration && typeof value.vobsHydration === 'object' ? value.vobsHydration : undefined
  }
}

interface ErrorClassification {
  readonly origin: DevToolsErrorOrigin
  readonly code?: string
  readonly hint?: string
}

const FRAMEWORK_ERROR_RULES: readonly { pattern: RegExp; origin: DevToolsErrorOrigin; code: string; hint: string }[] = [
  { pattern: /响应式更新超过\s*100\s*轮/, origin: 'framework', code: 'VOBS_REACTIVITY_LOOP', hint: '检查 Effect 是否在执行时持续写入它依赖的 Signal。' },
  { pattern: /Fragment: (?:不能跨父节点移动|Fragment 不属于指定父节点|找不到结束锚点)/, origin: 'framework', code: 'VOBS_FRAGMENT_INVARIANT', hint: '检查 Fragment 的父节点和插入/删除顺序，通常表示运行时树结构已不一致。' },
  { pattern: /当前渲染器不支持 Hydration/, origin: 'usage', code: 'VOBS_HYDRATION_UNSUPPORTED', hint: '请使用支持 Hydration 的 Renderer，或改用 app.mount()。' },
  { pattern: /(?:HydrationMismatchError|Vobs hydration:|服务端 DOM 与客户端渲染结构不一致|节点位置与客户端渲染结果不一致)/, origin: 'framework', code: 'VOBS_HYDRATION_MISMATCH', hint: '检查服务端和客户端是否生成了相同的节点结构与初始状态。' },
  { pattern: /渲染器未初始化/, origin: 'usage', code: 'VOBS_RENDERER_NOT_INITIALIZED', hint: '请在应用 mount 或 hydrate 后调用 Runtime DOM API。' },
  { pattern: /节点不属于指定父节点/, origin: 'framework', code: 'VOBS_DOM_PARENT_MISMATCH', hint: '检查节点是否被重复移动、删除，或被错误的 Renderer 实例管理。' }
]

function classifyError(phase: DevToolsErrorPhase, error: unknown, context: DevToolsErrorContext): ErrorClassification {
  const message = toErrorMessage(error)
  const explicitCode = context.code
    ?? readErrorProperty(error, 'vobsCode')
    ?? readErrorProperty(error, 'code')
    ?? extractErrorCode(message)
  const frameworkRule = FRAMEWORK_ERROR_RULES.find(rule => rule.pattern.test(message))
  if (frameworkRule) return { origin: context.origin ?? frameworkRule.origin, code: explicitCode ?? frameworkRule.code, hint: context.hint ?? frameworkRule.hint }
  if (context.origin) return { origin: context.origin, code: explicitCode, hint: context.hint }
  if ((explicitCode && isUsageErrorCode(explicitCode))
    || (/^Vobs(?:\s|:)|^VOBS_/.test(message) && /必须|不能为空|找不到|缺少|不存在|无效|不能直接|重复|未配置|已销毁/.test(message))) {
    return { origin: 'usage', code: explicitCode, hint: context.hint ?? '检查调用参数、Owner 作用域和相关插件是否已安装。' }
  }
  if (phase === 'global') return { origin: 'unknown', code: explicitCode, hint: context.hint }
  return { origin: 'application', code: explicitCode, hint: context.hint }
}

function isUsageErrorCode(code: string): boolean {
  return /^(?:INVALID_|.*_(?:CONTEXT_MISSING|CONTEXT_DISPOSED|OPTIONS|MISSING|UNAVAILABLE))/.test(code)
}

function extractErrorCode(message: string): string | undefined {
  return message.match(/\b[A-Z][A-Z0-9_]{2,}_[A-Z0-9_]+\b/)?.[0]
}

function readErrorProperty(error: unknown, key: string): string | undefined {
  if (!error || (typeof error !== 'object' && typeof error !== 'function')) return undefined
  const value = (error as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : undefined
}

function mergeRecovery(previous: DevToolsErrorRecovery, next: DevToolsErrorRecovery | undefined): DevToolsErrorRecovery {
  if (!next) return previous
  if (next === 'retrying') return next
  if (next === 'recovered') return next
  if (next === 'fallback') return next
  if (previous === 'fallback') return previous
  return next
}

function diagnosticErrorKey(error: Pick<DevToolsErrorTrace, 'origin' | 'code' | 'name' | 'message' | 'source' | 'component'>): string {
  return [error.origin, error.code ?? error.name, error.message, error.source ?? '', error.component ?? ''].join(':')
}

function sanitizeImportedError(error: DevToolsErrorTrace): DevToolsErrorTrace {
  const phase = error.phase ?? 'global'
  return {
    ...error,
    phase,
    phases: Array.isArray(error.phases) && error.phases.length > 0 ? error.phases : [phase],
    origin: error.origin ?? 'unknown',
    handled: error.handled === true,
    recovery: error.recovery ?? 'propagated'
  }
}

function parseDiagnosticSnapshot(value: unknown): DevToolsDiagnosticSnapshot {
  if (!value || typeof value !== 'object') throw new Error('Vobs DevTools: invalid diagnostic snapshot')
  const snapshot = value as Partial<DevToolsDiagnosticSnapshot>
  if (snapshot.version !== 1
    || !Array.isArray(snapshot.updates)
    || !Array.isArray(snapshot.lifecycle)
    || !Array.isArray(snapshot.network)
    || !Array.isArray(snapshot.errors)
    || !snapshot.performance
    || !snapshot.memory) {
    throw new Error('Vobs DevTools: unsupported diagnostic snapshot')
  }
  if (!snapshot.updates.every(item => isRecord(item)
    && typeof item.id === 'string'
    && typeof item.duration === 'number'
    && Array.isArray(item.effects)
    && Array.isArray(item.affectedSignals)
    && Array.isArray(item.affectedEffects)
    && Array.isArray(item.domUpdates))
    || !snapshot.lifecycle.every(item => isRecord(item) && typeof item.id === 'string' && typeof item.type === 'string')
    || !snapshot.network.every(item => isRecord(item) && typeof item.id === 'number' && typeof item.url === 'string' && isRecord(item.headers))
    || !snapshot.errors.every(item => isRecord(item) && typeof item.id === 'number' && typeof item.message === 'string')
    || !isRecord(snapshot.performance)
    || typeof snapshot.performance.updateCount !== 'number'
    || typeof snapshot.performance.effectExecutionCount !== 'number'
    || !isRecord(snapshot.memory)) {
    throw new Error('Vobs DevTools: malformed diagnostic snapshot')
  }
  return snapshot as DevToolsDiagnosticSnapshot
}

function parseSSRRequestSnapshot(value: unknown): readonly HTTPDebugRequest[] {
  const candidate = value && typeof value === 'object' && !Array.isArray(value)
    ? value as { readonly version?: unknown; readonly environment?: unknown; readonly requests?: unknown }
    : { version: 1, environment: 'server', requests: value }
  if (candidate.version !== 1 || candidate.environment !== 'server' || !Array.isArray(candidate.requests)) {
    throw new Error('Vobs DevTools: invalid SSR request snapshot')
  }
  if (!candidate.requests.every(item => isRecord(item)
    && typeof item.id === 'number'
    && typeof item.url === 'string'
    && typeof item.method === 'string'
    && typeof item.startedAt === 'number'
    && isRecord(item.headers))) {
    throw new Error('Vobs DevTools: malformed SSR request snapshot')
  }
  return candidate.requests as HTTPDebugRequest[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

interface NormalizedPrivacyOptions {
  readonly redactedHeaders: readonly string[]
  readonly redactedFields: readonly string[]
  readonly redactDomValues: boolean
  readonly replacement: string
}

function normalizePrivacyOptions(options: DevToolsPrivacyOptions | undefined): NormalizedPrivacyOptions {
  return {
    redactedHeaders: options?.redactedHeaders ?? [],
    redactedFields: options?.redactedFields ?? [],
    redactDomValues: options?.redactDomValues ?? false,
    replacement: options?.replacement ?? '[Redacted]'
  }
}

function sanitizeImportedUpdate(update: UpdateTrace, privacy: NormalizedPrivacyOptions): UpdateTrace {
  return {
    ...update,
    previousValue: serializeForDevTools(update.previousValue, new Set<object>(), 0, privacy),
    nextValue: serializeForDevTools(update.nextValue, new Set<object>(), 0, privacy),
    domUpdates: update.domUpdates.map(mutation => ({
      ...mutation,
      previousValue: privacy.redactDomValues ? privacy.replacement : serializeForDevTools(mutation.previousValue, new Set<object>(), 0, privacy),
      nextValue: privacy.redactDomValues ? privacy.replacement : serializeForDevTools(mutation.nextValue, new Set<object>(), 0, privacy)
    }))
  }
}

function sanitizeImportedRequest(request: NetworkRequestTrace, privacy: NormalizedPrivacyOptions): NetworkRequestTrace {
  return {
    ...request,
    headers: redactHeaders(request.headers, privacy),
    requestBody: serializeForDevTools(request.requestBody, new Set<object>(), 0, privacy),
    responseBody: serializeForDevTools(request.responseBody, new Set<object>(), 0, privacy)
  }
}

function redactHeaders(headers: Readonly<Record<string, string>>, privacy: NormalizedPrivacyOptions): Readonly<Record<string, string>> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    if (/authorization|cookie|token|password|secret|api[-_]?key/i.test(key)
      || privacy.redactedHeaders.some(fragment => key.toLowerCase().includes(fragment.toLowerCase()))) continue
    result[key] = value
  }
  return result
}

function serializeForDevTools(value: unknown, seen = new Set<object>(), depth = 0, privacy?: NormalizedPrivacyOptions): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value)
  if (typeof value === 'bigint') return `${value}n`
  if (typeof value === 'undefined') return undefined
  if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`
  if (typeof value === 'symbol') return String(value)
  if (depth >= 4) return '[MaxDepth]'

  const object = value as object
  if (seen.has(object)) return '[Circular]'
  seen.add(object)
  try {
    if (value instanceof Date) return value.toISOString()
    if (value instanceof Error) return { name: value.name, message: value.message }
    if (Array.isArray(value)) return value.slice(0, 100).map(item => serializeForDevTools(item, seen, depth + 1, privacy))

    const result: Record<string, unknown> = {}
    for (const key of Object.keys(object).slice(0, 100)) {
      try {
        if (privacy?.redactedFields.some(field => field.toLowerCase() === key.toLowerCase())) {
          result[key] = privacy.replacement
        } else {
          result[key] = serializeForDevTools((object as Record<string, unknown>)[key], seen, depth + 1, privacy)
        }
      } catch {
        result[key] = '[Uninspectable]'
      }
    }
    return result
  } finally {
    seen.delete(object)
  }
}

declare global {
  interface Window {
    __VOBS_DEVTOOLS__?: DevToolsAPI
  }
}
