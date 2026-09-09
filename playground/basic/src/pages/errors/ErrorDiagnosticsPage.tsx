import { createHTTPClient } from '@vobs/http'
import { getDevTools } from '@vobs/devtools'
import { createComponent, ErrorBoundary, effect, state } from '@vobs/vobs'
import { Alert, Button, Card, Icon, Tag } from '@vobs/ui'
import { KitPage } from '@vobs/kit'

export function ErrorDiagnosticsPage() {
  const renderFailure = state(false)
  const effectFailure = state(false)
  const requestMessage = state('No request error has been triggered.')
  const lastAction = state('No probe has been triggered.')
  const failingHttp = createHTTPClient({
    adapter: async () => {
      throw new Error('Error diagnostics HTTP request failed')
    }
  })

  const triggerRenderError = (): void => {
    renderFailure.value = true
    lastAction.value = 'Render error scheduled.'
  }

  const triggerEffectError = (): void => {
    effectFailure.value = true
    lastAction.value = 'Effect error scheduled.'
  }

  const triggerUnhandledRejection = (): void => {
    lastAction.value = 'Unhandled rejection scheduled.'
    queueMicrotask(() => {
      void Promise.reject(new Error('Error diagnostics unhandled promise rejection'))
    })
  }

  const triggerGlobalError = (): void => {
    const error = new Error('Error diagnostics global error')
    const filename = 'src/pages/errors/ErrorDiagnosticsPage.tsx'
    const event = typeof ErrorEvent === 'function'
      ? new ErrorEvent('error', {
          error,
          message: error.message,
          filename,
          lineno: 74,
          colno: 5
        })
      : Object.assign(new Event('error'), {
          error,
          message: error.message,
          filename,
          lineno: 74,
          colno: 5
        })
    window.dispatchEvent(event)
    lastAction.value = 'Synthetic global error reported.'
  }

  const triggerUsageError = (): void => {
    const devtools = getDevTools()
    if (!devtools) {
      lastAction.value = 'DevTools is unavailable; usage error was not reported.'
      return
    }
    devtools.reportError(
      'application',
      Object.assign(new Error('Vobs Error Lab: diagnostic configuration is invalid'), {
        code: 'INVALID_ERROR_LAB_OPTIONS'
      }),
      {
        origin: 'usage',
        handled: true,
        recovery: 'handled',
        source: 'src/pages/errors/ErrorDiagnosticsPage.tsx:91:7',
        hint: 'This is a safe, manually reported usage error for diagnostics testing.'
      }
    )
    lastAction.value = 'Usage error reported directly to DevTools.'
  }

  const triggerRequestError = async (): Promise<void> => {
    requestMessage.value = 'Request is failing...'
    lastAction.value = 'HTTP request error scheduled.'
    try {
      await failingHttp.get('/devtools/error')
    } catch (error) {
      requestMessage.value = error instanceof Error ? error.message : String(error)
    }
  }

  return (
    <KitPage
      class="demo-shell"
      title="Error diagnostics"
      description="Manual error probes for Runtime DevTools. Nothing runs until you click a trigger."
      actions={<Tag tone="warning">Manual only</Tag>}
    >
      <Alert
        tone="info"
        title="Safe error lab"
        description="Each probe is isolated from the main app. Use DevTools → Errors to inspect phase, source, component, recovery and deduplication."
        icon={<Icon name="alert-triangle" />}
      />

      <div class="demo-section-grid">
        <Card title="Render error" description="A child component throws during rendering and the boundary shows fallback UI.">
          <div class="demo-control-stack">
            <Button variant="danger" icon={<Icon name="alert-triangle" />} onClick={triggerRenderError}>Trigger render error</Button>
            <ErrorBoundary fallback={createProbeFallback('Render boundary', () => { renderFailure.value = false })}>
              <RenderFailureProbe active={renderFailure} />
            </ErrorBoundary>
          </div>
        </Card>

        <Card title="Effect error" description="A reactive Effect fails after its Signal changes, then can be recovered.">
          <div class="demo-control-stack">
            <Button variant="danger" icon={<Icon name="zap" />} onClick={triggerEffectError}>Trigger Effect error</Button>
            <ErrorBoundary fallback={createProbeFallback('Effect boundary', () => { effectFailure.value = false })}>
              <EffectFailureProbe active={effectFailure} />
            </ErrorBoundary>
          </div>
        </Card>

        <Card title="Event error" description="An event handler throws inside a component-owned listener and is caught by the boundary.">
          <ErrorBoundary fallback={createProbeFallback('Event boundary')}>
            <EventFailureProbe />
          </ErrorBoundary>
        </Card>

        <Card title="HTTP request error" description="The request is caught by the page while DevTools Network and Errors retain the failure.">
          <div class="demo-control-stack">
            <Button variant="danger" icon={<Icon name="download" />} onClick={() => { void triggerRequestError() }}>Trigger request error</Button>
            <span class="demo-muted">{requestMessage.value}</span>
          </div>
        </Card>
      </div>

      <Card title="Global and usage errors" description="These probes do not throw through the page, so the playground remains usable while the error center receives a diagnostic.">
        <div class="demo-button-row">
          <Button variant="secondary" onClick={triggerUnhandledRejection}>Trigger unhandled rejection</Button>
          <Button variant="secondary" onClick={triggerGlobalError}>Trigger global error</Button>
          <Button variant="secondary" onClick={triggerUsageError}>Report usage error</Button>
        </div>
        <p class="demo-error-lab__status">{lastAction.value}</p>
      </Card>
    </KitPage>
  )
}

function createProbeFallback(label: string, reset?: () => void) {
  return (error: Error, retry: () => void | Promise<unknown>) => {
    return createComponent(ErrorProbeFallback, {
      label,
      error,
      onRecover: () => {
        reset?.()
        void retry()
      }
    })
  }
}

function ErrorProbeFallback(props: {
  readonly label: string
  readonly error: Error
  readonly onRecover: () => void
}) {
  return (
    <div class="demo-error-lab__fallback">
      <div class="demo-error-lab__fallback-head">
        <Tag tone="danger">{props.label}</Tag>
        <span class="demo-error-lab__error-message">{props.error.message}</span>
      </div>
      <Button size="sm" variant="ghost" icon={<Icon name="refresh" />} onClick={props.onRecover}>Recover</Button>
    </div>
  )
}

function RenderFailureProbe(props: { readonly active: { readonly value: boolean } }) {
  if (props.active.value) throw new Error('Error diagnostics render probe failed')
  return <p class="demo-muted">Render branch is healthy.</p>
}

function EffectFailureProbe(props: { readonly active: { readonly value: boolean } }) {
  effect(() => {
    if (props.active.value) throw new Error('Error diagnostics Effect probe failed')
  })
  return <p class="demo-muted">Effect is healthy.</p>
}

function EventFailureProbe() {
  return (
    <button
      class="vui-btn vui-btn--secondary vui-btn--md"
      type="button"
      onClick={() => { throw new Error('Error diagnostics event probe failed') }}
    >
      Trigger event error
    </button>
  )
}
