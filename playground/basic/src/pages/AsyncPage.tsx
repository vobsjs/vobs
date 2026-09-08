import { useLogger } from '@vobs/logger'
import { useNotification } from '@vobs/notification'
import { useQueue } from '@vobs/queue'
import { useSync } from '@vobs/sync'
import { useUpload } from '@vobs/upload'
import { onDispose, state } from '@vobs/vobs'
import { Alert, Button, Card, Icon, Tag } from '@vobs/ui'
import { KitPage } from '@vobs/kit'
import { httpScenario, playgroundHttp, uploadScenario } from '../http'
import { syncScenario } from '../sync'
import { useI18n } from '@vobs/i18n'

export function AsyncPage() {
  const i18n = useI18n()
  const queue = useQueue()
  const upload = useUpload<{ ok: boolean }>()
  const sync = useSync<{ title: string }>()
  const logger = useLogger()
  const notification = useNotification()
  const uploadMessage = state(i18n.t('async.chooseFile'), 'async.upload.message')
  const syncMessage = state(i18n.t('async.noSync'), 'async.sync.message')
  const httpState = state<'idle' | 'loading' | 'success' | 'error'>('idle', 'async.http.status')
  const httpMessage = state(i18n.t('async.httpDescription'), 'async.http.message')
  let httpController: AbortController | undefined
  const queueTasks = new Set<{ cancel(): void }>()
  const uploadTasks = new Set<{ cancel(): void }>()
  let queueFailureInjected = false

  onDispose(() => {
    httpController?.abort()
    for (const task of queueTasks) task.cancel()
    for (const task of uploadTasks) task.cancel()
    sync.stop()
  })

  function addTask(priority: 'normal' | 'high'): void {
    const canFail = priority === 'normal'
    const task = queue.add(async signal => {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, priority === 'high' ? 320 : 700)
        signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('Task cancelled')) }, { once: true })
      })
      if (canFail && !queueFailureInjected) {
        queueFailureInjected = true
        throw new Error(i18n.t('async.taskFailed'))
      }
      return `${priority} task completed`
    }, { priority })
    logger.info('Queue task added', { id: task.id, priority })
    notification.info(`${i18n.t(priority === 'high' ? 'async.addHigh' : 'async.addNormal')}: ${task.id}`)
    queueTasks.add(task)
  }

  function selectFile(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0]
    if (!file) return
    const task = upload.upload(file)
    uploadTasks.add(task)
    uploadMessage.value = `Uploading ${file.name} (${task.id})...`
    void task.promise.then(result => {
      uploadMessage.value = result ? `${file.name} uploaded through the mock HTTP adapter.` : `${file.name} was cancelled or failed.`
    })
  }

  function runSync(): void {
    sync.enqueue({ key: 'demo:message', operation: 'upsert', value: { title: 'Hello from Playground' } })
    void sync.sync().then(result => {
      syncMessage.value = `Sync complete: pushed ${result.pushed}, pulled ${result.pulled}, cursor ${result.cursor ?? 'none'}.`
    }).catch(error => { syncMessage.value = error instanceof Error ? error.message : String(error) })
  }

  async function runHTTPRequest(method: 'GET' | 'POST'): Promise<void> {
    httpController?.abort()
    const controller = new AbortController()
    httpController = controller
    httpState.value = 'loading'
    httpMessage.value = i18n.t('async.requestInFlight', { method })
    try {
      const response = method === 'GET'
        ? await playgroundHttp.get<{ ok: boolean; method: string; url: string }>('/demo/health', { signal: controller.signal })
        : await playgroundHttp.post<{ ok: boolean; method: string; url: string; received: boolean }>(
          '/demo/events',
          { source: 'playground', event: 'network-demo' },
          { signal: controller.signal }
        )
      httpState.value = 'success'
      httpMessage.value = `${response.status} ${response.statusText || 'OK'} · ${response.data.method} ${response.data.url}`
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return
      httpState.value = 'error'
      httpMessage.value = error instanceof Error ? error.message : String(error)
    }
  }

  return (
    <KitPage
      class="demo-shell"
      title={i18n.t('async.title')}
      description={i18n.t('async.description')}
      actions={<Tag tone={sync.status.value === 'error' ? 'danger' : 'success'}>{i18n.t(`common.status.${sync.status.value}`)}</Tag>}
    >
      <div class="demo-section-grid">
        <Card title={i18n.t('async.httpTitle')} description={i18n.t('async.httpDescription')}>
          <div class="demo-control-stack">
            <div class="demo-button-row" aria-label="HTTP scenarios">
              <Button size="sm" variant={httpScenario.value === 'success' ? 'brand' : 'ghost'} onClick={() => { httpScenario.value = 'success' }}>{i18n.t('async.successScenario')}</Button>
              <Button size="sm" variant={httpScenario.value === 'error' ? 'danger-subtle' : 'ghost'} onClick={() => { httpScenario.value = 'error' }}>{i18n.t('async.errorScenario')}</Button>
              <Button size="sm" variant={httpScenario.value === 'slow' ? 'secondary' : 'ghost'} onClick={() => { httpScenario.value = 'slow' }}>{i18n.t('async.slowScenario')}</Button>
            </div>
            <div class="demo-button-row">
              <Button variant="brand" disabled={httpState.value === 'loading'} onClick={() => { void runHTTPRequest('GET') }}>{i18n.t('async.runGet')}</Button>
              <Button variant="secondary" disabled={httpState.value === 'loading'} onClick={() => { void runHTTPRequest('POST') }}>{i18n.t('async.sendPost')}</Button>
              <Button variant="ghost" disabled={httpState.value !== 'loading'} onClick={() => { httpController?.abort(); httpState.value = 'idle'; httpMessage.value = i18n.t('async.cancelled') }}>{i18n.t('async.cancel')}</Button>
              <Tag tone={httpState.value === 'error' ? 'danger' : httpState.value === 'success' ? 'success' : httpState.value === 'loading' ? 'warning' : 'neutral-strong'}>{httpState.value}</Tag>
            </div>
            <span class="demo-muted" aria-live="polite">{httpMessage.value}</span>
          </div>
        </Card>

        <Card title={i18n.t('async.queueTitle')} description={i18n.t('async.queueDescription')}>
          <div class="demo-control-stack">
            <div class="demo-button-row"><Button variant="brand" onClick={() => addTask('high')} icon={<Icon name="zap" />}>{i18n.t('async.addHigh')}</Button><Button variant="secondary" onClick={() => addTask('normal')}>{i18n.t('async.addNormal')}</Button></div>
            <div class="demo-queue-stats"><Tag tone="brand">{i18n.t('async.pending', { count: queue.pending.value })}</Tag><Tag tone="success">{i18n.t('async.processing', { count: queue.processing.value })}</Tag><Tag tone="default">{i18n.t('async.completed', { count: queue.completed.value })}</Tag><Tag tone="danger">{i18n.t('async.failed', { count: queue.failed.value })}</Tag></div>
            <div class="demo-button-row"><Button size="sm" variant="ghost" onClick={() => { queue.clear() }}>{i18n.t('async.clearPending')}</Button></div>
            {queue.tasks.value.length === 0 ? <span class="demo-empty">{i18n.t('async.noTasks')}</span> : <div class="demo-data-list">{queue.tasks.value.slice(-5).map(task => <div class="demo-list-row" key={task.id}><span>{task.id}</span><span class="demo-button-row"><Tag tone={task.status.value === 'success' ? 'success' : task.status.value === 'error' ? 'danger' : 'warning'}>{i18n.t(`common.status.${task.status.value}`)}</Tag><Button size="sm" variant="ghost" iconOnly icon={<Icon name="x" />} disabled={task.status.value !== 'pending' && task.status.value !== 'running' && task.status.value !== 'retrying'} aria-label={`Cancel ${task.id}`} title={`Cancel ${task.id}`} onClick={() => { task.cancel() }} /><Button size="sm" variant="ghost" iconOnly icon={<Icon name="refresh" />} disabled={task.status.value !== 'error'} aria-label={`Retry ${task.id}`} title={`Retry ${task.id}`} onClick={() => { void task.retry().catch(() => undefined) }} /></span></div>)}</div>}
          </div>
        </Card>

        <Card title={i18n.t('async.uploadTitle')} description={i18n.t('async.uploadDescription')}>
          <div class="demo-control-stack">
            <div class="demo-button-row" aria-label="Upload scenarios">
              <Button size="sm" variant={uploadScenario.value === 'success' ? 'brand' : 'ghost'} onClick={() => { uploadScenario.value = 'success' }}>{i18n.t('async.successScenario')}</Button>
              <Button size="sm" variant={uploadScenario.value === 'error' ? 'danger-subtle' : 'ghost'} onClick={() => { uploadScenario.value = 'error' }}>{i18n.t('async.errorScenario')}</Button>
              <Button size="sm" variant={uploadScenario.value === 'slow' ? 'secondary' : 'ghost'} onClick={() => { uploadScenario.value = 'slow' }}>{i18n.t('async.slowScenario')}</Button>
            </div>
            <input class="demo-file-input" type="file" aria-label={i18n.t('async.chooseFile')} onChange={selectFile} />
            <span class="demo-muted">{uploadMessage.value}</span>
            {upload.tasks.value.length === 0 ? <span class="demo-empty">{i18n.t('async.noUploads')}</span> : <div class="demo-data-list">{upload.tasks.value.slice(-4).map(task => <div class="demo-list-row" key={task.id}><span>{task.file.name ?? task.id}</span><span class="demo-button-row"><span>{Math.round(task.progress.value)}% · {i18n.t(`common.status.${task.status.value}`)}</span><Button size="sm" variant="ghost" iconOnly icon={<Icon name="x" />} disabled={task.status.value !== 'pending' && task.status.value !== 'uploading'} aria-label={`Cancel ${task.id}`} title={`Cancel ${task.id}`} onClick={() => { task.cancel() }} /><Button size="sm" variant="ghost" iconOnly icon={<Icon name="refresh" />} disabled={task.status.value !== 'error' && task.status.value !== 'cancelled'} aria-label={`Retry ${task.id}`} title={`Retry ${task.id}`} onClick={() => { void task.retry() }} /></span></div>)}</div>}
          </div>
        </Card>
      </div>

      <Card title={i18n.t('async.syncTitle')} description={i18n.t('async.syncDescription')}>
        <div class="demo-sync-row">
          <div class="demo-button-row" aria-label="Sync scenarios">
            <Button size="sm" variant={syncScenario.value === 'success' ? 'brand' : 'ghost'} onClick={() => { syncScenario.value = 'success' }}>{i18n.t('async.successScenario')}</Button>
            <Button size="sm" variant={syncScenario.value === 'error' ? 'danger-subtle' : 'ghost'} onClick={() => { syncScenario.value = 'error' }}>{i18n.t('async.errorScenario')}</Button>
            <Button size="sm" variant={syncScenario.value === 'slow' ? 'secondary' : 'ghost'} onClick={() => { syncScenario.value = 'slow' }}>{i18n.t('async.slowScenario')}</Button>
          </div>
          <Button variant="brand" onClick={runSync} loading={sync.status.value === 'syncing'} icon={<Icon name="refresh" />}>{i18n.t('async.runSync')}</Button>
          <Button variant="ghost" disabled={sync.status.value !== 'syncing'} onClick={() => { sync.stop(); syncMessage.value = i18n.t('async.cancelled') }}>{i18n.t('async.cancel')}</Button>
          <Button variant="ghost" onClick={() => { sync.clearPending(); syncMessage.value = i18n.t('async.clearPending') }}>{i18n.t('async.clearPending')}</Button>
          <span aria-live="polite">{sync.error.value?.message ?? syncMessage.value}</span>
          <Tag tone={sync.pending.value > 0 ? 'warning' : 'success'}>Pending {sync.pending.value}</Tag>
        </div>
      </Card>

      <Alert tone="info" title={i18n.t('async.inspectTitle')} description={i18n.t('async.inspectDescription')} />
    </KitPage>
  )
}
