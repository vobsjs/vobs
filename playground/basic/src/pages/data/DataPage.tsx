import { useDict } from '@vobs/dict'
import { useRouter } from '@vobs/router'
import { usePreferences } from '@vobs/preferences'
import { useStorage } from '@vobs/storage'
import { onDispose, state } from '@vobs/vobs'
import { Alert, Button, Card, Checkbox, Input, Select, Tag } from '@vobs/ui'
import { KitPage } from '@vobs/kit'
import { useI18n } from '@vobs/i18n'
import { preferences as playgroundPreferences } from '../../plugins/preferences'
import { isAbortError, waitFor, type Scenario, type Signal } from '../../utils/async'
import { ScenarioPicker } from '../../components/ScenarioPicker'
import { StatusTag } from '../../components/StatusTag'

type RunStatus = 'idle' | 'loading' | 'success' | 'error'

interface RunnerOptions {
  readonly label: string
  readonly status: Signal<RunStatus>
  readonly result: Signal<string>
  readonly scenario: Signal<Scenario>
  readonly task: (signal: AbortSignal, scenario: Scenario) => Promise<unknown>
}

export function DataPage() {
  const i18n = useI18n()
  const storage = useStorage()
  const preferences = usePreferences<typeof playgroundPreferences>()
  const dict = useDict()
  const router = useRouter()
  const storageKey = state('demo-note')
  const storageValue = state(i18n.t('data.defaultStorageValue'))
  const storageRevision = state(0)
  const dictName = 'statuses'
  const dictQuery = dict.query(dictName)
  const actionState = state<RunStatus>('idle')
  const fetcherState = state<RunStatus>('idle')
  const actionResult = state('')
  const fetcherResult = state('')
  const actionScenario = state<Scenario>('success')
  const fetcherScenario = state<Scenario>('success')

  // DataPage 的 action/fetcher 流程完全同构：abort → loading → track → 成功/取消/失败。
  function createRunner(
    kind: 'action' | 'fetcher',
    controllerRef: { current?: AbortController }
  ) {
    onDispose(() => controllerRef.current?.abort())
    return async function run(options: RunnerOptions): Promise<void> {
      controllerRef.current?.abort()
      const controller = new AbortController()
      controllerRef.current = controller
      options.status.value = 'loading'
      try {
        const task = () => options.task(controller.signal, options.scenario.value)
        const outcome = kind === 'action'
          ? await router.devtools.runAction(options.label, task)
          : await router.devtools.runFetcher(options.label, task)
        options.result.value = JSON.stringify(outcome)
        options.status.value = 'success'
      } catch (error) {
        if (isAbortError(error)) {
          options.status.value = 'idle'
          options.result.value = i18n.t('data.operationCancelled')
          return
        }
        options.result.value = error instanceof Error ? error.message : String(error)
        options.status.value = 'error'
      }
    }
  }

  const actionControllerRef: { current?: AbortController } = {}
  const fetcherControllerRef: { current?: AbortController } = {}
  const runAction = createRunner('action', actionControllerRef)
  const runFetcher = createRunner('fetcher', fetcherControllerRef)

  async function runSaveAction(): Promise<void> {
    await runAction({
      label: 'data:save-preferences',
      status: actionState,
      result: actionResult,
      scenario: actionScenario,
      task: async (signal, scenario) => {
        await waitFor(signal, scenario === 'slow' ? 1200 : 180, 'Operation cancelled')
        if (scenario === 'error') throw new Error('Demo action failed')
        return { saved: true, at: new Date().toISOString() }
      }
    })
  }

  async function runPreviewFetcher(): Promise<void> {
    await runFetcher({
      label: 'data:preview',
      status: fetcherState,
      result: fetcherResult,
      scenario: fetcherScenario,
      task: async (signal, scenario) => {
        await waitFor(signal, scenario === 'slow' ? 1200 : 180, 'Operation cancelled')
        if (scenario === 'error') throw new Error('Demo fetcher failed')
        return { rows: 5, source: 'memory' }
      }
    })
  }

  function saveValue(): void {
    storage.set(storageKey.value, storageValue.value)
    storageRevision.value++
  }

  function setDensity(event: Event): void {
    preferences.set('density', (event.currentTarget as HTMLSelectElement).value)
  }

  return (
    <KitPage
      class="demo-shell"
      title={i18n.t('data.title')}
      description={i18n.t('data.description')}
      actions={<Tag tone="brand">{i18n.t('data.stateful')}</Tag>}
    >
      <div class="demo-section-grid">
        <Card title={i18n.t('data.storageTitle')} description={i18n.t('data.storageDescription')}>
          <div class="demo-control-stack">
            <Input bind={storageKey} placeholder={i18n.t('data.storageKey')} />
            <Input bind={storageValue} placeholder={i18n.t('data.storageValue')} />
            <Button variant="brand" onClick={saveValue}>{i18n.t('data.saveValue')}</Button>
            <Alert tone="success" title={i18n.t('data.readBack')} description={`${storage.get<string>(storageKey.value) ?? i18n.t('data.nothingSaved')} · ${i18n.t('data.keys', { count: storage.keys().length })}`} />
            <span class="demo-muted">{i18n.t('data.revision', { revision: storageRevision.value, kind: storage.kind, persistent: String(storage.persistent) })}</span>
          </div>
        </Card>

        <Card title={i18n.t('data.preferencesTitle')} description={i18n.t('data.preferencesDescription')}>
          <div class="demo-control-stack">
            <label class="demo-labeled-control">{i18n.t('data.workspace')}<Input value={preferences.workspace.value} onInput={event => { preferences.set('workspace', (event.target as HTMLInputElement).value) }} /></label>
            <label class="demo-labeled-control">{i18n.t('data.density')}<Select value={preferences.density.value} onChange={setDensity}><option value="compact">{i18n.t('data.compact')}</option><option value="comfortable">{i18n.t('data.comfortable')}</option><option value="spacious">{i18n.t('data.spacious')}</option></Select></label>
            <span class="demo-muted">{i18n.t('data.currentDensity', { density: preferences.density.value })}</span>
            <Checkbox checked={preferences.showTips.value} onChange={event => { preferences.set('showTips', (event.target as HTMLInputElement).checked) }}>{i18n.t('data.showTips')}</Checkbox>
            <div class="demo-button-row">
              <Button size="sm" variant="secondary" onClick={() => preferences.save()}>{i18n.t('common.save')}</Button>
              <Button size="sm" variant="ghost" onClick={() => preferences.resetAll()}>{i18n.t('data.resetAll')}</Button>
            </div>
          </div>
        </Card>
      </div>

      <Card title={i18n.t('data.dictionaryTitle')} description={i18n.t('data.dictionaryDescription')}>
        <div class="demo-data-list">
          <div class="demo-button-row">
            <Button variant="brand" onClick={() => { dict.invalidate(dictName); void dictQuery.load({ force: true }) }}>{i18n.t('data.reloadStatuses')}</Button>
            <Tag tone={dictQuery.loading.value ? 'warning' : 'success'}>{dictQuery.loading.value ? i18n.t('common.loading') : i18n.t('common.ready')}</Tag>
          </div>
          <div class="demo-chip-row">{dictQuery.items.value.map(item => <Tag tone={item.disabled ? 'neutral-strong' : 'default'}>{item.label} ({item.value})</Tag>)}</div>
          <span class="demo-muted">{i18n.t('data.labelLookup', { active: dict.label(dictName, 'active'), fallback: dict.label(dictName, 'missing', i18n.t('data.fallbackLabel')) })}</span>
        </div>
      </Card>

      <Card title={i18n.t('data.routerActionsTitle')} description={i18n.t('data.routerActionsDescription')}>
        <div class="demo-control-stack">
          <ScenarioPicker scenario={actionScenario} ariaLabel={i18n.t('data.actionScenarios')} />
          <div class="demo-button-row">
            <Button variant="brand" disabled={actionState.value === 'loading'} onClick={() => { void runSaveAction() }}>{i18n.t('data.runAction')}</Button>
            <Button variant="ghost" disabled={actionState.value !== 'loading'} onClick={() => { actionControllerRef.current?.abort() }}>{i18n.t('async.cancel')}</Button>
            <StatusTag status={actionState} />
          </div>
          {actionResult.value ? <span class="demo-muted" aria-live="polite">{actionResult.value}</span> : null}
          <ScenarioPicker scenario={fetcherScenario} ariaLabel={i18n.t('data.fetcherScenarios')} />
          <div class="demo-button-row">
            <Button variant="secondary" disabled={fetcherState.value === 'loading'} onClick={() => { void runPreviewFetcher() }}>{i18n.t('data.runFetcher')}</Button>
            <Button variant="ghost" disabled={fetcherState.value !== 'loading'} onClick={() => { fetcherControllerRef.current?.abort() }}>{i18n.t('async.cancel')}</Button>
            <StatusTag status={fetcherState} />
          </div>
          {fetcherResult.value ? <span class="demo-muted" aria-live="polite">{fetcherResult.value}</span> : null}
        </div>
      </Card>
    </KitPage>
  )
}
