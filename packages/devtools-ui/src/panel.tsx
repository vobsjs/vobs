import {
  getDevTools,
  type ComponentDebugNode,
  type DevToolsAPI,
  type DevToolsErrorTrace,
  type DevToolsRouterContext,
  type DevToolsSelection,
  type EffectExecutionInfo,
  type EffectDebugInfo,
  type LifecycleEvent,
  type NetworkRequestTrace,
  type SignalDebugInfo,
  type UpdateTrace
} from '@vobs/devtools'
import { HTTP_KEY, type HTTPClient, type HTTPMethod } from '@vobs/http'
import type { Router, RouterDevToolsAPI, RouteDebugNode, RouteRecord, RouterDataRequestTrace, RouteErrorTrace } from '@vobs/router'
import { effect } from '@vobs/reactivity'
import { createComponent, createElement, createFragment, createText, inject, insertBefore, insertDynamic, onDispose, setAttribute, setProperty, state, type VobsNode } from '@vobs/vobs'
import { Alert, Button, Card, Icon, Select, Tabs, Tag } from '@vobs/ui'

export interface DevToolsSnapshot {
  readonly api: DevToolsAPI | null
  readonly tree: readonly ComponentDebugNode[]
  readonly signals: readonly SignalDebugInfo[]
  readonly effects: readonly EffectDebugInfo[]
  readonly updates: readonly UpdateTrace[]
  readonly lifecycle: readonly LifecycleEvent[]
  readonly network: readonly NetworkRequestTrace[]
  readonly errors: readonly DevToolsErrorTrace[]
  readonly metrics: ReturnType<DevToolsAPI['getPerformanceMetrics']> | null
  readonly performanceEntries: ReturnType<DevToolsAPI['getPerformanceEntries']>
  readonly memory: ReturnType<DevToolsAPI['takeMemorySnapshot']> | null
  readonly router: RouterDevToolsAPI | null
  readonly routerContext: DevToolsRouterContext | null
}

export interface DevToolsPanelProps {
  readonly api?: DevToolsAPI | null
  readonly router?: Router | null
  readonly http?: HTTPClient | null
  readonly query?: { value: string }
  readonly toolbarPlacement?: 'content' | 'header' | 'none'
}

const EMPTY_SNAPSHOT: DevToolsSnapshot = {
  api: null,
  tree: [],
  signals: [],
  effects: [],
  updates: [],
  lifecycle: [],
  network: [],
  errors: [],
  metrics: null,
  performanceEntries: [],
  memory: null,
  router: null,
  routerContext: null
}

// The panel itself performs DOM work and creates reactive effects. Listening to
// creation/mutation events here would make the inspector refresh itself forever.
const PANEL_REFRESH_EVENTS = ['signal-update', 'update', 'lifecycle', 'network-request', 'router', 'error', 'collection', 'collection-cleared'] as const

export function readDevToolsSnapshot(api: DevToolsAPI | null = getDevTools()): DevToolsSnapshot {
  return readDevToolsSnapshotWithRouter(api, null)
}

function readDevToolsSnapshotWithRouter(api: DevToolsAPI | null, router: Router | null): DevToolsSnapshot {
  if (!api) return { ...EMPTY_SNAPSHOT, router: router?.devtools ?? null }
  return {
    api,
    tree: api.getComponentTree(),
    signals: api.getSignals(),
    effects: api.getEffects(),
    updates: api.getUpdates(),
    lifecycle: api.getLifecycleEvents(),
    network: api.getNetworkRequests(),
    errors: api.getErrors(),
    metrics: api.getPerformanceMetrics(),
    performanceEntries: api.getPerformanceEntries(),
    memory: api.takeMemorySnapshot(),
    router: router?.devtools ?? null,
    routerContext: api.getRouterContext()
  }
}

export function DevToolsPanel(props: DevToolsPanelProps = {}) {
  const refreshCount = state(0)
  const activeSection = state<DevToolsSection>('updates')
  const activeAdvancedSection = state<AdvancedSection>('signals')
  const activeRouterTab = state<RouterPanelTab>('context')
  const activeUpdatesTab = state<UpdatesPanelTab>('updates')
  const activeComponentsTab = state<ComponentsPanelTab>('tree')
  const activeRouteView = state<'tree' | 'list'>('tree')
  const activeTimelineFilter = state<TimelineFilter>('all')
  const networkSelection = state<string | null>(null)
  const networkSourceFilter = state<NetworkSourceFilter>('all')
  const networkStatusFilter = state<NetworkStatusFilter>('all')
  const networkDetailTab = state<NetworkDetailTab>('overview')
  const networkTesterOpen = state(false)
  const networkTesterRevision = state(0)
  const networkTesterRun = state<RequestTesterRun>({ status: 'idle' })
  const networkTesterTab = state<RequestTesterTab>('params')
  let networkTesterDraft = createRequestTesterDraft()
  const selection = state<DevToolsSelection | null>(null)
  const query = props.query ?? state('')
  const http = props.http ?? inject(HTTP_KEY) ?? null
  let refreshInvalidating = false

  const notifyRefresh = (): void => {
    // The panel's own local signals are also visible to the runtime hooks. Do
    // not recursively invalidate it while handling the update it just caused.
    if (refreshInvalidating) return
    refreshInvalidating = true
    refreshCount.value++
    queueMicrotask(() => { refreshInvalidating = false })
  }

  // Event callbacks only invalidate the panel. The next reactive render reads a fresh snapshot.
  queueMicrotask(notifyRefresh)
  const api = resolveApi(props)
  if (api) {
    const stops = PANEL_REFRESH_EVENTS.map(event => api.subscribe(event, notifyRefresh))
    onDispose(() => { for (const stop of stops) stop() })
  }
  const router = props.router ?? null
  if (router) {
    const detachRouter = api?.attachRouter(router)
    const stopNavigationStart = router.devtools.subscribe('navigation:start', notifyRefresh)
    const stopNavigation = router.devtools.subscribe('navigation:end', notifyRefresh)
    const stopRouteUpdate = router.devtools.subscribe('route:update', notifyRefresh)
    const stopRouteError = router.devtools.subscribe('error', notifyRefresh)
    onDispose(() => { stopNavigationStart(); stopNavigation(); stopRouteUpdate(); stopRouteError(); detachRouter?.() })
  }

  const toolbarPlacement = props.toolbarPlacement ?? 'content'
  return <div class="vobs-devtools-shell">
    <aside class="vobs-devtools-shell__rail" aria-label="DevTools sections">
      <div class="vobs-devtools-shell__mark"><Icon name="code" /></div>
      <SectionNav activeSection={activeSection} />
    </aside>
    <section class="vobs-devtools-shell__main">
      <div class="vobs-devtools-shell__content">{toolbarPlacement === 'content' ? <DevToolsToolbar api={api} query={query} /> : null}<DevToolsContent refreshCount={refreshCount} activeSection={activeSection} activeAdvancedSection={activeAdvancedSection} activeRouterTab={activeRouterTab} activeUpdatesTab={activeUpdatesTab} activeComponentsTab={activeComponentsTab} activeRouteView={activeRouteView} router={router} api={api} http={http} selection={selection} query={query} networkSelection={networkSelection} networkSourceFilter={networkSourceFilter} networkStatusFilter={networkStatusFilter} networkDetailTab={networkDetailTab} networkTesterOpen={networkTesterOpen} networkTesterRevision={networkTesterRevision} networkTesterRun={networkTesterRun} networkTesterDraft={networkTesterDraft} networkTesterTab={networkTesterTab} /></div>
    </section>
    <ActivityRail refreshCount={refreshCount} router={router} api={api} selection={selection} activeSection={activeSection} activeFilter={activeTimelineFilter} />
  </div>
}

export function DevToolsToolbar(props: { readonly api: DevToolsAPI | null; readonly query: { value: string }; readonly maximized?: boolean; readonly onToggleMaximize?: () => void }): VobsNode {
  const refreshCount = state(0)
  if (props.api) {
    const stops = ['collection', 'collection-cleared'].map(event => props.api!.subscribe(event, () => { refreshCount.value++ }))
    onDispose(() => { for (const stop of stops) stop() })
  }
  return createFragment((parent, anchor) => {
    const toolbar = createElement('div')
    setAttribute(toolbar, 'class', 'vobs-devtools-collection-toolbar vobs-devtools-collection-toolbar--header')
    const search = createElement('input')
    setAttribute(search, 'class', 'vobs-devtools-search vobs-devtools-header-search')
    setAttribute(search, 'type', 'search')
    setAttribute(search, 'placeholder', 'Search diagnostics')
    // This must be its own reactive effect. Reading query while mounting the
    // dialog header makes the header slot depend on the query and replaces the
    // focused input after every keystroke.
    effect(() => {
      const next = props.query.value
      if ((search as HTMLInputElement).value !== next) setProperty(search, 'value', next)
    })
    search.addEventListener('input', () => { props.query.value = (search as HTMLInputElement).value })
    insertBefore(toolbar, search, null)
    const actions = createElement('div')
    setAttribute(actions, 'class', 'vobs-devtools-collection-toolbar__actions')
    insertBefore(toolbar, actions, null)
    insertBefore(parent, toolbar, anchor)

    insertDynamic(actions, null, () => {
      void refreshCount.value
      if (!props.api) return null
      const paused = props.api.getCollectionState().paused
      return createFragment((actionParent, actionAnchor) => {
      insertBefore(actionParent, createComponent(Button, {
        variant: paused ? 'warning' : 'secondary',
        iconOnly: true,
        icon: createComponent(Icon, { name: paused ? 'play' : 'pause' }),
        'aria-label': paused ? 'Resume collection' : 'Pause collection',
        title: paused ? 'Resume collection' : 'Pause collection',
        onClick: () => props.api?.setCollectionPaused(!paused)
      }), actionAnchor)
      insertBefore(actionParent, createComponent(Button, {
        variant: 'danger-subtle',
        iconOnly: true,
        icon: createComponent(Icon, { name: 'trash' }),
        'aria-label': 'Clear diagnostics',
        title: 'Clear diagnostics',
        onClick: () => {
        props.api?.clearUpdates()
        props.api?.clearNetworkRequests()
        props.api?.clearErrors()
        props.api?.clearLifecycleEvents()
        }
      }), actionAnchor)
      const exportDiagnostics = (): void => {
        const data = JSON.stringify(props.api?.exportDiagnostics(), null, 2)
        if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function' || typeof URL.revokeObjectURL !== 'function' || typeof Blob === 'undefined') return
        const link = document.createElement('a')
        link.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }))
        link.download = `vobs-devtools-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
        link.click()
        URL.revokeObjectURL(link.href)
      }
      insertBefore(actionParent, createComponent(Button, {
        variant: 'ghost',
        iconOnly: true,
        icon: createComponent(Icon, { name: 'download' }),
        'aria-label': 'Export diagnostics',
        title: 'Export diagnostics',
        onClick: exportDiagnostics
      }), actionAnchor)
      const importInput = createElement('input')
      setAttribute(importInput, 'type', 'file')
      setAttribute(importInput, 'accept', 'application/json,.json')
      setAttribute(importInput, 'aria-label', 'Import diagnostics')
      setAttribute(importInput, 'hidden', '')
      importInput.addEventListener('change', () => {
        const file = (importInput as HTMLInputElement).files?.[0]
        if (!file) return
        void file.text().then(text => props.api?.importDiagnostics(JSON.parse(text))).catch(error => props.api?.reportError('global', error))
      })
      insertBefore(actionParent, importInput, actionAnchor)
      insertBefore(actionParent, createComponent(Button, {
        variant: 'ghost',
        iconOnly: true,
        icon: createComponent(Icon, { name: 'upload' }),
        'aria-label': 'Import diagnostics',
        title: 'Import diagnostics',
        onClick: () => (importInput as HTMLInputElement).click()
      }), actionAnchor)
      if (props.onToggleMaximize) insertBefore(actionParent, createComponent(Button, {
        variant: 'ghost',
        iconOnly: true,
        icon: createComponent(Icon, { name: props.maximized ? 'arrow-minimize' : 'arrow-expand' }),
        'aria-label': props.maximized ? 'Restore DevTools' : 'Maximize DevTools',
        title: props.maximized ? 'Restore DevTools' : 'Maximize DevTools',
        onClick: props.onToggleMaximize
      }), actionAnchor)
      })
    })
  })
}

type DevToolsSection = 'router' | 'components' | 'advanced' | 'updates' | 'network' | 'errors'
type AdvancedSection = 'signals' | 'effects'
type RouterPanelTab = 'context' | 'requests' | 'errors' | 'history' | 'routes'
type UpdatesPanelTab = 'performance' | 'slow' | 'updates'
type ComponentsPanelTab = 'tree' | 'lifecycle'
type TimelineFilter = 'all' | 'update' | 'request' | 'navigation' | 'error'
type NetworkSourceFilter = 'all' | 'http' | 'router' | 'ssr'
type NetworkStatusFilter = 'all' | 'loading' | 'success' | 'error' | 'cancelled'
type NetworkDetailTab = 'overview' | 'headers' | 'payload' | 'response' | 'timing' | 'context'

interface NetworkEntry {
  readonly key: string
  readonly source: 'http' | 'router' | 'ssr'
  readonly method: string
  readonly url: string
  readonly status: string
  readonly duration?: number
  readonly startedAt?: number
  readonly endedAt?: number
  readonly request?: NetworkRequestTrace
  readonly routerRequest?: DevToolsRouterContext['dataRequests'][number]
}

interface RequestTesterParam {
  key: string
  value: string
}

interface RequestTesterDraft {
  url: string
  method: HTTPMethod
  params: RequestTesterParam[]
  headers: RequestTesterParam[]
  body: string
}

type RequestTesterRun = { status: 'idle' | 'running' | 'success' | 'error'; message?: string }
type RequestTesterTab = 'params' | 'headers' | 'body'

function createRequestTesterDraft(url = ''): RequestTesterDraft {
  return { url, method: 'GET', params: [{ key: '', value: '' }], headers: [{ key: '', value: '' }], body: '' }
}

const TIMELINE_FILTER_OPTIONS: readonly { readonly value: TimelineFilter; readonly label: string }[] = [
  { value: 'all', label: 'All events' },
  { value: 'update', label: 'Updates' },
  { value: 'request', label: 'Requests' },
  { value: 'navigation', label: 'Navigation' },
  { value: 'error', label: 'Errors' }
]

function resolveApi(props: DevToolsPanelProps): DevToolsAPI | null {
  return props.api === undefined ? getDevTools() : props.api
}

interface DevToolsContentProps {
  readonly refreshCount: { readonly value: number }
  readonly activeSection: { readonly value: DevToolsSection }
  readonly activeAdvancedSection: { value: AdvancedSection }
  readonly activeRouterTab: { value: RouterPanelTab }
  readonly activeUpdatesTab: { value: UpdatesPanelTab }
  readonly activeComponentsTab: { value: ComponentsPanelTab }
  readonly activeRouteView: { value: 'tree' | 'list' }
  readonly router: Router | null
  readonly api: DevToolsAPI | null
  readonly http: HTTPClient | null
  readonly selection: { value: DevToolsSelection | null }
  readonly query: { value: string }
  readonly networkSelection: { value: string | null }
  readonly networkSourceFilter: { value: NetworkSourceFilter }
  readonly networkStatusFilter: { value: NetworkStatusFilter }
  readonly networkDetailTab: { value: NetworkDetailTab }
  readonly networkTesterOpen: { value: boolean }
  readonly networkTesterRevision: { value: number }
  readonly networkTesterRun: { value: RequestTesterRun }
  readonly networkTesterDraft: RequestTesterDraft
  readonly networkTesterTab: { value: RequestTesterTab }
}

interface ActivityRailProps {
  readonly refreshCount: { readonly value: number }
  readonly router: Router | null
  readonly api: DevToolsAPI | null
  readonly selection: { value: DevToolsSelection | null }
  readonly activeSection: { value: DevToolsSection }
  readonly activeFilter: { value: TimelineFilter }
}

function DevToolsContent(props: DevToolsContentProps) {
  return createFragment((parent, anchor) => {
    insertDynamic(parent, anchor, () => {
      void props.refreshCount.value
      void props.activeSection.value
      void props.activeRouterTab.value
      void props.activeUpdatesTab.value
      void props.activeComponentsTab.value
      void props.activeRouteView.value
      void props.query.value
      void props.networkSelection.value
      void props.networkSourceFilter.value
      void props.networkStatusFilter.value
      void props.networkDetailTab.value
      void props.networkTesterOpen.value
      void props.networkTesterRevision.value
      void props.networkTesterRun.value
      void props.networkTesterTab.value
      const selected = props.selection.value
      const snapshot = readDevToolsSnapshotWithRouter(props.api, props.router)
      return renderDevToolsContent(snapshot, props.activeSection.value, props.router, props.activeRouterTab, props.activeUpdatesTab, props.activeComponentsTab, selected, focusSelection(props.activeSection, props.selection), props.query.value, props.activeAdvancedSection, props.activeRouteView, props.networkSelection, props.networkSourceFilter, props.networkStatusFilter, props.networkDetailTab, props.query, props.http, props.networkTesterOpen, props.networkTesterRevision, props.networkTesterRun, props.networkTesterDraft, props.networkTesterTab)
    })
  })
}

function ActivityRail(props: ActivityRailProps) {
  return createFragment((parent, anchor) => {
    insertDynamic(parent, anchor, () => {
      void props.refreshCount.value
      const filter = props.activeFilter.value
      const selected = props.selection.value
      const snapshot = readDevToolsSnapshotWithRouter(props.api, props.router)
      const updates = [...snapshot.updates].reverse().slice(0, 8)
      const timeline = collectActivityTimeline(snapshot, props.router, filter)
      return renderActivityRail(updates, timeline, snapshot.api, selected, filter, next => { props.activeFilter.value = next }, focusSelection(props.activeSection, props.selection))
    })
  })
}

function focusSelection(
  activeSection: { value: DevToolsSection },
  selection: { value: DevToolsSelection | null }
): (section: DevToolsSection, next: DevToolsSelection) => void {
  return (section, next) => {
    selection.value = next
    activeSection.value = section
  }
}

function SectionNav(props: { readonly activeSection: { value: DevToolsSection } }): VobsNode {
  return createFragment((parent, anchor) => {
    insertDynamic(parent, anchor, () => {
      const selected = props.activeSection.value
        return createFragment((navParent, navAnchor) => {
        for (const section of ['updates', 'components', 'advanced', 'network', 'errors', 'router'] as const) {
          const label = section === 'components' ? 'comp...' : section === 'advanced' ? 'adv...' : section
          const button = createElement('button')
          setAttribute(button, 'class', `vobs-devtools-shell__nav-item${selected === section ? ' is-active' : ''}`)
          setAttribute(button, 'type', 'button')
          const accessibleLabel = section === 'advanced' ? 'Advanced' : section
          setAttribute(button, 'aria-label', accessibleLabel)
          setAttribute(button, 'title', accessibleLabel)
          setAttribute(button, 'aria-pressed', selected === section ? 'true' : 'false')
          insertBefore(button, createComponent(Icon, { name: section === 'router' ? 'folder' : section === 'components' ? 'code' : section === 'advanced' ? 'atom' : section === 'network' ? 'globe' : section === 'errors' ? 'alert-triangle' : 'refresh' }), null)
          insertBefore(button, createElementText(label), null)
          button.addEventListener('click', () => { props.activeSection.value = section })
          insertBefore(navParent, button, navAnchor)
        }
      })
    })
  })
}

interface ActivityTimelineItem {
  readonly kind: Exclude<TimelineFilter, 'all'>
  readonly timestamp: number
  readonly title: string
  readonly detail?: string
  readonly icon: string
  readonly update?: UpdateTrace
}

function collectActivityTimeline(snapshot: DevToolsSnapshot, router: Router | null, filter: TimelineFilter = 'all'): readonly ActivityTimelineItem[] {
  const items: ActivityTimelineItem[] = snapshot.updates.map(update => ({
    kind: 'update',
    timestamp: update.timestamp,
    title: snapshot.api?.getSignal(update.signalId) ? displaySignalName(snapshot.api.getSignal(update.signalId)!) : displayDebugName(update.signalName),
    detail: `${formatDebugSource(snapshot.api?.getSignal(update.signalId)?.component ?? 'unknown')} · ${update.duration.toFixed(2)} ms · ${update.effects.length} effects`,
    icon: 'zap',
    update
  }))
  for (const request of snapshot.network) {
    items.push({
      kind: 'request',
      timestamp: request.startedAt,
      title: `${request.method} ${request.url}`,
      detail: `${request.source ?? 'http'} · ${request.status}${request.duration === undefined ? '' : ` · ${request.duration} ms`}`,
      icon: 'download'
    })
  }
  for (const request of snapshot.routerContext?.dataRequests ?? []) {
    items.push({
      kind: 'request',
      timestamp: request.startedAt ?? Date.now(),
      title: `${request.kind} · ${request.key}`,
      detail: `${request.status}${request.route ? ` · ${request.route}` : ''}`,
      icon: 'folder'
    })
  }
  for (const trace of router?.devtools.getNavigationHistory() ?? []) {
    items.push({
      kind: 'navigation',
      timestamp: trace.endedAt,
      title: `Navigation ${trace.to}`,
      detail: `${trace.status} · ${trace.duration.toFixed(2)} ms`,
      icon: 'arrow-right'
    })
  }
  for (const error of snapshot.errors) {
    items.push({
      kind: 'error',
      timestamp: error.lastOccurredAt,
      title: `${error.phase} · ${error.message}`,
      detail: error.route ?? error.component,
      icon: 'alert-triangle'
    })
  }
  return items
    .filter(item => filter === 'all' || item.kind === filter)
    .sort((left, right) => right.timestamp - left.timestamp)
    .slice(0, 12)
}

function renderActivityRail(
  updates: readonly UpdateTrace[],
  timeline: readonly ActivityTimelineItem[],
  api: DevToolsAPI | null,
  selection: DevToolsSelection | null,
  filter: TimelineFilter,
  onFilterChange: (filter: TimelineFilter) => void,
  onFocus: (section: DevToolsSection, selection: DevToolsSelection) => void
): VobsNode {
  const root = createElement('aside')
  setAttribute(root, 'class', 'vobs-devtools-shell__activity')
  const header = createElement('div')
  setAttribute(header, 'class', 'vobs-devtools-shell__activity-header')
  const title = createElement('div')
  setAttribute(title, 'class', 'vobs-devtools-shell__activity-title')
  insertBefore(title, createElementText('Timeline'), null)
  insertBefore(header, title, null)
  insertBefore(header, createComponent(Select, {
    class: 'vobs-devtools-timeline-filter',
    value: filter,
    'aria-label': 'Filter timeline events',
    onChange: event => {
      const next = (event.target as HTMLSelectElement).value
      if (isTimelineFilter(next)) onFilterChange(next)
    },
    children: () => createFragment((parent, anchor) => {
      for (const option of TIMELINE_FILTER_OPTIONS) {
        const optionNode = createElement('option')
        setAttribute(optionNode, 'value', option.value)
        insertBefore(optionNode, createText(option.label), null)
        insertBefore(parent, optionNode, anchor)
      }
    })
  }), null)
  insertBefore(root, header, null)
  const subtitle = createElement('div')
  setAttribute(subtitle, 'class', 'vobs-devtools-shell__activity-subtitle')
  insertBefore(subtitle, createElementText(`${timeline.length} shown · ${updates.length} updates`), null)
  insertBefore(root, subtitle, null)
  const list = createElement('div')
  setAttribute(list, 'class', 'vobs-devtools-activity-list')
  for (const entry of timeline) {
    const update = entry.update
    const activityItem = createElement('div')
    setAttribute(activityItem, 'class', `vobs-devtools-activity-item${update && selection?.type === 'update' && selection.id === update.id ? ' is-selected' : ''}`)
    if (update) activityItem.addEventListener('click', () => onFocus('updates', { type: 'update', id: update.id }))
    const dot = createElement('span')
    setAttribute(dot, 'class', 'vobs-devtools-activity-item__dot')
    insertBefore(dot, createComponent(Icon, { name: entry.icon }), null)
    const body = createElement('div')
    setAttribute(body, 'class', 'vobs-devtools-activity-item__body')
    const name = createElement('span')
    setAttribute(name, 'class', 'vobs-devtools-activity-item__name')
    const signal = update ? api?.getSignal(update.signalId) : undefined
    insertBefore(name, createElementText(entry.title), null)
    const detail = createElement('span')
    insertBefore(detail, createElementText(entry.detail ?? (update ? `${formatDebugSource(signal?.component ?? 'unknown')} · ${update.duration.toFixed(2)} ms · ${update.effects.length} effects` : '')), null)
    insertBefore(body, name, null)
    insertBefore(body, detail, null)
    insertBefore(activityItem, dot, null)
    insertBefore(activityItem, body, null)
    insertBefore(list, activityItem, null)
  }
  if (timeline.length === 0) {
    const empty = createElement('span')
    setAttribute(empty, 'class', 'vobs-devtools-muted')
    insertBefore(empty, createElementText(filter === 'all' ? 'No recent events.' : `No ${timelineFilterLabel(filter).toLowerCase()} events.`), null)
    insertBefore(list, empty, null)
  }
  insertBefore(root, list, null)
  return root
}

function isTimelineFilter(value: string): value is TimelineFilter {
  return TIMELINE_FILTER_OPTIONS.some(option => option.value === value)
}

function timelineFilterLabel(filter: TimelineFilter): string {
  return TIMELINE_FILTER_OPTIONS.find(option => option.value === filter)?.label ?? 'All events'
}

function createElementText(value: string): VobsNode {
  return createText(value)
}

function renderDevToolsContent(
  snapshot: DevToolsSnapshot,
  section: DevToolsSection = 'updates',
  router: Router | null = null,
  activeRouterTab?: { value: RouterPanelTab },
  activeUpdatesTab?: { value: UpdatesPanelTab },
  activeComponentsTab?: { value: ComponentsPanelTab },
  selection: DevToolsSelection | null = null,
  onFocus: (section: DevToolsSection, selection: DevToolsSelection) => void = () => undefined,
  query = '',
  activeAdvancedSection?: { value: AdvancedSection },
  activeRouteView?: { value: 'tree' | 'list' },
  networkSelection?: { value: string | null },
  networkSourceFilter?: { value: NetworkSourceFilter },
  networkStatusFilter?: { value: NetworkStatusFilter },
  networkDetailTab?: { value: NetworkDetailTab },
  queryState?: { value: string },
  http?: HTTPClient | null,
  networkTesterOpen?: { value: boolean },
  networkTesterRevision?: { value: number },
  networkTesterRun?: { value: RequestTesterRun },
  networkTesterDraft?: RequestTesterDraft,
  networkTesterTab?: { value: RequestTesterTab }
): VobsNode {
  if (!snapshot.api) {
    return createComponent(Alert, {
      description: 'Enable the devtools plugin to inspect the runtime.'
    })
  }
  return renderFocusedSection(snapshot, section, router, activeRouterTab, activeUpdatesTab, activeComponentsTab, selection, onFocus, query, activeAdvancedSection, activeRouteView, networkSelection, networkSourceFilter, networkStatusFilter, networkDetailTab, queryState, http, networkTesterOpen, networkTesterRevision, networkTesterRun, networkTesterDraft, networkTesterTab)
}

function renderFocusedSection(
  snapshot: DevToolsSnapshot,
  section: DevToolsSection,
  router: Router | null,
  activeRouterTab?: { value: RouterPanelTab },
  activeUpdatesTab?: { value: UpdatesPanelTab },
  activeComponentsTab?: { value: ComponentsPanelTab },
  selection: DevToolsSelection | null = null,
  onFocus: (section: DevToolsSection, selection: DevToolsSelection) => void = () => undefined,
  query = '',
  activeAdvancedSection?: { value: AdvancedSection },
  activeRouteView?: { value: 'tree' | 'list' },
  networkSelection?: { value: string | null },
  networkSourceFilter?: { value: NetworkSourceFilter },
  networkStatusFilter?: { value: NetworkStatusFilter },
  networkDetailTab?: { value: NetworkDetailTab },
  queryState?: { value: string },
  http?: HTTPClient | null,
  networkTesterOpen?: { value: boolean },
  networkTesterRevision?: { value: number },
  networkTesterRun?: { value: RequestTesterRun },
  networkTesterDraft?: RequestTesterDraft,
  networkTesterTab?: { value: RequestTesterTab }
): VobsNode {
  if (section === 'router') return renderRouterSection(router, activeRouterTab, activeRouteView)
  if (section === 'updates') return renderUpdatesSection(snapshot, activeUpdatesTab, query, selection, onFocus)
  if (section === 'components') return renderComponentsSection(snapshot, activeComponentsTab, query, selection, onFocus)
  if (section === 'network') return createComponent(Card, {
    children: () => renderUnifiedNetworkRequests(snapshot.network, snapshot.routerContext?.dataRequests ?? [], query, selection, onFocus, networkSelection, networkSourceFilter, networkStatusFilter, networkDetailTab, snapshot.api, queryState, http, networkTesterOpen, networkTesterRevision, networkTesterRun, networkTesterDraft, snapshot.routerContext?.route, networkTesterTab)
  })
  if (section === 'errors') return createComponent(Card, {
    description: `${snapshot.errors.length} retained unique errors`,
      children: () => renderErrors(filterErrors(snapshot.errors, query), selection, onFocus)
  })
  if (section === 'advanced') return renderAdvancedSection(snapshot, activeAdvancedSection, query)
  const list = createElement('div')
  setAttribute(list, 'class', 'vobs-devtools-list')
  let title = 'Recent updates'
  let description = `${snapshot.updates.length} retained traces`
  return createComponent(Card, { title, description, children: () => list })
}

function renderComponentsSection(
  snapshot: DevToolsSnapshot,
  activeTab?: { value: ComponentsPanelTab },
  query = '',
  selection: DevToolsSelection | null = null,
  onFocus: (section: DevToolsSection, selection: DevToolsSelection) => void = () => undefined
): VobsNode {
  const tabs = createComponent(Tabs, {
    class: 'vobs-devtools-router-tabs',
    variant: 'filled',
    items: [
      { id: 'tree', label: 'Component tree', content: () => renderComponentTree(snapshot, query, selection, onFocus) },
      { id: 'lifecycle', label: 'Lifecycle timeline', content: () => createComponent(Card, {
        class: 'vobs-devtools-lifecycle-card',
        description: `${snapshot.lifecycle.length} retained runtime events`,
        children: () => renderLifecycleTimeline(snapshot.lifecycle, (section, next) => {
          onFocus(section, next)
          if (section === 'components' && activeTab) activeTab.value = 'tree'
        })
      }) }
    ],
    get value() { return activeTab?.value ?? 'tree' },
    onChange: id => { if (activeTab && isComponentsPanelTab(id)) activeTab.value = id }
  })
  const root = createElement('div')
  setAttribute(root, 'class', 'vobs-devtools-components-tabs-wrap')
  insertBefore(root, tabs, null)
  return root
}

function renderComponentTree(
  snapshot: DevToolsSnapshot,
  query: string,
  selection: DevToolsSelection | null,
  onFocus: (section: DevToolsSection, selection: DevToolsSelection) => void
): VobsNode {
  const componentTree = filterComponentTree(snapshot.tree, query)
  const list = createElement('div')
  setAttribute(list, 'class', 'vobs-devtools-list')
  for (const node of componentTree) insertBefore(list, renderComponentSummary(node, snapshot, selection, onFocus), null)
  if (componentTree.length === 0) appendMuted(list, query ? 'No components match the search.' : 'No components recorded.')
  return createComponent(Card, {
    class: 'vobs-devtools-component-tree-card',
    description: `Component tree ${snapshot.memory?.ownerCount ?? 0} active owners`,
    children: () => list
  })
}

function isComponentsPanelTab(value: string): value is ComponentsPanelTab {
  return value === 'tree' || value === 'lifecycle'
}

function renderUpdatesSection(
  snapshot: DevToolsSnapshot,
  activeTab?: { value: UpdatesPanelTab },
  query = '',
  selection: DevToolsSelection | null = null,
  onFocus: (section: DevToolsSection, selection: DevToolsSelection) => void = () => undefined
): VobsNode {
  const tabs = createComponent(Tabs, {
    class: 'vobs-devtools-router-tabs',
    variant: 'filled',
    items: [
      { id: 'performance', label: 'Performance', content: () => renderPerformanceMetrics(snapshot.metrics) },
      { id: 'slow', label: 'Slow items', content: () => renderSlowItems(snapshot.performanceEntries) },
      { id: 'updates', label: `Updates${snapshot.updates.length ? ` (${snapshot.updates.length})` : ''}`, content: () => renderUpdatesList(snapshot, query, selection, onFocus) }
    ],
    get value() { return activeTab?.value ?? 'updates' },
    onChange: id => { if (activeTab && isUpdatesPanelTab(id)) activeTab.value = id }
  })
  const root = createElement('div')
  setAttribute(root, 'class', 'vobs-devtools-updates-tabs-wrap')
  insertBefore(root, tabs, null)
  return root
}

function isUpdatesPanelTab(value: string): value is UpdatesPanelTab {
  return value === 'performance' || value === 'slow' || value === 'updates'
}

function renderUpdatesList(
  snapshot: DevToolsSnapshot,
  query: string,
  selection: DevToolsSelection | null,
  onFocus: (section: DevToolsSection, selection: DevToolsSelection) => void
): VobsNode {
  const list = createElement('div')
  setAttribute(list, 'class', 'vobs-devtools-list')
  for (const update of [...snapshot.updates].reverse().filter(update => matchesQuery(query, update.signalName, update.signalId, update.status, formatValue(update.previousValue), formatValue(update.nextValue))).slice(0, 50)) {
    insertBefore(list, renderUpdateRow(update, snapshot.api, selection, onFocus), null)
  }
  if (snapshot.updates.length === 0) appendMuted(list, 'Interact with the playground to record updates.')
  return createComponent(Card, {
    class: 'vobs-devtools-updates-card',
    children: () => list
  })
}

function renderAdvancedSection(
  snapshot: DevToolsSnapshot,
  activeSection?: { value: AdvancedSection },
  query = ''
): VobsNode {
  const tabs = createComponent(Tabs, {
    class: 'vobs-devtools-advanced-tabs',
    variant: 'filled',
    items: [
      { id: 'signals', label: 'Signals', content: () => renderSignalsInspector(snapshot, query) },
      { id: 'effects', label: 'Effects', content: () => renderEffectsInspector(snapshot, query) }
    ],
    get value() { return activeSection?.value ?? 'signals' },
    onChange: id => { if (activeSection) activeSection.value = id as AdvancedSection }
  })
  const root = createElement('div')
  setAttribute(root, 'class', 'vobs-devtools-advanced')
  insertBefore(root, tabs, null)
  return root
}

function renderSignalsInspector(snapshot: DevToolsSnapshot, query: string): VobsNode {
  const list = createElement('div')
  setAttribute(list, 'class', 'vobs-devtools-list')
  const signals = snapshot.signals.filter(signal => matchesQuery(query, signal.name, signal.component, formatValue(signal.value))).slice(0, 50)
  for (const signal of signals) insertBefore(list, renderSignalInspector(signal, snapshot.api), null)
  if (signals.length === 0) appendMuted(list, query ? 'No signals match the search.' : 'No signals recorded.')
  return list
}

function renderEffectsInspector(snapshot: DevToolsSnapshot, query: string): VobsNode {
  const list = createElement('div')
  setAttribute(list, 'class', 'vobs-devtools-list')
  const effects = snapshot.effects.filter(effect => matchesQuery(query, effect.name, effect.component, effect.id)).slice(0, 50)
  for (const effect of effects) insertBefore(list, renderEffectRow(effect), null)
  if (effects.length === 0) appendMuted(list, query ? 'No effects match the search.' : 'No effects recorded.')
  return list
}

function renderPerformanceMetrics(metrics: DevToolsSnapshot['metrics']): VobsNode {
  if (!metrics) {
    return createComponent(Card, { description: 'Performance: Lightweight slow-path summary for the retained diagnostics.', children: () => {
      const root = createElement('div')
      appendMuted(root, 'No performance data available.')
      return root
    } })
  }
  const metricsGrid = createElement('div')
  setAttribute(metricsGrid, 'class', 'vobs-devtools-performance-metrics')
  appendMetric(metricsGrid, 'Slow updates', metrics.slowUpdateCount)
  appendMetric(metricsGrid, 'Slow effects', metrics.slowEffectCount)
  appendMetric(metricsGrid, 'Slow requests', metrics.slowRequestCount)
  appendMetric(metricsGrid, 'Max update', `${metrics.maxUpdateDuration.toFixed(2)} ms`)
  appendMetric(metricsGrid, 'Max effect', `${metrics.maxEffectDuration.toFixed(2)} ms`)
  appendMetric(metricsGrid, 'Max request', `${metrics.maxRequestDuration.toFixed(2)} ms`)
  return createComponent(Card, {
    class: 'vobs-devtools-performance-card',
    description: 'Lightweight slow-path summary for the retained diagnostics.',
    children: () => metricsGrid
  })
}

function renderSlowItems(entries: DevToolsSnapshot['performanceEntries']): VobsNode {
  const slowEntries = entries.filter(entry => entry.duration >= 16).slice(0, 8)
  const slowList = createElement('div')
  setAttribute(slowList, 'class', 'vobs-devtools-performance-slow-list')
  for (const entry of slowEntries) {
    const item = createElement('div')
    setAttribute(item, 'class', 'vobs-devtools-performance-slow-item')
    appendText(item, entry.kind, 'vobs-devtools-muted')
    appendText(item, formatPerformanceLabel(entry), 'vobs-devtools-list__name')
    appendText(item, `${entry.duration.toFixed(2)} ms`, 'vobs-devtools-code')
    insertBefore(slowList, item, null)
  }
  if (slowEntries.length === 0) appendMuted(slowList, 'No slow items recorded.')
  return createComponent(Card, {
    class: 'vobs-devtools-performance-slow-card',
    description: slowEntries.length ? `${slowEntries.length} retained item${slowEntries.length === 1 ? '' : 's'} at or above 16 ms.` : undefined,
    children: () => slowList
  })
}

function formatPerformanceLabel(entry: DevToolsSnapshot['performanceEntries'][number]): string {
  if (entry.kind === 'request') return entry.label
  const formatted = formatDebugLocation(entry.label)
  const openParen = formatted.indexOf('(')
  const closeParen = openParen >= 0 ? formatted.indexOf(')', openParen) : -1
  if (openParen < 0 || closeParen < 0) return stripDebugLocation(entry.label)
  const componentName = formatted.slice(0, openParen).trim()
  const source = formatted.slice(openParen + 1, closeParen)
  const fileName = source.split('/').pop() ?? source
  const suffix = formatted.slice(closeParen + 1).trim()
  return [componentName, fileName, suffix].filter(Boolean).join(' ')
}

function appendMetric(parent: Element, label: string, value: number | string): void {
  const row = createElement('div')
  setAttribute(row, 'class', 'vobs-devtools-performance-item')
  appendText(row, label, 'vobs-devtools-muted')
  appendText(row, String(value), 'vobs-devtools-list__name')
  insertBefore(parent, row, null)
}

function renderRouterSection(
  router: Router | null,
  activeRouterTab?: { value: RouterPanelTab },
  activeRouteView?: { value: 'tree' | 'list' }
): VobsNode {
  if (!router) return createComponent(Alert, { tone: 'warning', title: 'Router unavailable', description: 'Pass a Router instance to inspect route activity.' })
  const devtools = router.devtools
  const root = createElement('div')
  setAttribute(root, 'class', 'vobs-devtools-router')
  const current = devtools.getCurrentRoute()
  const state = devtools.getNavigationState()
  const metrics = devtools.getPerformanceMetrics()
  const activeRequests = devtools.getDataRequests().filter(request => request.route === current.fullPath || request.key.startsWith(`${current.fullPath}#`))
  const activeErrors = devtools.getErrors().filter(error => error.route === current.fullPath)
  const toolbar = createElement('div')
  setAttribute(toolbar, 'class', 'vobs-devtools-panel__toolbar')
  insertBefore(toolbar, createComponent(Button, { variant: 'secondary', icon: createComponent(Icon, { name: 'refresh' }), children: () => 'Revalidate current route', onClick: () => { void devtools.revalidate(current.fullPath) } }), null)
  const tabs = createComponent(Tabs, {
    class: 'vobs-devtools-router-tabs',
    variant: 'filled',
    items: [
      { id: 'context', label: 'Context', content: () => createRouterContextPanel(current, state) },
      { id: 'requests', label: `Requests${activeRequests.length ? ` (${activeRequests.length})` : ''}`, content: () => createComponent(Card, { title: `Data requests for ${current.path}`, description: 'Loader, action and fetcher traces for the active route.', children: () => renderDataRequests(activeRequests) }) },
      { id: 'errors', label: `Errors${activeErrors.length ? ` (${activeErrors.length})` : ''}`, content: () => createComponent(Card, { title: `Errors for ${current.path}`, description: `${activeErrors.length} errors captured for the active route.`, children: () => renderRouterErrors(activeErrors) }) },
      { id: 'history', label: 'History', content: () => createComponent(Card, { title: 'Navigation history', description: `${metrics.navigationCount} recorded navigations · ${metrics.averageNavigationDuration.toFixed(2)} ms average`, children: () => renderNavigationHistory(devtools.getNavigationHistory(), router) }) },
      { id: 'routes', label: 'Route map', content: () => createComponent(Card, {
        title: 'Route map',
        description: 'All registered routes and their source locations.',
        children: () => renderRouteMap(devtools.getRouteTree(), router, activeRouteView)
      }) }
    ],
    get value() { return activeRouterTab?.value ?? 'context' },
    onChange: id => { if (activeRouterTab) activeRouterTab.value = id as RouterPanelTab }
  })
  const tabsWrap = createElement('div')
  setAttribute(tabsWrap, 'class', 'vobs-devtools-router-tabs-wrap')
  insertBefore(tabsWrap, tabs, null)
  insertBefore(tabsWrap, toolbar, null)
  insertBefore(root, tabsWrap, null)
  return root
}

function createRouterContextPanel(current: ReturnType<RouterDevToolsAPI['getCurrentRoute']>, state: ReturnType<RouterDevToolsAPI['getNavigationState']>): VobsNode {
  return createFragment((parent, anchor) => {
    insertBefore(parent, createComponent(Card, { title: 'Active route', children: () => renderRouterLocation(current, state) }), anchor)
    insertBefore(parent, createComponent(Card, { title: 'Matched route structure', children: () => renderMatchedRoutes(current.matched) }), anchor)
  })
}

function renderDataRequests(requests: readonly RouterDataRequestTrace[]): VobsNode {
  const root = createElement('div')
  setAttribute(root, 'class', 'vobs-devtools-list')
  for (const request of [...requests].reverse().slice(0, 30)) {
    const row = createElement('details')
    setAttribute(row, 'class', 'vobs-devtools-list__row')
    const summary = createElement('summary')
    appendText(summary, `${request.kind} · ${request.key}`, 'vobs-devtools-list__name')
    insertBefore(summary, createComponent(Tag, { tone: request.status === 'success' ? 'success' : request.status === 'error' ? 'danger' : 'warning', children: () => request.status }), null)
    appendText(summary, request.duration === undefined ? 'running' : `${request.duration.toFixed(2)} ms`)
    insertBefore(row, summary, null)
    if (request.error) appendText(row, request.error)
    if (request.status === 'success' && request.result !== undefined) insertBefore(row, renderInspectableValue('Result', request.result), null)
    insertBefore(root, row, null)
  }
  if (requests.length === 0) appendMuted(root, 'No data requests recorded.')
  return root
}

function renderRouterErrors(errors: readonly RouteErrorTrace[]): VobsNode {
  const root = createElement('div')
  setAttribute(root, 'class', 'vobs-devtools-list')
  for (const error of [...errors].reverse().slice(0, 30)) {
    const row = createElement('details')
    setAttribute(row, 'class', 'vobs-devtools-list__row vobs-devtools-error-row')
    const summary = createElement('summary')
    appendText(summary, `${error.phase} · ${error.route}`, 'vobs-devtools-list__name')
    appendText(summary, error.message)
    insertBefore(row, summary, null)
    if (error.stack) appendText(row, error.stack, 'vobs-devtools-code')
    insertBefore(root, row, null)
  }
  if (errors.length === 0) appendMuted(root, 'No route errors recorded.')
  return root
}

function renderRouterLocation(route: ReturnType<RouterDevToolsAPI['getCurrentRoute']>, state: ReturnType<RouterDevToolsAPI['getNavigationState']>): VobsNode {
  const root = createElement('div')
  setAttribute(root, 'class', 'vobs-devtools-list')
  const statusRow = createElement('div')
  setAttribute(statusRow, 'class', 'vobs-devtools-list__row')
  appendText(statusRow, route.fullPath, 'vobs-devtools-list__name')
  insertBefore(statusRow, createComponent(Tag, { tone: state.status === 'error' ? 'danger' : state.status === 'loading' ? 'warning' : 'success', children: () => state.status }), null)
  if (state.status === 'loading') appendText(statusRow, `to ${state.to}`)
  if (state.error) appendText(statusRow, state.error)
  insertBefore(root, statusRow, null)
  insertBefore(root, renderInspectableValue('Params', route.params), null)
  insertBefore(root, renderInspectableValue('Query', route.query), null)
  insertBefore(root, renderInspectableValue('Meta', route.meta), null)
  appendText(root, `outlet ${route.matched.map(record => record.path ?? '(layout)').join('  >  ')}`)
  return root
}

function renderMatchedRoutes(records: readonly RouteRecord[]): VobsNode {
  const root = createElement('div')
  setAttribute(root, 'class', 'vobs-devtools-route-tree')
  records.forEach((record, index) => {
    const row = createElement('div')
    setAttribute(row, 'class', 'vobs-devtools-route-node')
    setAttribute(row, 'style', `--route-depth: ${index}`)
    appendText(row, record.path ?? '(layout)', 'vobs-devtools-list__name')
    appendText(row, routeComponentName(record))
    if (record.source) appendText(row, record.source, 'vobs-devtools-code')
    if (record.loader) insertBefore(row, createComponent(Tag, { tone: 'neutral-strong', children: () => 'loader' }), null)
    if (record.action) insertBefore(row, createComponent(Tag, { tone: 'neutral-strong', children: () => 'action' }), null)
    insertBefore(root, row, null)
  })
  if (records.length === 0) appendMuted(root, 'No matched route records.')
  return root
}

function renderRouteMap(
  nodes: readonly RouteDebugNode[],
  router: Router,
  activeRouteView?: { value: 'tree' | 'list' }
): VobsNode {
  const tree = createElement('div')
  setAttribute(tree, 'class', 'vobs-devtools-route-tree')
  const controls = createElement('div')
  setAttribute(controls, 'class', 'vobs-devtools-route-view-toggle')
  for (const mode of ['tree', 'list'] as const) {
    const button = createElement('button')
    setAttribute(button, 'class', `vobs-devtools-control${(activeRouteView?.value ?? 'tree') === mode ? ' is-active' : ''}`)
    setAttribute(button, 'type', 'button')
    setAttribute(button, 'aria-pressed', (activeRouteView?.value ?? 'tree') === mode ? 'true' : 'false')
    insertBefore(button, createText(mode === 'tree' ? 'Tree' : 'List'), null)
    button.addEventListener('click', () => { if (activeRouteView) activeRouteView.value = mode })
    insertBefore(controls, button, null)
  }
  insertBefore(tree, controls, null)
  const currentPath = router.currentRoute.value.path
  if ((activeRouteView?.value ?? 'tree') === 'list') {
    for (const node of flattenRouteNodes(nodes)) appendRouteConfigNode(tree, node, 0, router, currentPath)
  } else {
    for (const node of nodes) appendRouteConfigNode(tree, node, 0, router, currentPath)
  }
  return tree
}

function flattenRouteNodes(nodes: readonly RouteDebugNode[]): readonly RouteDebugNode[] {
  const result: RouteDebugNode[] = []
  const visit = (node: RouteDebugNode): void => {
    result.push({ ...node, children: [] })
    for (const child of node.children) visit(child)
  }
  for (const node of nodes) visit(node)
  return result
}

function appendRouteConfigNode(parent: Element, node: RouteDebugNode, depth: number, router: Router, currentPath: string): void {
  const concrete = node.children.length === 0 && !node.path.includes(':') && !node.path.includes('*')
  const row = createElement(concrete ? 'button' : 'div')
  setAttribute(row, 'class', `vobs-devtools-route-node${concrete && node.path === currentPath ? ' is-active' : ''}`)
  setAttribute(row, 'style', `--route-depth: ${depth}`)
  appendText(row, node.path, 'vobs-devtools-list__name')
  appendText(row, node.component)
  if (node.source) appendText(row, node.source, 'vobs-devtools-code')
  if (concrete) {
    setAttribute(row, 'type', 'button')
    setAttribute(row, 'title', `Navigate to ${node.path}`)
    row.addEventListener('click', () => { void router.push(node.path) })
  }
  insertBefore(parent, row, null)
  for (const child of node.children) appendRouteConfigNode(parent, child, depth + 1, router, currentPath)
}

function routeComponentName(record: RouteRecord): string {
  const definition = record.component
  if (!definition) return 'Route'
  if (typeof definition === 'function') return definition.name || 'Anonymous'
  return 'lazy(...)'
}

function renderNavigationHistory(history: readonly import('@vobs/router').NavigationTrace[], router: Router): VobsNode {
  const root = createElement('div')
  setAttribute(root, 'class', 'vobs-devtools-list')
  for (const trace of [...history].reverse().slice(0, 30)) {
    const row = createElement('button')
    setAttribute(row, 'class', 'vobs-devtools-list__row')
    setAttribute(row, 'type', 'button')
    setAttribute(row, 'title', `Replay ${trace.to}`)
    appendText(row, `${trace.from}  →  ${trace.to}`, 'vobs-devtools-list__name')
    insertBefore(row, createComponent(Tag, { tone: trace.status === 'success' ? 'success' : trace.status === 'error' ? 'danger' : 'warning', children: () => trace.status }), null)
    appendText(row, `${trace.duration.toFixed(2)} ms · ${trace.source}`)
    row.addEventListener('click', () => { void router.push(trace.to) })
    insertBefore(root, row, null)
  }
  if (history.length === 0) appendMuted(root, 'No navigation history recorded.')
  return root
}

function appendMuted(parent: Element, value: string): void {
  const node = createElement('span')
  setAttribute(node, 'class', 'vobs-devtools-muted')
  insertBefore(node, createText(value), null)
  insertBefore(parent, node, null)
}

function renderSignalInspector(
  signal: SignalDebugInfo,
  api: DevToolsAPI | null
): VobsNode {
  const row = createElement('details')
  setAttribute(row, 'class', 'vobs-devtools-list__row vobs-devtools-signal-row')
  const summary = createElement('summary')
  appendText(summary, displaySignalName(signal), 'vobs-devtools-list__name')
  appendText(summary, previewValue(signal.value), 'vobs-devtools-code')
  insertBefore(summary, createComponent(Tag, { tone: 'neutral-strong', children: () => `${signal.subscribers} subscribers` }), null)
  insertBefore(row, summary, null)
  if (!api) return row
  const dependencies = api.getDependencies(signal.id)
  const dependents = api.getDependents(signal.id)
  insertBefore(row, renderInspectableValue('Current value', signal.value), null)
  appendText(row, `${dependencies.length} dependencies · ${dependents.length} dependents`, 'vobs-devtools-muted')
  if (api.canMutate() && signal.kind !== 'memo') insertBefore(row, renderSignalMutationControl(signal, api), null)
  return row
}

function renderSignalMutationControl(signal: SignalDebugInfo, api: DevToolsAPI): VobsNode {
  const root = createElement('div')
  setAttribute(root, 'class', 'vobs-devtools-mutation-control')
  appendText(root, 'Debug-only value edit (may trigger effects and requests).', 'vobs-devtools-muted')
  const input = createElement('input')
  setAttribute(input, 'class', 'vobs-devtools-search')
  setAttribute(input, 'type', 'text')
  setAttribute(input, 'aria-label', `Edit ${signal.name}`)
  setProperty(input, 'value', formatValue(signal.value))
  const button = createElement('button')
  setAttribute(button, 'class', 'vobs-devtools-control')
  setAttribute(button, 'type', 'button')
  insertBefore(button, createText('Apply debug value'), null)
  button.addEventListener('click', event => {
    event.stopPropagation()
    const raw = (input as HTMLInputElement).value
    let value: unknown = raw
    try { value = JSON.parse(raw) } catch { /* Treat non-JSON input as a string. */ }
    api.setSignalValue(signal.id, value)
  })
  insertBefore(root, input, null)
  insertBefore(root, button, null)
  return root
}

function renderEffectRow(
  effect: EffectDebugInfo
): VobsNode {
  const row = createElement('details')
  setAttribute(row, 'class', 'vobs-devtools-list__row')
  const summary = createElement('summary')
  const component = formatDebugLocation(effect.component)
  appendText(summary, effect.name || `${debugComponentName(component)} effect`, 'vobs-devtools-list__name')
  appendText(summary, formatDebugSource(component))
  insertBefore(summary, createComponent(Tag, { tone: effect.status === 'success' || effect.status === 'idle' ? 'success' : effect.status === 'error' ? 'danger' : 'warning', children: () => effect.status }), null)
  appendText(summary, `${effect.executionCount} runs`)
  insertBefore(row, summary, null)
  appendText(row, `${effect.dependencies.length} dependencies`, 'vobs-devtools-muted')
  if (effect.lastExecutionTime > 0) appendText(row, `last execution ${effect.lastDuration?.toFixed(2) ?? '0.00'} ms · ${effect.lastRunStatus ?? 'unknown'} · ${effect.lastDomUpdates ?? 0} DOM updates`, 'vobs-devtools-muted')
  if (effect.lastUpdateId) appendText(row, `last update ${effect.lastUpdateId}`, 'vobs-devtools-code')
  if (effect.lastError) appendText(row, `${effect.lastError.name}: ${effect.lastError.message}`, 'vobs-devtools-error')
  return row
}

function renderUpdateRow(
  update: UpdateTrace,
  api: DevToolsAPI | null,
  selection: DevToolsSelection | null = null,
  onFocus: (section: DevToolsSection, selection: DevToolsSelection) => void = () => undefined
): VobsNode {
  const row = createElement('details')
  const selected = selection?.type === 'update' && selection.id === update.id
  setAttribute(row, 'class', `vobs-devtools-update-row${selected ? ' is-selected' : ''}`)
  if (selected) setProperty(row, 'open', true)
  const summary = createElement('summary')
  // The update row owns its own selection. Signal and Effect details stay local
  // to this trace and do not navigate to the Advanced inspectors.
  summary.addEventListener('click', () => onFocus('updates', { type: 'update', id: update.id }))
  const signal = api?.getSignal(update.signalId)
  appendText(summary, signal ? displaySignalName(signal) : displayDebugName(update.signalName), 'vobs-devtools-list__name')
  appendText(summary, formatDebugSource(signal?.component ?? 'unknown'), 'vobs-devtools-update-row__source')
  appendText(summary, `${update.duration.toFixed(2)} ms`)
  insertBefore(summary, createComponent(Tag, { tone: update.duration >= 16 ? 'warning' : 'neutral-strong', children: () => `${update.effects.length} effects` }), null)
  insertBefore(row, summary, null)
  insertBefore(row, renderValuePair('Value changed', update.previousValue, update.nextValue), null)
  appendText(row, `status ${update.status} · ${update.affectedSignals.length} signals · ${update.affectedEffects.length} effects`, 'vobs-devtools-muted')
  if (update.error) appendText(row, `${update.error.name}: ${update.error.message}`, 'vobs-devtools-error')
  if (update.effects.length === 0) appendText(row, 'No effects executed.', 'vobs-devtools-muted')
  for (const effect of update.effects) {
    insertBefore(row, renderEffectExecution(effect), null)
    if (effect.error) appendText(row, `${effect.error.name}: ${effect.error.message}`, 'vobs-devtools-error')
  }
  for (const domUpdate of update.domUpdates) {
    const operation = domUpdate.key ? `${domUpdate.operation}.${domUpdate.key}` : domUpdate.operation
    const mutation = createElement('div')
    setAttribute(mutation, 'class', 'vobs-devtools-dom-update')
    appendText(mutation, operation, 'vobs-devtools-list__name')
    appendText(mutation, domUpdate.target, 'vobs-devtools-muted')
    if (domUpdate.previousValue !== undefined || domUpdate.nextValue !== undefined) {
      insertBefore(mutation, renderValuePair('', domUpdate.previousValue, domUpdate.nextValue), null)
    }
    insertBefore(row, mutation, null)
  }
  return row
}

function renderEffectExecution(
  effect: EffectExecutionInfo
): VobsNode {
  const root = createElement('div')
  setAttribute(root, 'class', 'vobs-devtools-effect-execution')
  appendText(root, effect.effectId, 'vobs-devtools-code')
  appendText(root, `${formatDebugSource(effect.component)} · ${effect.duration.toFixed(2)} ms · ${effect.domUpdates} DOM updates · ${effect.status ?? 'success'}`)
  return root
}

function appendUpdateLinks(
  parent: Element,
  ids: readonly string[],
  onFocus: (section: DevToolsSection, selection: DevToolsSelection) => void
): void {
  if (ids.length === 0) {
    appendText(parent, ' none', 'vobs-devtools-muted')
    return
  }
  for (const id of ids) {
    const button = createElement('button')
    setAttribute(button, 'class', 'vobs-devtools-link')
    setAttribute(button, 'type', 'button')
    button.addEventListener('click', event => {
      event.stopPropagation()
      onFocus('updates', { type: 'update', id })
    })
    insertBefore(button, createText(id), null)
    insertBefore(parent, button, null)
  }
}

function renderLifecycleTimeline(
  events: readonly LifecycleEvent[],
  onFocus: (section: DevToolsSection, selection: DevToolsSelection) => void
): VobsNode {
  const root = createElement('div')
  setAttribute(root, 'class', 'vobs-devtools-lifecycle-list')
  for (const event of [...events].reverse().slice(0, 40)) {
    const selection = lifecycleSelection(event)
    const row = createElement(selection?.type === 'component' ? 'button' : 'div')
    setAttribute(row, 'class', 'vobs-devtools-lifecycle-row')
    if (selection?.type === 'component') setAttribute(row, 'type', 'button')
    appendText(row, event.type, 'vobs-devtools-list__name')
    appendText(row, event.name ?? event.targetId)
    appendText(row, event.status ?? '', 'vobs-devtools-muted')
    if (selection?.type === 'component') row.addEventListener('click', () => onFocus('components', selection))
    insertBefore(root, row, null)
  }
  if (events.length === 0) appendMuted(root, 'No lifecycle events recorded.')
  return root
}

function renderUnifiedNetworkRequests(
  requests: readonly NetworkRequestTrace[],
  routerRequests: readonly DevToolsRouterContext['dataRequests'][number][],
  query: string,
  selection: DevToolsSelection | null,
  onFocus: (section: DevToolsSection, selection: DevToolsSelection) => void,
  networkSelection?: { value: string | null },
  sourceFilter?: { value: NetworkSourceFilter },
  statusFilter?: { value: NetworkStatusFilter },
  detailTab?: { value: NetworkDetailTab },
  api?: DevToolsAPI | null,
  queryState?: { value: string },
  http?: HTTPClient | null,
  testerOpen?: { value: boolean },
  testerRevision?: { value: number },
  testerRun?: { value: RequestTesterRun },
  testerDraft?: RequestTesterDraft,
  currentRoute?: string,
  testerTab?: { value: RequestTesterTab }
): VobsNode {
  const root = createElement('div')
  setAttribute(root, 'class', 'vobs-devtools-network-inspector')
  const activeSource = sourceFilter?.value ?? 'all'
  const activeStatus = statusFilter?.value ?? 'all'
  const entries: NetworkEntry[] = [
    ...requests.map<NetworkEntry>(request => ({
      key: `http:${request.id}`,
      source: request.source === 'ssr' ? 'ssr' as const : 'http' as const,
      method: request.method,
      url: request.url,
      status: request.status,
      duration: request.duration,
      startedAt: request.startedAt,
      endedAt: request.endedAt,
      request
    })),
    ...routerRequests.map<NetworkEntry>(request => ({
      key: `router:${request.id}`,
      source: 'router' as const,
      method: request.kind,
      url: request.key,
      status: request.status,
      duration: request.duration,
      startedAt: request.startedAt,
      endedAt: request.endedAt,
      routerRequest: request
    }))
  ].filter(entry => (activeSource === 'all' || entry.source === activeSource) && (activeStatus === 'all' || entry.status === activeStatus) && matchesQuery(query, entry.method, entry.url, entry.status, entry.source, entry.request?.responseStatus, entry.request?.route, entry.routerRequest?.route))
    .sort((left, right) => (right.startedAt ?? 0) - (left.startedAt ?? 0))
  const selectedKey = (selection?.type === 'request' ? `http:${selection.id}` : networkSelection?.value) ?? entries[0]?.key
  const selected = entries.find(entry => entry.key === selectedKey) ?? entries[0]

  const controls = createElement('div')
  setAttribute(controls, 'class', 'vobs-devtools-network-toolbar')
  appendText(controls, 'Search', 'vobs-devtools-network-toolbar__label')
  const search = createElement('input')
  setAttribute(search, 'class', 'vobs-devtools-search vobs-devtools-network-toolbar__search')
  setAttribute(search, 'type', 'search')
  setAttribute(search, 'placeholder', 'Search requests')
  setProperty(search, 'value', query)
  // Commit on Enter/blur so the inspector does not replace the focused input
  // after every keystroke while the reactive panel refreshes.
  search.addEventListener('change', () => { if (queryState) queryState.value = (search as HTMLInputElement).value })
  insertBefore(controls, search, null)
  insertBefore(controls, createNetworkFilterSelect('Source', activeSource, [
    ['all', 'All sources'], ['http', 'HTTP'], ['router', 'Router'], ['ssr', 'SSR']
  ], value => { if (sourceFilter) sourceFilter.value = value as NetworkSourceFilter }), null)
  insertBefore(controls, createNetworkFilterSelect('Status', activeStatus, [
    ['all', 'All statuses'], ['loading', 'Loading'], ['success', 'Success'], ['error', 'Error'], ['cancelled', 'Cancelled']
  ], value => { if (statusFilter) statusFilter.value = value as NetworkStatusFilter }), null)
  if (api) insertBefore(controls, createComponent(Button, {
    variant: 'ghost',
    children: () => 'Clear',
    onClick: () => api.clearNetworkRequests()
  }), null)
  if (testerOpen && testerDraft) insertBefore(controls, createComponent(Button, {
    variant: 'ghost',
    iconOnly: true,
    icon: createComponent(Icon, { name: 'settings' }),
    'aria-label': 'Open Request Tester',
    title: 'Open Request Tester',
    onClick: () => {
      if (!testerDraft.url) testerDraft.url = selected?.url ?? currentRoute ?? ''
      testerOpen.value = true
      testerRevision && (testerRevision.value++)
    }
  }), null)
  insertBefore(root, controls, null)

  const panes = createElement('div')
  setAttribute(panes, 'class', 'vobs-devtools-network-panes')
  const listPane = createElement('section')
  setAttribute(listPane, 'class', 'vobs-devtools-network-list-pane')
  setAttribute(listPane, 'aria-label', 'Network requests')
  const requestList = createElement('div')
  setAttribute(requestList, 'class', 'vobs-devtools-network-request-list')
  setAttribute(requestList, 'role', 'list')
  for (const entry of entries) {
    const row = createElement('button')
    const isSelected = selectedKey === entry.key
    setAttribute(row, 'class', `vobs-devtools-network-request${isSelected ? ' is-selected' : ''}`)
    setAttribute(row, 'type', 'button')
    setAttribute(row, 'role', 'listitem')
    setAttribute(row, 'aria-pressed', isSelected ? 'true' : 'false')
    row.addEventListener('click', () => {
      networkSelection && (networkSelection.value = entry.key)
      if (entry.request) onFocus('network', { type: 'request', id: entry.request.id })
      if (detailTab) detailTab.value = 'overview'
    })
    const pathLine = createElement('span')
    setAttribute(pathLine, 'class', 'vobs-devtools-network-request__path-line')
    appendText(pathLine, entry.url, 'vobs-devtools-network-request__url')
    if (entry.request?.test) insertBefore(pathLine, createComponent(Tag, { tone: 'warning', children: () => 'TEST' }), null)
    insertBefore(pathLine, createComponent(Tag, { tone: entry.status === 'success' ? 'success' : entry.status === 'error' || entry.status === 'cancelled' ? 'danger' : 'warning', children: () => entry.request?.responseStatus ? `${entry.status} ${entry.request.responseStatus}` : entry.status }), null)
    insertBefore(row, pathLine, null)
    const meta = createElement('span')
    setAttribute(meta, 'class', 'vobs-devtools-network-request__meta')
    appendText(meta, entry.duration === undefined ? 'Running' : `${entry.duration.toFixed(0)} ms`)
    appendText(meta, `ID ${entry.request?.id ?? entry.routerRequest?.id}`, 'vobs-devtools-code')
    insertBefore(row, meta, null)
    insertBefore(requestList, row, null)
  }
  insertBefore(listPane, requestList, null)
  if (entries.length === 0) appendMuted(listPane, query || activeSource !== 'all' || activeStatus !== 'all' ? 'No requests match the current filters.' : 'No requests recorded.')
  insertBefore(panes, listPane, null)
  const detailPane = createElement('section')
  setAttribute(detailPane, 'class', 'vobs-devtools-network-detail-pane')
  setAttribute(detailPane, 'aria-label', 'Selected network request')
  if (selected) insertBefore(detailPane, renderNetworkDetail(selected, detailTab?.value ?? 'overview', tab => { if (detailTab) detailTab.value = tab }), null)
  else appendMuted(detailPane, 'Select a request to inspect its details.')
  insertBefore(panes, detailPane, null)
  insertBefore(root, panes, null)
  if (testerOpen?.value && testerDraft) insertBefore(root, renderRequestTester(testerDraft, run => {
    if (testerRun) testerRun.value = run
    testerRevision && (testerRevision.value++)
  }, testerRun?.value ?? { status: 'idle' }, testerTab?.value ?? 'params', selected, http, () => { testerOpen.value = false }, tab => { if (testerTab) testerTab.value = tab; testerRevision && (testerRevision.value++) }), null)
  return root
}

function createNetworkFilterSelect(label: string, value: string, options: readonly (readonly [string, string])[], onChange: (value: string) => void): VobsNode {
  const select = createElement('select')
  setAttribute(select, 'class', 'vobs-devtools-network-toolbar__select')
  setAttribute(select, 'aria-label', label)
  setProperty(select, 'value', value)
  for (const [optionValue, optionLabel] of options) {
    const option = createElement('option')
    setAttribute(option, 'value', optionValue)
    insertBefore(option, createText(optionLabel), null)
    insertBefore(select, option, null)
  }
  setProperty(select, 'value', value)
  select.addEventListener('change', event => onChange((event.target as HTMLSelectElement).value))
  return select
}

function renderRequestTester(
  draft: RequestTesterDraft,
  onRunChange: (run: RequestTesterRun) => void,
  run: RequestTesterRun,
  activeTab: RequestTesterTab,
  selected: NetworkEntry | undefined,
  http: HTTPClient | null | undefined,
  onClose: () => void,
  onTabChange: (tab: RequestTesterTab) => void
): VobsNode {
  const drawer = createElement('aside')
  setAttribute(drawer, 'class', 'vobs-devtools-request-tester')
  setAttribute(drawer, 'aria-label', 'Request Tester')
  const heading = createElement('div')
  setAttribute(heading, 'class', 'vobs-devtools-request-tester__heading')
  appendText(heading, 'Request Tester', 'vobs-devtools-request-tester__title')
  const headingActions = createElement('div')
  setAttribute(headingActions, 'class', 'vobs-devtools-request-tester__heading-actions')
  insertBefore(headingActions, createComponent(Button, {
    variant: 'ghost',
    disabled: !selected,
    children: () => 'Use selected request',
    onClick: () => {
      if (!selected) return
      applyNetworkEntryToTesterDraft(selected, draft)
      onRunChange({ status: 'idle' })
    }
  }), null)
  insertBefore(headingActions, createComponent(Button, {
    variant: 'ghost',
    iconOnly: true,
    icon: createComponent(Icon, { name: 'x' }),
    'aria-label': 'Close Request Tester',
    title: 'Close Request Tester',
    onClick: onClose
  }), null)
  insertBefore(heading, headingActions, null)
  insertBefore(drawer, heading, null)

  const requestLine = createElement('div')
  setAttribute(requestLine, 'class', 'vobs-devtools-request-tester__request-line')
  insertBefore(requestLine, createTesterInput('url', draft.url, value => { draft.url = value }), null)
  insertBefore(requestLine, createTesterMethodSelect(draft.method, value => { draft.method = value; onRunChange({ status: run.status, message: run.message }) }), null)
  insertBefore(requestLine, createComponent(Button, {
    variant: 'brand', iconOnly: true, icon: createComponent(Icon, { name: 'play' }),
    loading: run.status === 'running', disabled: run.status === 'running',
    'aria-label': run.status === 'running' ? 'Running request' : 'Start request',
    title: run.status === 'running' ? 'Running request' : 'Start request',
    onClick: () => { void executeRequestTester(http, draft, onRunChange) }
  }), null)
  insertBefore(drawer, requestLine, null)
  const tabs = createElement('div')
  setAttribute(tabs, 'class', 'vobs-devtools-request-tester__tabs')
  const tabLabels: readonly [RequestTesterTab, string][] = [['params', 'Params'], ['headers', 'Headers'], ['body', 'Body']]
  for (const [tab, label] of tabLabels) {
    const button = createElement('button')
    setAttribute(button, 'class', `vobs-devtools-request-tester__tab${activeTab === tab ? ' is-active' : ''}`)
    setAttribute(button, 'type', 'button')
    setAttribute(button, 'aria-selected', activeTab === tab ? 'true' : 'false')
    appendText(button, label)
    button.addEventListener('click', () => onTabChange(tab))
    insertBefore(tabs, button, null)
  }
  insertBefore(drawer, tabs, null)
  if (activeTab === 'params') insertBefore(drawer, renderTesterParamGroup('Params', draft.params, 'parameter', onRunChange), null)
  if (activeTab === 'headers') insertBefore(drawer, renderTesterParamGroup('Headers', draft.headers, 'header', onRunChange), null)
  if (activeTab === 'body') {
    const bodyLabel = createElement('label')
    setAttribute(bodyLabel, 'class', 'vobs-devtools-request-tester__field')
    appendText(bodyLabel, 'Body')
    const body = createElement('textarea')
    setAttribute(body, 'class', 'vobs-devtools-request-tester__textarea')
    setAttribute(body, 'rows', '8')
    setAttribute(body, 'placeholder', '{ "key": "value" }')
    setProperty(body, 'value', draft.body)
    body.addEventListener('change', () => { draft.body = (body as HTMLTextAreaElement).value })
    insertBefore(bodyLabel, body, null)
    insertBefore(drawer, bodyLabel, null)
  }

  const footer = createElement('div')
  setAttribute(footer, 'class', 'vobs-devtools-request-tester__footer')
  if (run.message) appendText(footer, run.message, `vobs-devtools-request-tester__status${run.status === 'error' ? ' is-error' : run.status === 'success' ? ' is-success' : ''}`)
  insertBefore(drawer, footer, null)
  return drawer
}

function applyNetworkEntryToTesterDraft(entry: NetworkEntry, draft: RequestTesterDraft): void {
  const request = entry.request
  const rawUrl = request?.url ?? entry.url
  let url = rawUrl
  let params: RequestTesterParam[] = []
  try {
    const parsed = new URL(rawUrl, typeof window !== 'undefined' ? window.location.href : 'http://localhost/')
    url = `${parsed.origin === 'http://localhost' && rawUrl.startsWith('/') ? '' : parsed.origin}${parsed.pathname}${parsed.hash}`
    params = [...parsed.searchParams.entries()].map(([key, value]) => ({ key, value }))
  } catch {
    // Keep non-URL request keys intact, such as router loader identifiers.
  }
  draft.url = url
  draft.method = isHTTPMethod(request?.method ?? entry.method) ? (request?.method ?? entry.method) as HTTPMethod : 'GET'
  draft.params = params.length > 0 ? params : [{ key: '', value: '' }]
  draft.headers = request ? Object.entries(request.headers).map(([key, value]) => ({ key, value })) : [{ key: '', value: '' }]
  const body = request?.requestBody
  draft.body = body === undefined || body === null || body === '' ? '' : typeof body === 'string' ? body : JSON.stringify(body, null, 2)
}

function isHTTPMethod(value: string): value is HTTPMethod {
  return ['DELETE', 'GET', 'HEAD', 'OPTIONS', 'PATCH', 'POST', 'PUT'].includes(value)
}

function createTesterInput(name: string, value: string, onChange: (value: string) => void): VobsNode {
  const input = createElement('input')
  setAttribute(input, 'class', 'vobs-devtools-request-tester__input')
  setAttribute(input, 'name', name)
  setAttribute(input, 'type', 'text')
  setProperty(input, 'value', value)
  input.addEventListener('change', () => onChange((input as HTMLInputElement).value))
  return input
}

function createTesterMethodSelect(value: HTTPMethod, onChange: (value: HTTPMethod) => void): VobsNode {
  const select = createElement('select')
  setAttribute(select, 'class', 'vobs-devtools-request-tester__select')
  for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as HTTPMethod[]) {
    const option = createElement('option')
    setAttribute(option, 'value', method)
    if (method === value) setAttribute(option, 'selected', '')
    insertBefore(option, createText(method), null)
    insertBefore(select, option, null)
  }
  select.addEventListener('change', () => onChange((select as HTMLSelectElement).value as HTTPMethod))
  return select
}

function renderTesterParamGroup(label: string, params: RequestTesterParam[], singular: string, onChange: (run: RequestTesterRun) => void): VobsNode {
  const group = createElement('section')
  setAttribute(group, 'class', 'vobs-devtools-request-tester__group')
  const title = createElement('div')
  setAttribute(title, 'class', 'vobs-devtools-request-tester__group-title')
  appendText(title, label)
  const add = createElement('button')
  setAttribute(add, 'class', 'vobs-devtools-request-tester__add')
  setAttribute(add, 'type', 'button')
  appendText(add, '+')
  setAttribute(add, 'aria-label', `Add ${label}`)
  setAttribute(add, 'title', `Add ${label}`)
  add.addEventListener('click', () => { params.push({ key: '', value: '' }); onChange({ status: 'idle' }) })
  insertBefore(title, add, null)
  insertBefore(group, title, null)
  for (let index = 0; index < params.length; index++) {
    const param = params[index]
    const row = createElement('div')
    setAttribute(row, 'class', 'vobs-devtools-request-tester__param')
    insertBefore(row, createTesterInput(`${singular}-key-${index}`, param.key, value => { param.key = value }), null)
    insertBefore(row, createTesterInput(`${singular}-value-${index}`, param.value, value => { param.value = value }), null)
    const remove = createElement('button')
    setAttribute(remove, 'class', 'vobs-devtools-request-tester__remove')
    setAttribute(remove, 'type', 'button')
    setAttribute(remove, 'aria-label', `Remove ${label} row ${index + 1}`)
    setAttribute(remove, 'title', `Remove ${label} row ${index + 1}`)
    insertBefore(remove, createComponent(Icon, { name: 'trash' }), null)
    remove.addEventListener('click', () => { params.splice(index, 1); if (params.length === 0) params.push({ key: '', value: '' }); onChange({ status: 'idle' }) })
    insertBefore(row, remove, null)
    insertBefore(group, row, null)
  }
  return group
}

async function executeRequestTester(http: HTTPClient | null | undefined, draft: RequestTesterDraft, onRunChange: (run: RequestTesterRun) => void): Promise<void> {
  if (!http) {
    onRunChange({ status: 'error', message: 'HTTP client is unavailable.' })
    return
  }
  const url = draft.url.trim()
  if (!url) {
    onRunChange({ status: 'error', message: 'Enter a request URL.' })
    return
  }
  const params: Record<string, string> = {}
  for (const param of draft.params) if (param.key.trim()) params[param.key.trim()] = param.value
  const headers: Record<string, string> = {}
  for (const header of draft.headers) if (header.key.trim()) headers[header.key.trim()] = header.value
  let body: unknown
  if (!['GET', 'HEAD', 'DELETE'].includes(draft.method) && draft.body.trim()) {
    try { body = JSON.parse(draft.body) } catch {
      onRunChange({ status: 'error', message: 'Body must be valid JSON.' })
      return
    }
  }
  onRunChange({ status: 'running', message: undefined })
  try {
    await http.request({
      url,
      method: draft.method,
      params: Object.keys(params).length > 0 ? params : undefined,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      body,
      debugContext: { route: url, test: true }
    })
    onRunChange({ status: 'success', message: 'Request completed.' })
  } catch (error) {
    onRunChange({ status: 'error', message: error instanceof Error ? error.message : String(error) })
  }
}

function renderNetworkDetail(entry: NetworkEntry, activeTab: NetworkDetailTab, onTabChange: (tab: NetworkDetailTab) => void): VobsNode {
  const root = createElement('section')
  setAttribute(root, 'class', 'vobs-devtools-network-detail')
  const request = entry.request
  const routerRequest = entry.routerRequest
  const heading = createElement('div')
  setAttribute(heading, 'class', 'vobs-devtools-network-detail__heading')
  appendText(heading, `${entry.method} ${entry.url}`, 'vobs-devtools-network-detail__title')
  if (request?.test) insertBefore(heading, createComponent(Tag, { tone: 'warning', children: () => 'TEST' }), null)
  insertBefore(heading, createComponent(Tag, { tone: entry.status === 'success' ? 'success' : entry.status === 'error' || entry.status === 'cancelled' ? 'danger' : 'warning', children: () => request?.responseStatus ? `${entry.status} ${request.responseStatus}` : entry.status }), null)
  if (entry.duration !== undefined) appendText(heading, `${entry.duration.toFixed(0)} ms`, 'vobs-devtools-network-detail__duration')
  insertBefore(root, heading, null)
  const tabs = createElement('div')
  setAttribute(tabs, 'class', 'vobs-devtools-network-detail__tabs')
  const tabLabels: readonly [NetworkDetailTab, string][] = [['overview', 'Overview'], ['headers', 'Headers'], ['payload', 'Payload'], ['response', 'Response'], ['timing', 'Timing'], ['context', 'Context']]
  for (const [tab, label] of tabLabels) {
    const button = createElement('button')
    setAttribute(button, 'type', 'button')
    setAttribute(button, 'class', `vobs-devtools-network-detail__tab${activeTab === tab ? ' is-active' : ''}`)
    setAttribute(button, 'aria-selected', activeTab === tab ? 'true' : 'false')
    appendText(button, label)
    button.addEventListener('click', () => onTabChange(tab))
    insertBefore(tabs, button, null)
  }
  insertBefore(root, tabs, null)
  const content = createElement('div')
  setAttribute(content, 'class', 'vobs-devtools-network-detail__content')
  if (activeTab === 'overview') {
    appendNetworkField(content, 'Source', entry.source.toUpperCase())
    appendNetworkField(content, 'Method / Type', entry.method)
    appendNetworkField(content, 'Request key', entry.url, 'code')
    appendNetworkField(content, 'Status', entry.status)
    if (request?.error || routerRequest?.error) appendText(content, request ? `${request.error?.name}: ${request.error?.message}` : routerRequest!.error!, 'vobs-devtools-error')
  } else if (activeTab === 'headers') {
    if (request && Object.keys(request.headers).length > 0) insertBefore(content, renderValueTree('Headers', request.headers, false), null)
    else appendMuted(content, 'No captured headers for this request.')
  } else if (activeTab === 'payload') {
    const payload = request?.requestBody
    if (payload !== undefined) insertBefore(content, renderValueTree('Request body', payload, false), null)
    else appendMuted(content, 'No request payload captured.')
  } else if (activeTab === 'response') {
    const response = request?.responseBody ?? routerRequest?.result
    if (response !== undefined) insertBefore(content, renderValueTree('Response', response, false), null)
    else appendMuted(content, routerRequest?.error ?? 'No response body captured.')
  } else if (activeTab === 'timing') {
    if (entry.startedAt !== undefined) appendNetworkField(content, 'Started at', formatNetworkTimestamp(entry.startedAt))
    if (entry.endedAt !== undefined) appendNetworkField(content, 'Ended at', formatNetworkTimestamp(entry.endedAt))
    appendNetworkField(content, 'Duration', entry.duration === undefined ? 'Running' : `${entry.duration.toFixed(2)} ms`)
    if (request) appendNetworkField(content, 'Attempts', `${request.attempt + 1} (${request.retries} retries)`)
  } else {
    appendNetworkField(content, 'Environment', request?.environment ?? routerRequest?.environment ?? 'client')
    if (request?.route ?? routerRequest?.route) appendNetworkField(content, 'Route', request?.route ?? routerRequest?.route ?? '', 'code')
    if (request?.navigationId ?? routerRequest?.navigationId) appendNetworkField(content, 'Navigation ID', String(request?.navigationId ?? routerRequest?.navigationId), 'code')
    if (request?.dataRequestId !== undefined) appendNetworkField(content, 'Data request ID', String(request.dataRequestId), 'code')
    if (routerRequest?.trigger) appendNetworkField(content, 'Trigger', routerRequest.trigger)
    appendNetworkField(content, 'Request ID', String(request?.id ?? routerRequest?.id), 'code')
  }
  insertBefore(root, content, null)
  return root
}

function appendNetworkField(parent: Element, label: string, value: string, valueKind?: 'code' | 'muted'): void {
  const field = createElement('div')
  setAttribute(field, 'class', 'vobs-devtools-network-detail__field')
  appendText(field, label, 'vobs-devtools-network-detail__label')
  appendText(field, value, `vobs-devtools-network-detail__value${valueKind ? ` vobs-devtools-${valueKind}` : ''}`)
  insertBefore(parent, field, null)
}

function formatNetworkTimestamp(value: number): string {
  const epoch = value > 100_000_000_000 ? value : (typeof performance !== 'undefined' ? performance.timeOrigin + value : Date.now())
  return new Date(epoch).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function matchesQuery(query: string, ...values: readonly unknown[]): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return values.some(value => String(value ?? '').toLowerCase().includes(needle))
}

function filterErrors(errors: readonly DevToolsErrorTrace[], query: string): readonly DevToolsErrorTrace[] {
  return errors.filter(error => matchesQuery(query, error.phase, error.phases, error.origin, error.code, error.name, error.message, error.component, error.route, error.id, error.effectId, error.requestId))
}

function filterComponentTree(nodes: readonly ComponentDebugNode[], query: string): readonly ComponentDebugNode[] {
  if (!query.trim()) return nodes
  return nodes.flatMap(node => {
    const children = filterComponentTree(node.children, query)
    if (!matchesQuery(query, node.name, node.id) && children.length === 0) return []
    return [{ ...node, children }]
  })
}

function renderErrors(
  errors: readonly DevToolsErrorTrace[],
  selection: DevToolsSelection | null,
  onFocus: (section: DevToolsSection, selection: DevToolsSelection) => void
): VobsNode {
  const root = createElement('div')
  setAttribute(root, 'class', 'vobs-devtools-error-list')
  for (const error of [...errors].reverse()) {
    const row = createElement('details')
    const selected = selection?.type === 'error' && selection.id === error.id
    setAttribute(row, 'class', `vobs-devtools-list__row vobs-devtools-error-item${selected ? ' is-selected' : ''}`)
    if (selected) setProperty(row, 'open', true)
    row.addEventListener('click', event => {
      event.stopPropagation()
      onFocus('errors', { type: 'error', id: error.id })
    })
    const summary = createElement('summary')
    appendText(summary, formatErrorSummary(error), 'vobs-devtools-list__name')
    appendText(summary, error.message, 'vobs-devtools-error-item__message')
    insertBefore(summary, createComponent(Tag, { tone: error.origin === 'framework' ? 'danger' : error.origin === 'usage' ? 'warning' : 'neutral-strong', children: () => error.origin }), null)
    insertBefore(summary, createComponent(Tag, { tone: 'danger', children: () => `${error.count}×` }), null)
    insertBefore(row, summary, null)
    const details = createElement('div')
    setAttribute(details, 'class', 'vobs-devtools-error-item__details')
    appendErrorField(details, 'Phase', error.phases.length > 1 ? error.phases.join(' / ') : error.phase)
    appendErrorField(details, 'Occurred', `first ${new Date(error.firstOccurredAt).toLocaleString()} · last ${new Date(error.lastOccurredAt).toLocaleString()}`, 'muted')
    if (error.code) appendErrorField(details, 'Code', error.code, 'code')
    if (error.component) appendErrorField(details, 'Component', displayErrorComponent(error.component))
    if (error.ownerId) appendErrorField(details, 'Owner', error.ownerId, 'code')
    appendErrorField(details, 'Status', `${error.handled ? 'handled' : 'propagated'} · ${error.recovery}`, 'muted')
    if (error.hint) appendErrorField(details, 'Hint', error.hint, 'muted', true)
    if (error.cause) appendErrorField(details, 'Cause', error.cause, 'muted', true)
    if (error.fix) appendErrorField(details, 'Fix', error.fix, 'muted', true)
    if (error.source) appendErrorField(details, 'Source', formatDebugLocation(error.source), 'code', true)
    if (error.updateId) appendErrorLinkField(details, 'Update', error.updateId, 'updates', { type: 'update', id: error.updateId }, onFocus)
    if (error.effectId) appendErrorField(details, 'Effect', error.effectId, 'code')
    if (error.requestId !== undefined) appendErrorLinkField(details, 'Request', String(error.requestId), 'network', { type: 'request', id: error.requestId }, onFocus)
    if (error.navigationId !== undefined) appendErrorField(details, 'Navigation', String(error.navigationId), 'code')
    if (error.route) appendErrorField(details, 'Route', error.route, 'code')
    if (error.hydration) {
      appendErrorField(details, 'Expected', error.hydration.expected, 'code', true)
      appendErrorField(details, 'Actual', error.hydration.actual, 'code', true)
      appendErrorField(details, 'DOM path', error.hydration.path, 'code')
    }
    if (error.stack) appendErrorStack(details, error.stack, error.name, error.message)
    insertBefore(row, details, null)
    insertBefore(root, row, null)
  }
  if (errors.length === 0) appendMuted(root, 'No errors recorded.')
  return root
}

function appendContextLink(
  parent: Element,
  label: string,
  section: DevToolsSection,
  selection: DevToolsSelection,
  onFocus: (section: DevToolsSection, selection: DevToolsSelection) => void
): void {
  const button = createElement('button')
  setAttribute(button, 'class', 'vobs-devtools-link')
  setAttribute(button, 'type', 'button')
  button.addEventListener('click', event => {
    event.stopPropagation()
    onFocus(section, selection)
  })
  insertBefore(button, createText(label), null)
  insertBefore(parent, button, null)
}

function appendErrorField(parent: Element, label: string, value: string, valueKind?: 'code' | 'muted', wide = false): void {
  const field = createElement('div')
  setAttribute(field, 'class', `vobs-devtools-error-item__field${wide ? ' vobs-devtools-error-item__field--wide' : ''}`)
  appendText(field, label, 'vobs-devtools-error-item__label')
  appendText(field, value, `vobs-devtools-error-item__value${valueKind ? ` vobs-devtools-${valueKind}` : ''}`)
  insertBefore(parent, field, null)
}

function appendErrorLinkField(
  parent: Element,
  label: string,
  value: string,
  section: DevToolsSection,
  selection: DevToolsSelection,
  onFocus: (section: DevToolsSection, selection: DevToolsSelection) => void
): void {
  const field = createElement('div')
  setAttribute(field, 'class', 'vobs-devtools-error-item__field')
  appendText(field, label, 'vobs-devtools-error-item__label')
  const valueNode = createElement('span')
  setAttribute(valueNode, 'class', 'vobs-devtools-error-item__value')
  appendContextLink(valueNode, value, section, selection, onFocus)
  insertBefore(field, valueNode, null)
  insertBefore(parent, field, null)
}

function appendErrorStack(parent: Element, value: string, name: string, message: string): void {
  const stack = createElement('div')
  setAttribute(stack, 'class', 'vobs-devtools-error-item__stack')
  appendText(stack, 'Stack trace', 'vobs-devtools-error-item__label')
  const code = createElement('pre')
  setAttribute(code, 'class', 'vobs-devtools-error-item__stack-code vobs-devtools-code')
  insertBefore(code, createText(formatDebugStack(value, name, message)), null)
  insertBefore(stack, code, null)
  insertBefore(parent, stack, null)
}

function formatErrorSummary(error: DevToolsErrorTrace): string {
  const phase = error.phases.length > 1 ? error.phases.join(' / ') : error.phase
  return error.name === 'Error' ? phase : `${phase} · ${error.name}`
}

function lifecycleSelection(event: LifecycleEvent): DevToolsSelection | null {
  if (event.type.startsWith('owner-')) return { type: 'component', id: event.targetId }
  if (event.type.startsWith('signal-') || event.type.startsWith('memo-')) return { type: 'signal', id: event.targetId }
  if (event.type.startsWith('effect-')) return { type: 'effect', id: event.targetId }
  return null
}

function displaySignalName(signal: SignalDebugInfo): string {
  if (!signal.name.startsWith('signal-')) return stripDebugLocation(signal.name)
  const component = formatDebugLocation(signal.component)
  return component === 'unknown' ? 'runtime state' : `${debugComponentName(component)} state`
}

function displayDebugName(name: string): string {
  return name.startsWith('signal-') ? 'runtime state' : stripDebugLocation(name)
}

function debugComponentName(value: string): string {
  const separator = value.indexOf(' (')
  return separator > 0 ? value.slice(0, separator) : value
}

function displayErrorComponent(value: string): string {
  return debugComponentName(formatDebugLocation(value))
}

function appendText(parent: Element, value: string, className?: string): void {
  const node = createElement('span')
  if (className) setAttribute(node, 'class', className)
  insertBefore(node, createText(value), null)
  insertBefore(parent, node, null)
}

function formatDebugLocation(value: string): string {
  const normalized = value.replaceAll('\\', '/')
  const lower = normalized.toLowerCase()
  const sourceIndex = lower.startsWith('src/') ? 0 : lower.indexOf('/src/') + 1
  if (sourceIndex <= 0 && !lower.startsWith('src/')) return normalized
  const sourcePath = normalized.slice(sourceIndex)
  const openParen = normalized.lastIndexOf('(', sourceIndex)
  return openParen >= 0
    ? `${normalized.slice(0, openParen + 1)}${sourcePath}`
    : sourcePath
}

function formatDebugStack(value: string, name: string, message: string): string {
  const lines = value
    .split(/\r?\n/)
    .map(formatDebugStackLine)
  const first = lines[0]?.trim()
  const header = `${name}: ${message}`
  if (lines.length > 1 && (first === header || first?.startsWith(`${header} `))) return lines.slice(1).join('\n')
  return lines.join('\n')
}

function formatDebugStackLine(value: string): string {
  const normalized = value.replaceAll('\\', '/')
  const lower = normalized.toLowerCase()
  const sourceIndex = lower.startsWith('src/') ? 0 : lower.indexOf('/src/') + 1
  if (sourceIndex < 0) return normalized
  if (sourceIndex === 0) return normalized

  const prefixBeforeLocation = normalized.slice(0, sourceIndex)
  const openParen = prefixBeforeLocation.lastIndexOf('(')
  const openBracket = prefixBeforeLocation.lastIndexOf('[')
  const opening = Math.max(openParen, openBracket)
  if (opening >= 0) return `${normalized.slice(0, opening + 1)}${normalized.slice(sourceIndex)}`

  const at = prefixBeforeLocation.lastIndexOf('at ')
  return at >= 0
    ? `${normalized.slice(0, at + 3)}${normalized.slice(sourceIndex)}`
    : normalized.slice(sourceIndex)
}

function formatDebugSource(value: string): string {
  const location = formatDebugLocation(value)
  const openParen = location.indexOf('(')
  if (openParen < 0) return location
  const closeParen = location.indexOf(')', openParen)
  return closeParen < 0 ? location : location.slice(openParen + 1, closeParen)
}

function stripDebugLocation(value: string): string {
  const normalized = value.replaceAll('\\', '/')
  const lower = normalized.toLowerCase()
  const sourceIndex = lower.startsWith('src/') ? 0 : lower.indexOf('/src/') + 1
  if (sourceIndex <= 0 && !lower.startsWith('src/')) return normalized
  const openParen = normalized.lastIndexOf('(', sourceIndex)
  if (openParen < 0) return normalized
  const closeParen = normalized.indexOf(')', sourceIndex)
  if (closeParen < 0) return normalized
  return `${normalized.slice(0, openParen)}${normalized.slice(closeParen + 1)}`.trim()
}

function renderComponentSummary(
  node: ComponentDebugNode,
  snapshot: DevToolsSnapshot,
  selection: DevToolsSelection | null,
  onFocus: (section: DevToolsSection, selection: DevToolsSelection) => void
): VobsNode {
  const row = createElement('details')
  const selected = selection?.type === 'component' && selection.id === node.id
  setAttribute(row, 'class', `vobs-devtools-list__row vobs-devtools-component-row${selected ? ' is-selected' : ''}`)
  if (selected) setProperty(row, 'open', true)
  row.addEventListener('click', event => {
    event.stopPropagation()
    onFocus('components', { type: 'component', id: node.id })
  })

  const summary = createElement('summary')
  appendText(summary, formatDebugLocation(node.name), 'vobs-devtools-list__name')
  insertBefore(summary, createComponent(Tag, { tone: node.mounted ? 'success' : 'neutral-strong', children: () => `${node.signals.length} signals` }), null)
  insertBefore(summary, createComponent(Tag, { tone: 'neutral-strong', children: () => `${node.effects.length} effects` }), null)
  appendText(summary, `${node.recentUpdates.length} updates · ${node.domUpdates} DOM`, 'vobs-devtools-muted')
  insertBefore(row, summary, null)

  appendText(row, `Component ID: ${node.id}`, 'vobs-devtools-code')
  appendText(row, 'Recent updates:', 'vobs-devtools-code')
  appendUpdateLinks(row, node.recentUpdates, onFocus)
  if (node.domUpdates > 0) {
    appendText(row, 'DOM results:', 'vobs-devtools-code')
    for (const updateId of node.recentUpdates) {
      const update = snapshot.updates.find(item => item.id === updateId)
      for (const domUpdate of update?.domUpdates ?? []) {
        const operation = domUpdate.key ? `${domUpdate.operation}.${domUpdate.key}` : domUpdate.operation
        appendText(row, `${operation} ${domUpdate.target}`, 'vobs-devtools-muted')
      }
    }
  }
  if (node.children.length > 0) {
    appendText(row, 'Children:', 'vobs-devtools-code')
    for (const child of node.children) insertBefore(row, renderComponentSummary(child, snapshot, selection, onFocus), null)
  }
  return row
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

function renderValuePair(label: string, previousValue: unknown, nextValue: unknown): VobsNode {
  const root = createElement('div')
  setAttribute(root, 'class', `vobs-devtools-value-pair${label ? '' : ' vobs-devtools-value-pair--compact'}`)
  const distinctMode = state(Boolean(label))
  root.addEventListener('click', event => event.stopPropagation())
  root.addEventListener('pointerdown', event => event.stopPropagation())
  if (label) {
    const title = createElement('div')
    setAttribute(title, 'class', 'vobs-devtools-value-pair__title')
    appendText(title, label)
    const toggle = createElement('button')
    setAttribute(toggle, 'class', 'vobs-devtools-distinct-toggle is-active')
    setAttribute(toggle, 'type', 'button')
    setAttribute(toggle, 'aria-pressed', 'true')
    setAttribute(toggle, 'title', 'Show only values that changed')
    insertBefore(toggle, createText('distinct'), null)
    toggle.addEventListener('click', event => {
      event.stopPropagation()
      const enabled = !distinctMode.value
      distinctMode.value = enabled
      setAttribute(toggle, 'class', `vobs-devtools-distinct-toggle${enabled ? ' is-active' : ''}`)
      setAttribute(toggle, 'aria-pressed', enabled ? 'true' : 'false')
      setAttribute(toggle, 'title', enabled ? 'Show only values that changed' : 'Show complete values')
    })
    insertBefore(title, toggle, null)
    insertBefore(root, title, null)
  }
  insertDynamic(root, null, () => {
    const distinct = distinctMode.value
    const difference = distinct ? createDistinctValuePair(previousValue, nextValue) : null
    const before = difference?.before ?? { value: previousValue, hasDifference: true }
    const after = difference?.after ?? { value: nextValue, hasDifference: true }
    return createFragment((parent, anchor) => {
      insertBefore(parent, renderValueTree('Before', before.value, Boolean(label), distinct && !before.hasDifference ? 'No differing fields' : undefined), anchor)
      insertBefore(parent, renderValueTree('After', after.value, Boolean(label), distinct && !after.hasDifference ? 'No differing fields' : undefined), anchor)
    })
  })
  return root
}

function renderValueTree(label: string, value: unknown, expanded: boolean, emptyMessage?: string): VobsNode {
  const root = createElement('section')
  setAttribute(root, 'class', 'vobs-devtools-value-inspector')
  // Value-tree interactions must not select and rerender their enclosing update row.
  // Otherwise native <details> toggles are immediately replaced by a fresh closed tree.
  root.addEventListener('click', event => event.stopPropagation())
  root.addEventListener('pointerdown', event => event.stopPropagation())
  if (hasExpandableEntries(value)) {
    const controls = createElement('div')
    setAttribute(controls, 'class', 'vobs-devtools-value-inspector__controls')
    insertBefore(controls, createComponent(Button, {
      variant: 'ghost',
      iconOnly: true,
      icon: createComponent(Icon, { name: 'plus' }),
      'aria-label': `Expand all ${label} values`,
      title: `Expand all ${label} values`,
      onClick: event => {
        event.stopPropagation()
        for (const node of root.querySelectorAll('.vobs-devtools-value-tree')) setAttribute(node, 'data-expanded', 'true')
      }
    }), null)
    insertBefore(controls, createComponent(Button, {
      variant: 'ghost',
      iconOnly: true,
      icon: createComponent(Icon, { name: 'minus' }),
      'aria-label': `Collapse all ${label} values`,
      title: `Collapse all ${label} values`,
      onClick: event => {
        event.stopPropagation()
        for (const node of root.querySelectorAll('.vobs-devtools-value-tree')) setAttribute(node, 'data-expanded', 'false')
      }
    }), null)
    insertBefore(root, controls, null)
  }
  const tree = createElement('div')
  setAttribute(tree, 'class', 'vobs-devtools-value-tree-root')
  setAttribute(tree, 'role', 'tree')
  setAttribute(tree, 'aria-label', `${label} value`)
  if (emptyMessage) appendText(tree, emptyMessage, 'vobs-devtools-value-tree__empty')
  else insertBefore(tree, renderInspectableValue(label, value, expanded), null)
  insertBefore(root, tree, null)
  return root
}

interface DistinctValue {
  readonly value: unknown
  readonly hasDifference: boolean
}

interface DistinctValuePair {
  readonly before: DistinctValue
  readonly after: DistinctValue
}

const MISSING_VALUE = Symbol('missing diagnostic value')

function createDistinctValuePair(before: unknown, after: unknown): DistinctValuePair {
  return projectDistinctValues(before, after)
}

function projectDistinctValues(before: unknown, after: unknown): DistinctValuePair {
  if (areValuesEqual(before, after)) {
    return {
      before: { value: before, hasDifference: false },
      after: { value: after, hasDifference: false }
    }
  }

  if (!isExpandableValue(before) || !isExpandableValue(after)) {
    return {
      before: { value: before, hasDifference: true },
      after: { value: after, hasDifference: true }
    }
  }

  if (Array.isArray(before) && Array.isArray(after)) {
    const beforeProjection: unknown[] = new Array(before.length)
    const afterProjection: unknown[] = new Array(after.length)
    for (let index = 0; index < Math.max(before.length, after.length); index++) {
      const child = projectDistinctValues(
        index in before ? before[index] : MISSING_VALUE,
        index in after ? after[index] : MISSING_VALUE
      )
      if (child.before.value !== MISSING_VALUE) beforeProjection[index] = child.before.value
      if (child.after.value !== MISSING_VALUE) afterProjection[index] = child.after.value
    }
    return {
      before: { value: beforeProjection, hasDifference: valueEntries(beforeProjection).length > 0 },
      after: { value: afterProjection, hasDifference: valueEntries(afterProjection).length > 0 }
    }
  }

  if (!Array.isArray(before) && !Array.isArray(after)) {
    const beforeProjection: Record<string, unknown> = {}
    const afterProjection: Record<string, unknown> = {}
    const beforeObject = before as Record<string, unknown>
    const afterObject = after as Record<string, unknown>
    const keys = new Set([...Object.keys(beforeObject), ...Object.keys(afterObject)])
    for (const key of keys) {
      const child = projectDistinctValues(
        Object.prototype.hasOwnProperty.call(beforeObject, key) ? beforeObject[key] : MISSING_VALUE,
        Object.prototype.hasOwnProperty.call(afterObject, key) ? afterObject[key] : MISSING_VALUE
      )
      if (child.before.value !== MISSING_VALUE) beforeProjection[key] = child.before.value
      if (child.after.value !== MISSING_VALUE) afterProjection[key] = child.after.value
    }
    return {
      before: { value: beforeProjection, hasDifference: Object.keys(beforeProjection).length > 0 },
      after: { value: afterProjection, hasDifference: Object.keys(afterProjection).length > 0 }
    }
  }

  return {
    before: { value: before, hasDifference: true },
    after: { value: after, hasDifference: true }
  }
}

function areValuesEqual(before: unknown, after: unknown, seen = new WeakMap<object, WeakSet<object>>()): boolean {
  if (Object.is(before, after)) return true
  if (!isExpandableValue(before) || !isExpandableValue(after)) return false
  if (Array.isArray(before) !== Array.isArray(after)) return false
  if (Object.prototype.toString.call(before) !== Object.prototype.toString.call(after)) return false

  const previousPairs = seen.get(before)
  if (previousPairs?.has(after)) return true
  if (previousPairs) previousPairs.add(after)
  else seen.set(before, new WeakSet([after]))

  const beforeKeys = Object.keys(before)
  const afterKeys = Object.keys(after)
  if (beforeKeys.length !== afterKeys.length) return false
  const beforeObject = before as Record<string, unknown>
  const afterObject = after as Record<string, unknown>
  return beforeKeys.every(key => Object.prototype.hasOwnProperty.call(afterObject, key) && areValuesEqual(beforeObject[key], afterObject[key], seen))
}

function renderInspectableValue(
  label: string,
  value: unknown,
  expanded = false,
  ancestors: readonly object[] = []
): VobsNode {
  if (!hasExpandableEntries(value) || ancestors.includes(value as object)) {
    const row = createElement('div')
    setAttribute(row, 'class', 'vobs-devtools-value-tree__leaf')
    setAttribute(row, 'role', 'treeitem')
    appendText(row, label, 'vobs-devtools-value-field__label')
    appendText(row, ancestors.includes(value as object) ? '[Circular]' : previewValue(value), 'vobs-devtools-code')
    return row
  }

  const root = createElement('div')
  setAttribute(root, 'class', 'vobs-devtools-value-tree')
  setAttribute(root, 'role', 'treeitem')
  setAttribute(root, 'data-expanded', expanded ? 'true' : 'false')
  const summary = createElement('button')
  setAttribute(summary, 'class', 'vobs-devtools-value-tree__summary')
  setAttribute(summary, 'type', 'button')
  setAttribute(summary, 'aria-expanded', expanded ? 'true' : 'false')
  setAttribute(summary, 'title', `Expand ${label}`)
  const toggleExpanded = (): void => {
    const expanded = root.getAttribute('data-expanded') !== 'true'
    setAttribute(root, 'data-expanded', expanded ? 'true' : 'false')
    setAttribute(summary, 'aria-expanded', expanded ? 'true' : 'false')
    setAttribute(summary, 'title', `${expanded ? 'Collapse' : 'Expand'} ${label}`)
  }
  summary.addEventListener('pointerdown', event => {
    event.preventDefault()
    event.stopPropagation()
    toggleExpanded()
  })
  summary.addEventListener('keydown', event => {
    const keyboardEvent = event as KeyboardEvent
    if (keyboardEvent.key !== 'Enter' && keyboardEvent.key !== ' ') return
    event.preventDefault()
    event.stopPropagation()
    toggleExpanded()
  })
  appendText(summary, label, 'vobs-devtools-value-field__label')
  appendText(summary, previewValue(value), 'vobs-devtools-code')
  insertBefore(root, summary, null)

  const children = createElement('div')
  setAttribute(children, 'class', 'vobs-devtools-value-tree__children')
  setAttribute(children, 'role', 'group')
  for (const [key, child] of valueEntries(value)) {
    insertBefore(children, renderInspectableValue(key, child, false, [...ancestors, value as object]), null)
  }
  insertBefore(root, children, null)
  return root
}

function isExpandableValue(value: unknown): value is Record<string, unknown> | readonly unknown[] {
  return typeof value === 'object' && value !== null
}

function hasExpandableEntries(value: unknown): value is Record<string, unknown> | readonly unknown[] {
  return isExpandableValue(value) && valueEntries(value).length > 0
}

function valueEntries(value: Record<string, unknown> | readonly unknown[]): Array<[string, unknown]> {
  if (Array.isArray(value)) return value.slice(0, 100).map((item, index) => [`[${index}]`, item])
  return Object.entries(value).slice(0, 100)
}

function previewValue(value: unknown): string {
  if (value === undefined) return 'undefined'
  if (value === null) return 'null'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value)
  if (Array.isArray(value)) return `Array (${value.length} items)`
  if (typeof value === 'object') return `Object (${Object.keys(value).length} fields)`
  return String(value)
}
