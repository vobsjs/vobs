import { useDict } from '@vobs/dict'
import { useRouter } from '@vobs/router'
import { usePreferences } from '@vobs/preferences'
import { useStorage } from '@vobs/storage'
import { onDispose, state } from '@vobs/vobs'
import { Alert, Button, Card, Checkbox, Input, Select, Tag } from '@vobs/ui'
import { KitPage } from '@vobs/kit'
import { useI18n } from '@vobs/i18n'
import { preferences as playgroundPreferences } from '../preferences'

export function DataPage() {
  const i18n = useI18n()
  const storage = useStorage()
  const preferences = usePreferences<typeof playgroundPreferences>()
  const dict = useDict()
  const router = useRouter()
  const storageKey = state('demo-note', 'data.storage.key')
  const storageValue = state(i18n.t('data.defaultStorageValue'), 'data.storage.value')
  const storageRevision = state(0, 'data.storage.revision')
  const dictName = 'statuses'
  const dictQuery = dict.query(dictName)
  const actionState = state<'idle' | 'loading' | 'success' | 'error'>('idle', 'data.action.status')
  const fetcherState = state<'idle' | 'loading' | 'success' | 'error'>('idle', 'data.fetcher.status')
  const actionResult = state('', 'data.action.result')
  const fetcherResult = state('', 'data.fetcher.result')
  const actionScenario = state<'success' | 'error' | 'slow'>('success', 'data.action.scenario')
  const fetcherScenario = state<'success' | 'error' | 'slow'>('success', 'data.fetcher.scenario')
  let actionController: AbortController | undefined
  let fetcherController: AbortController | undefined

  onDispose(() => {
    actionController?.abort()
    fetcherController?.abort()
  })

  async function runAction(): Promise<void> {
    actionController?.abort()
    const controller = new AbortController()
    actionController = controller
    actionState.value = 'loading'
    try {
      const result = await router.devtools.runAction('data:save-preferences', async () => {
        await waitForDataRequest(controller.signal, actionScenario.value)
        if (actionScenario.value === 'error') throw new Error('Demo action failed')
        return { saved: true, at: new Date().toISOString() }
      })
      actionResult.value = JSON.stringify(result)
      actionState.value = 'success'
    } catch (error) {
      if (isAbortError(error)) {
        actionState.value = 'idle'
        actionResult.value = i18n.t('data.operationCancelled')
        return
      }
      actionResult.value = error instanceof Error ? error.message : String(error)
      actionState.value = 'error'
    }
  }

  async function runFetcher(): Promise<void> {
    fetcherController?.abort()
    const controller = new AbortController()
    fetcherController = controller
    fetcherState.value = 'loading'
    try {
      const result = await router.devtools.runFetcher('data:preview', async () => {
        await waitForDataRequest(controller.signal, fetcherScenario.value)
        if (fetcherScenario.value === 'error') throw new Error('Demo fetcher failed')
        return { rows: 5, source: 'memory' }
      })
      fetcherResult.value = JSON.stringify(result)
      fetcherState.value = 'success'
    } catch (error) {
      if (isAbortError(error)) {
        fetcherState.value = 'idle'
        fetcherResult.value = i18n.t('data.operationCancelled')
        return
      }
      fetcherResult.value = error instanceof Error ? error.message : String(error)
      fetcherState.value = 'error'
    }
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
            <Input value={storageKey.value} onInput={event => { storageKey.value = (event.target as HTMLInputElement).value }} placeholder={i18n.t('data.storageKey')} />
            <Input value={storageValue.value} onInput={event => { storageValue.value = (event.target as HTMLInputElement).value }} placeholder={i18n.t('data.storageValue')} />
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
          <div class="demo-button-row" aria-label={i18n.t('data.actionScenarios')}>
            <Button size="sm" variant={actionScenario.value === 'success' ? 'brand' : 'ghost'} onClick={() => { actionScenario.value = 'success' }}>{i18n.t('async.successScenario')}</Button>
            <Button size="sm" variant={actionScenario.value === 'error' ? 'danger-subtle' : 'ghost'} onClick={() => { actionScenario.value = 'error' }}>{i18n.t('async.errorScenario')}</Button>
            <Button size="sm" variant={actionScenario.value === 'slow' ? 'secondary' : 'ghost'} onClick={() => { actionScenario.value = 'slow' }}>{i18n.t('async.slowScenario')}</Button>
          </div>
          <div class="demo-button-row">
            <Button variant="brand" disabled={actionState.value === 'loading'} onClick={() => { void runAction() }}>{i18n.t('data.runAction')}</Button>
            <Button variant="ghost" disabled={actionState.value !== 'loading'} onClick={() => { actionController?.abort() }}>{i18n.t('async.cancel')}</Button>
            <Tag tone={actionState.value === 'error' ? 'danger' : actionState.value === 'success' ? 'success' : actionState.value === 'loading' ? 'warning' : 'neutral-strong'}>{i18n.t(`common.status.${actionState.value}`)}</Tag>
          </div>
          {actionResult.value ? <span class="demo-muted" aria-live="polite">{actionResult.value}</span> : null}
          <div class="demo-button-row" aria-label={i18n.t('data.fetcherScenarios')}>
            <Button size="sm" variant={fetcherScenario.value === 'success' ? 'brand' : 'ghost'} onClick={() => { fetcherScenario.value = 'success' }}>{i18n.t('async.successScenario')}</Button>
            <Button size="sm" variant={fetcherScenario.value === 'error' ? 'danger-subtle' : 'ghost'} onClick={() => { fetcherScenario.value = 'error' }}>{i18n.t('async.errorScenario')}</Button>
            <Button size="sm" variant={fetcherScenario.value === 'slow' ? 'secondary' : 'ghost'} onClick={() => { fetcherScenario.value = 'slow' }}>{i18n.t('async.slowScenario')}</Button>
          </div>
          <div class="demo-button-row">
            <Button variant="secondary" disabled={fetcherState.value === 'loading'} onClick={() => { void runFetcher() }}>{i18n.t('data.runFetcher')}</Button>
            <Button variant="ghost" disabled={fetcherState.value !== 'loading'} onClick={() => { fetcherController?.abort() }}>{i18n.t('async.cancel')}</Button>
            <Tag tone={fetcherState.value === 'error' ? 'danger' : fetcherState.value === 'success' ? 'success' : fetcherState.value === 'loading' ? 'warning' : 'neutral-strong'}>{i18n.t(`common.status.${fetcherState.value}`)}</Tag>
          </div>
          {fetcherResult.value ? <span class="demo-muted" aria-live="polite">{fetcherResult.value}</span> : null}
        </div>
      </Card>
    </KitPage>
  )
}

function waitForDataRequest(signal: AbortSignal, scenario: 'success' | 'error' | 'slow'): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, scenario === 'slow' ? 1200 : 180)
    const abort = (): void => {
      clearTimeout(timer)
      reject(Object.assign(new Error('Operation cancelled'), { name: 'AbortError' }))
    }
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
  })
}

function isAbortError(value: unknown): boolean {
  return Boolean(value) && typeof value === 'object' && (value as { name?: unknown }).name === 'AbortError'
}
