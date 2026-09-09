import { KitPage } from '@vobs/kit'
import { Alert, Button, Card, Tag } from '@vobs/ui'
import { AsyncBoundary, Profiler, cloneTemplate, createId, createOwner, createTemplate, effect, insertList, memo, onDispose, ref, state } from '@vobs/vobs'
import { useI18n } from '@vobs/i18n'

export function RuntimePage() {
  const i18n = useI18n()
  return (
    <KitPage class="demo-shell" title={i18n.t('runtime.title')} description={i18n.t('runtime.description')}>
      <div class="demo-section-grid">
        <StateMemoDemo />
        <EffectDemo />
        <OwnerDemo />
        <RefDemo />
        <StableIdDemo />
        <KeyedListDemo />
        <TemplateDemo />
        <AsyncBoundaryDemo />
        <ProfilerDemo />
      </div>
      <Alert tone="info" title="DevTools" description="Open DevTools Signals, Effects and Timeline panels to inspect the interactions on this page." />
    </KitPage>
  )
}

function StateMemoDemo() {
  const i18n = useI18n()
  const count = state(0)
  const doubled = memo(() => count.value * 2)
  return (
    <Card title={i18n.t('runtime.stateTitle')} description={i18n.t('runtime.stateDescription')}>
      <div class="demo-control-stack">
        <div class="demo-button-row">
          <Button variant="brand" onClick={() => { count.value++ }}>{i18n.t('runtime.increment')}</Button>
          <Button variant="ghost" onClick={() => { count.value = 0 }}>{i18n.t('common.reset')}</Button>
        </div>
        <Tag tone="brand">{i18n.t('runtime.currentValue', { value: count.value })}</Tag>
        <Tag tone="success">{i18n.t('runtime.derivedValue', { value: doubled.value })}</Tag>
      </div>
    </Card>
  )
}

function EffectDemo() {
  const i18n = useI18n()
  const dependency = state(0)
  const effectRuns = state(0)
  const cleanupRuns = state(0)
  let runCount = 0
  let cleanupCount = 0
  effect(() => {
    dependency.value
    effectRuns.value = ++runCount
    return () => { cleanupRuns.value = ++cleanupCount }
  })
  return (
    <Card title={i18n.t('runtime.effectTitle')} description={i18n.t('runtime.effectDescription')}>
      <div class="demo-control-stack">
        <Button variant="secondary" onClick={() => { dependency.value++ }}>{i18n.t('runtime.triggerEffect')}</Button>
        <span class="demo-muted">Dependency: {dependency.value}</span>
        <span class="demo-muted">{i18n.t('runtime.effectRuns', { count: effectRuns.value })}</span>
        <span class="demo-muted">{i18n.t('runtime.cleanupRuns', { count: cleanupRuns.value })}</span>
      </div>
    </Card>
  )
}

function OwnerDemo() {
  const i18n = useI18n()
  const active = state(true)
  const owner = createOwner()
  owner.run(() => {
    onDispose(() => { active.value = false })
  })
  onDispose(() => { owner.dispose() })
  return (
    <Card title={i18n.t('runtime.ownerTitle')} description={i18n.t('runtime.ownerDescription')}>
      <div class="demo-control-stack">
        <Tag tone={active.value ? 'success' : 'neutral-strong'}>{active.value ? i18n.t('runtime.ownerActive') : i18n.t('runtime.ownerDisposed')}</Tag>
        <Button variant="danger" disabled={!active.value} onClick={() => { owner.dispose() }}>{i18n.t('runtime.disposeOwner')}</Button>
      </div>
    </Card>
  )
}

function RefDemo() {
  const i18n = useI18n()
  const inputRef = ref<HTMLInputElement>()
  return (
    <Card title={i18n.t('runtime.refTitle')} description={i18n.t('runtime.refDescription')}>
      <div class="demo-control-stack">
        <input ref={inputRef} value="A ref-bound input" class="demo-text-input" />
        <Button variant="secondary" onClick={() => { inputRef.current?.focus() }}>{i18n.t('runtime.focusInput')}</Button>
        <span class="demo-muted">{i18n.t('runtime.refReady')}</span>
      </div>
    </Card>
  )
}

function StableIdDemo() {
  const i18n = useI18n()
  const labelId = createId('runtime-label')
  const inputId = createId('runtime-input')
  return (
    <Card title={i18n.t('runtime.idTitle')} description={i18n.t('runtime.idDescription')}>
      <div class="demo-control-stack">
        <label id={labelId}>Accessible field</label>
        <input id={inputId} aria-labelledby={labelId} value="Stable ID" />
        <span class="demo-muted">{i18n.t('runtime.labelId', { id: labelId })}</span>
        <span class="demo-muted">{i18n.t('runtime.inputId', { id: inputId })}</span>
      </div>
    </Card>
  )
}

interface RuntimeListItem {
  readonly id: number
  readonly label: string
}

function KeyedListDemo() {
  const i18n = useI18n()
  const items = state<readonly RuntimeListItem[]>([
    { id: 1, label: 'Alpha' },
    { id: 2, label: 'Beta' },
    { id: 3, label: 'Gamma' }
  ], 'runtime.list.items')
  const events = state<string[]>([])
  let nextId = 4

  function record(action: string, label: string): void {
    events.value = [`${action}: ${label}`, ...events.value].slice(0, 4)
  }

  function shuffle(): void {
    const shuffled = [...items.value].sort(() => Math.random() - 0.5)
    items.value = shuffled
    record(i18n.t('runtime.listShuffle'), shuffled[0]?.label ?? '')
  }

  function removeFirst(): void {
    const [removed] = items.value
    if (!removed) return
    items.value = items.value.slice(1)
    record(i18n.t('runtime.listRemove'), removed.label)
  }

  function addItem(): void {
    const item = { id: nextId++, label: `Item ${nextId - 1}` }
    items.value = [...items.value, item]
    record(i18n.t('runtime.listAdd'), item.label)
  }

  // 挂载时把 keyed 列表插入宿主节点；DOM 复用可通过 DevTools Elements 观察节点顺序。
  function attachList(node: HTMLUListElement): void {
    insertList(
      node,
      null,
      () => items.value,
      item => <li class="demo-muted">{item.label} <code>#{item.id}</code></li>,
      item => item.id
    )
  }

  return (
    <Card title={i18n.t('runtime.listTitle')} description={i18n.t('runtime.listDescription')}>
      <div class="demo-control-stack">
        <div class="demo-button-row">
          <Button size="sm" variant="secondary" onClick={addItem}>{i18n.t('runtime.listAdd')}</Button>
          <Button size="sm" variant="secondary" onClick={removeFirst}>{i18n.t('runtime.listRemove')}</Button>
          <Button size="sm" variant="ghost" onClick={shuffle}>{i18n.t('runtime.listShuffle')}</Button>
        </div>
        <ul ref={attachList} class="demo-keyed-list" />
        {events.value.length > 0 ? <span class="demo-muted">{events.value.join(' · ')}</span> : null}
      </div>
    </Card>
  )
}

function TemplateDemo() {
  const i18n = useI18n()
  const template = createTemplate('<span>cloned template node</span>')
  const clones = state(0)
  let host: HTMLDivElement | null = null

  function addClone(): void {
    if (!host) return
    host.append(cloneTemplate(template))
    clones.value++
  }

  function resetClones(): void {
    if (!host) return
    host.replaceChildren()
    clones.value = 0
  }

  return (
    <Card title={i18n.t('runtime.templateTitle')} description={i18n.t('runtime.templateDescription')}>
      <div class="demo-control-stack">
        <div class="demo-button-row">
          <Button size="sm" variant="secondary" onClick={addClone}>{i18n.t('runtime.templateClone')}</Button>
          <Button size="sm" variant="ghost" disabled={clones.value === 0} onClick={resetClones}>{i18n.t('common.reset')}</Button>
        </div>
        <div ref={node => { host = node }} class="demo-template-host" />
        <Tag tone="brand">{i18n.t('runtime.templateCount', { value: clones.value })}</Tag>
      </div>
    </Card>
  )
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function AsyncBoundaryDemo() {
  const i18n = useI18n()
  const requestKey = state(0)
  let deferred = createDeferred<string>()
  const startRequest = () => {
    deferred = createDeferred<string>()
    requestKey.value++
  }
  return (
    <Card title={i18n.t('runtime.asyncTitle')} description={i18n.t('runtime.asyncDescription')}>
      <div class="demo-control-stack">
        <div class="demo-button-row">
          <Button variant="brand" onClick={startRequest}>{i18n.t('runtime.startRequest')}</Button>
          <Button variant="secondary" onClick={() => { deferred.resolve('Payload from AsyncBoundary') }}>{i18n.t('runtime.resolve')}</Button>
          <Button variant="danger" onClick={() => { deferred.reject(new Error('Simulated request failure')) }}>{i18n.t('runtime.reject')}</Button>
        </div>
        <AsyncBoundary
          promise={() => deferred.promise}
          resetKey={() => requestKey.value}
          loading={<Tag tone="warning">{i18n.t('runtime.loading')}</Tag>}
          fallback={(error, retry) => <div class="demo-control-stack"><Tag tone="danger">{i18n.t('runtime.rejected', { error: error.message })}</Tag><Button size="sm" variant="ghost" onClick={retry}>{i18n.t('common.retry')}</Button></div>}
        >
          {value => <Tag tone="success">{i18n.t('runtime.resolved', { value })}</Tag>}
        </AsyncBoundary>
      </div>
    </Card>
  )
}

function ProfilerDemo() {
  const i18n = useI18n()
  const viewVersion = state(0)
  const snapshotVersion = state(0)
  let latestPhase = 'idle'
  let latestDuration = 0
  const refreshSnapshot = () => { snapshotVersion.value++ }
  return (
    <Card title={i18n.t('runtime.profilerTitle')} description={i18n.t('runtime.profilerDescription')}>
      <div class="demo-control-stack">
        <div class="demo-button-row">
          <Button variant="secondary" onClick={() => { viewVersion.value++ }}>{i18n.t('runtime.updateView')}</Button>
          <Button variant="ghost" onClick={refreshSnapshot}>{i18n.t('runtime.refreshSnapshot')}</Button>
        </div>
        <Profiler id="runtime-demo" onRender={info => { latestPhase = info.phase; latestDuration = info.duration }}>
          {() => <span class="demo-muted">Profiled render #{viewVersion.value}</span>}
        </Profiler>
        {snapshotVersion.value > 0 ? <span class="demo-muted">{i18n.t('runtime.lastRender', { phase: latestPhase, duration: latestDuration.toFixed(2) })}</span> : <span class="demo-muted">{i18n.t('runtime.noRender')}</span>}
      </div>
    </Card>
  )
}
