import { KitPage } from '@vobs/kit'
import { Alert, Button, Card, Tag } from '@vobs/ui'
import { createElement, createText, insertBefore, setAttribute, state, createId, getRenderer, setRenderer } from '@vobs/vobs'
import { hydrate, renderToString, serializeState, parseState } from '@vobs/ssr'
import { useI18n } from '@vobs/i18n'

export function SSRPage() {
  const i18n = useI18n()
  const serverHtml = state('')
  const snapshot = state('')
  const hydrationStatus = state<'idle' | 'success' | 'error'>('idle')
  const mismatchMessage = state('')
  const stableId = createId('ssr-field')

  const renderExample = () => {
    const previousRenderer = getRenderer()
    try {
      serverHtml.value = renderToString(() => createSSRExample(stableId))
    } finally {
      setRenderer(previousRenderer)
    }
    snapshot.value = serializeState({ version: 1 })
    hydrationStatus.value = 'idle'
    mismatchMessage.value = ''
  }

  const hydrateExample = () => {
    if (!serverHtml.value) renderExample()
    const host = document.createElement('div')
    host.innerHTML = serverHtml.value
    const previousRenderer = getRenderer()
    try {
      const app = hydrate(() => createClientExample(stableId), host, { state: parseState(snapshot.value) })
      hydrationStatus.value = 'success'
      const hydratedHTML = host.innerHTML
      mismatchMessage.value = `Hydrated: ${hydratedHTML}`
      app.destroy()
    } catch (error) {
      hydrationStatus.value = 'error'
      mismatchMessage.value = error instanceof Error ? error.message : String(error)
    } finally {
      setRenderer(previousRenderer)
    }
  }

  const simulateMismatch = () => {
    const host = document.createElement('div')
    host.innerHTML = '<h2>server markup</h2>'
    const previousRenderer = getRenderer()
    try {
      const app = hydrate(() => createClientExample(stableId), host)
      hydrationStatus.value = 'success'
      app.destroy()
    } catch (error) {
      hydrationStatus.value = 'error'
      mismatchMessage.value = error instanceof Error ? error.message : String(error)
    } finally {
      setRenderer(previousRenderer)
    }
  }

  return (
    <KitPage class="demo-shell" title={i18n.t('dashboard.ssrTitle')} description={i18n.t('dashboard.ssrDescription')}>
      <Alert tone="info" title="SSR flow" description="Render a framework node on the server, serialize state, then hydrate equivalent client markup." />
      <div class="demo-section-grid">
        <Card title="Server HTML" description="Generated with @vobs/ssr renderToString().">
          <div class="demo-control-stack">
            <div class="demo-button-row"><Button variant="brand" onClick={renderExample}>Render HTML</Button><Button variant="secondary" onClick={hydrateExample}>Hydrate</Button></div>
            <pre class="demo-code">{serverHtml.value || 'No server render yet.'}</pre>
            <Tag tone={hydrationStatus.value === 'error' ? 'danger' : hydrationStatus.value === 'success' ? 'success' : 'neutral-strong'}>{hydrationStatus.value}</Tag>
          </div>
        </Card>
        <Card title="State recovery" description="SSR state is serialized with script-safe escaping and validated before hydration.">
          <div class="demo-control-stack"><pre class="demo-code">{snapshot.value || 'No state snapshot yet.'}</pre><span class="demo-muted">{mismatchMessage.value || 'Hydration output will appear here.'}</span></div>
        </Card>
        <Card title="Hydration mismatch" description="A deliberate structure mismatch keeps server DOM intact and reports diagnostics.">
          <div class="demo-control-stack"><Button variant="danger" onClick={simulateMismatch}>Simulate mismatch</Button><span class="demo-muted">{mismatchMessage.value || 'No mismatch detected.'}</span></div>
        </Card>
      </div>
    </KitPage>
  )
}

function createSSRExample(id: string) {
  const root = createElement('div')
  const heading = createElement('h2')
  insertBefore(heading, createText('Server markup'), null)
  insertBefore(root, heading, null)
  const label = createElement('label')
  setAttribute(label, 'for', id)
  insertBefore(label, createText('Stable field'), null)
  insertBefore(root, label, null)
  const input = createElement('input')
  setAttribute(input, 'id', id)
  insertBefore(root, input, null)
  return root
}

function createClientExample(id: string) {
  const root = createElement('div')
  const heading = createElement('h2')
  insertBefore(heading, createText('Server markup'), null)
  insertBefore(root, heading, null)
  const label = createElement('label')
  setAttribute(label, 'for', id)
  insertBefore(label, createText('Stable field'), null)
  insertBefore(root, label, null)
  const input = createElement('input')
  setAttribute(input, 'id', id)
  insertBefore(root, input, null)
  return root
}
