import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createOwner,
  effect,
  memo,
  setSignalDebugName,
  state,
  type Signal
} from '@vobs/reactivity'
import { createHTTPClient } from '@vobs/http'
import { createMemoryHistory, createRouter } from '@vobs/router'
import { hydrate } from '@vobs/ssr'
import { addEventListener, bindText, createComponent, createElement, createText, createVobs, ErrorBoundary, type VobsContext } from '@vobs/vobs'
import { connectDevTools, createDevTools, devtoolsPlugin, getDevTools, type DevToolsTarget } from './index'

let active: ReturnType<typeof createDevTools> | undefined

afterEach(() => {
  active?.dispose()
  active = undefined
})

describe('@vobs/devtools', () => {
  it('collects the Signal/Memo/Effect dependency graph and tracks updates', async () => {
    active = createDevTools({ expose: false })
    const owner = createOwner()
    owner.onError(() => undefined)
    let count!: Signal<number>

    owner.run(() => {
      count = state(0)
      setSignalDebugName(count, 'count')
      const doubled = memo(() => count.value * 2)
      effect(() => { void doubled.value })
    })

    const countInfo = active.getSignals().find(signal => signal.name === 'count')!
    const memoInfo = active.getSignals().find(signal => signal.id !== countInfo.id)!
    expect(active.getDependencies(countInfo.id)).toEqual([{
      from: countInfo.id,
      to: expect.stringMatching(/^signal-/),
      type: 'state-to-memo'
    }])
    expect(active.getDependencies(memoInfo.id)[0]?.type).toBe('memo-to-effect')

    const traces: unknown[] = []
    active.onUpdate(trace => traces.push(trace))
    count.value = 1
    await Promise.resolve()

    expect(active.getSignal(countInfo.id)?.value).toBe(1)
    expect(active.getEffects()[0]?.executionCount).toBe(2)
    expect(active.getEffects()[0]?.name).toContain('App effect')
    expect(active.getUpdates()).toHaveLength(1)
    expect(active.getUpdates()[0]?.signalId).toBe(countInfo.id)
    expect(active.getUpdates()[0]?.effects).toHaveLength(1)
    expect(traces).toHaveLength(1)
    expect(active.getDependents(active.getEffects()[0]!.id)).toHaveLength(1)
    expect(active.getLifecycleEvents()).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'signal-changed', targetId: countInfo.id }),
      expect.objectContaining({ type: 'effect-run', status: 'success' })
    ]))

    owner.dispose()
    expect(active.getSignals()).toHaveLength(0)
    expect(active.getEffects()).toHaveLength(0)
  })

  it('builds the component Owner tree and removes nodes after disposal', () => {
    active = createDevTools({ expose: false })

    function Counter(): ReturnType<typeof createText> {
      return createText('counter')
    }

    const app = createVobs({ render: () => createComponent(Counter, {}) })
    app.mount(document.createElement('div'))

    expect(active.getComponentTree()).toEqual([
      expect.objectContaining({ name: 'App', children: [
        expect.objectContaining({ name: 'Counter', mounted: true })
      ] })
    ])

    app.destroy()
    expect(active.getComponentTree()).toEqual([])
  })

  it('provides per-component Signal, Effect, Update, and DOM summaries', async () => {
    active = createDevTools({ expose: false })
    let count!: Signal<number>
    const app = createVobs({
      render: () => createComponent(function Counter() {
        count = state(0, 'counter.value')
        const text = createText('')
        bindText(text, count)
        return text
      }, {})
    })
    app.mount(document.createElement('div'))
    count.value = 1
    await Promise.resolve()

    const component = active.getComponentTree()[0]?.children[0]
    expect(component).toMatchObject({
      name: 'Counter',
      signals: [expect.stringMatching(/^signal-/)],
      effects: [expect.stringMatching(/^effect-/)],
      recentUpdates: [expect.stringMatching(/^update-/)],
      domUpdates: 1
    })
    expect(active.getComponent(component!.id)).toEqual(component)
    app.destroy()
    expect(active.getComponent(component!.id)).toBeNull()
  })

  it('exposes onto the given host object and restores the previous value on dispose', () => {
    const previous = { marker: true }
    const target: DevToolsTarget = { __VOBS_DEVTOOLS__: previous as never }
    active = createDevTools({ target })

    expect(target.__VOBS_DEVTOOLS__).toBe(active)
    active.dispose()
    expect(target.__VOBS_DEVTOOLS__).toBe(previous)
    active = undefined
  })

  it('default expose follows the environment: attached outside production, skipped in production (explicit expose: true still attaches)', () => {
    const windowTarget = window as unknown as DevToolsTarget

    // Non-production (NODE_ENV === 'test' under vitest): still attaches to the default host window by default
    active = createDevTools()
    expect(windowTarget.__VOBS_DEVTOOLS__).toBe(active)
    active.dispose()
    expect(windowTarget.__VOBS_DEVTOOLS__).toBeUndefined()

    const previousNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      // Production build: no global is attached to any host object by default (same for the default window and an explicit target)
      active = createDevTools()
      expect(windowTarget.__VOBS_DEVTOOLS__).toBeUndefined()

      const implicitTarget: DevToolsTarget = {}
      active = createDevTools({ target: implicitTarget })
      expect(implicitTarget.__VOBS_DEVTOOLS__).toBeUndefined()

      // Escape hatch: explicit expose: true still attaches in production
      const optedIn: DevToolsTarget = {}
      active = createDevTools({ target: optedIn, expose: true })
      expect(optedIn.__VOBS_DEVTOOLS__).toBe(active)

      // Explicit expose: false matches the production default
      const optedOut: DevToolsTarget = {}
      active = createDevTools({ target: optedOut, expose: false })
      expect(optedOut.__VOBS_DEVTOOLS__).toBeUndefined()

      // The real production entry point is the plugin; it forwards the same options and likewise does not attach by default
      const pluginTarget: DevToolsTarget = {}
      const cleanup = devtoolsPlugin({ target: pluginTarget })
        .install?.({ onError: () => () => undefined } as unknown as VobsContext)
      expect(pluginTarget.__VOBS_DEVTOOLS__).toBeUndefined()
      cleanup?.()
    } finally {
      process.env.NODE_ENV = previousNodeEnv
    }
  })

  it('serves queries and update events to a browser panel over postMessage', () => {
    active = createDevTools({ expose: false })
    const messages: unknown[] = []
    const listeners = new Set<(event: { data?: unknown }) => void>()
    const target = {
      addEventListener(_type: string, listener: (event: { data?: unknown }) => void) { listeners.add(listener) },
      removeEventListener(_type: string, listener: (event: { data?: unknown }) => void) { listeners.delete(listener) },
      postMessage(message: unknown, _targetOrigin: string) { messages.push(message) }
    }
    const disconnect = connectDevTools({ api: active, target })
    for (const listener of listeners) listener({
      data: { source: 'vobs-devtools', type: 'request', id: '1', method: 'getSignals' }
    })

    expect(messages[0]).toMatchObject({ source: 'vobs-devtools', type: 'response', id: '1', ok: true })
    const count = state(0)
    count.value = 1
    expect(messages.some(message => (message as { type?: string }).type === 'event')).toBe(true)
    expect(messages.some(message => (message as { event?: string }).event === 'signal-update')).toBe(true)
    disconnect()
  })

  it('keeps the previous/next values, propagation chain, and recent Effect results for one update', async () => {
    active = createDevTools({ expose: false })
    const owner = createOwner()
    let count!: Signal<number>

    owner.run(() => {
      count = state(0, 'count')
      effect(() => { void count.value })
    })

    count.value = 1
    await Promise.resolve()

    const update = active.getUpdates()[0]!
    expect(update.previousValue).toBe(0)
    expect(update.nextValue).toBe(1)
    expect(update.status).toBe('completed')
    expect(update.affectedSignals).toContain(update.signalId)
    expect(update.affectedEffects).toHaveLength(1)
    expect(update.effects[0]).toMatchObject({ status: 'success', domUpdates: 0 })
    expect(active.getEffects()[0]).toMatchObject({
      status: 'success',
      lastRunStatus: 'success',
      lastUpdateId: update.id,
      lastDomUpdates: 0
    })
  })

  it('isolates Effect errors and keeps the error result', async () => {
    active = createDevTools({ expose: false })
    const owner = createOwner()
    owner.onError(() => undefined)
    let count!: Signal<number>
    owner.run(() => {
      count = state(0, 'count')
      effect(() => {
        if (count.value > 0) throw new Error('effect failed')
      })
    })

    count.value = 1
    await Promise.resolve()

    expect(active.getUpdates()[0]).toMatchObject({ status: 'error', error: { message: 'effect failed', phase: 'effect' } })
    expect(active.getEffects()[0]).toMatchObject({ status: 'error', lastRunStatus: 'error', lastError: { message: 'effect failed' } })
    expect(active.getErrors()).toMatchObject([{ phase: 'effect', message: 'effect failed', count: 1 }])
  })

  it('collects ErrorBoundary errors and keeps the fallback recovery state', () => {
    active = createDevTools({ expose: false })
    const app = createVobs({
      render: () => ErrorBoundary({
        children: () => { throw new Error('boundary failed') },
        fallback: error => createText(`error: ${error.message}`)
      })
    })
    const container = document.createElement('div')
    app.mount(container)
    app.update()

    expect(container.textContent).toBe('error: boundary failed')
    expect(active.getErrors()).toMatchObject([{
      phases: expect.arrayContaining(['boundary', 'effect']),
      message: 'boundary failed',
      component: 'App',
      handled: true,
      recovery: 'fallback'
    }])
    app.destroy()
  })

  it('error details keep component source locations and record event errors handled by the boundary', () => {
    active = createDevTools({ expose: false })
    let button!: HTMLButtonElement
    const app = createVobs({
      render: () => ErrorBoundary({
        children: () => createComponent(() => {
          button = createElement('button') as HTMLButtonElement
          addEventListener(button, 'click', () => { throw new Error('event failed') })
          return button
        }, {}, { file: 'src/EventPage.tsx', line: 18, column: 5 }),
        fallback: error => createText(`error: ${error.message}`)
      })
    })
    const container = document.createElement('div')
    app.mount(container)

    button.dispatchEvent(new Event('click'))
    app.update()

    expect(container.textContent).toBe('error: event failed')
    expect(active.getErrors()).toMatchObject([{
      phases: expect.arrayContaining(['event', 'boundary']),
      source: 'src/EventPage.tsx:18:5',
      component: 'anonymous',
      handled: true,
      recovery: 'fallback'
    }])
    app.destroy()
  })

  it('assigns stable codes and fix hints to framework core errors', () => {
    active = createDevTools({ expose: false })
    active.reportError('application', new Error('Vobs: reactive updates exceeded 100 rounds; a circular dependency is likely')) // fixture matches the reactivity-loop message in reactivity/scheduler.ts

    expect(active.getErrors()[0]).toMatchObject({
      origin: 'framework',
      code: 'VOBS_REACTIVITY_LOOP',
      hint: expect.stringContaining('keeps writing')
    })
  })

  it('reads the standard code property of framework errors and flags usage errors', () => {
    active = createDevTools({ expose: false })
    const failure = Object.assign(new Error('Vobs Widgets: invalid options'), { code: 'INVALID_WIDGET_OPTIONS' })
    active.reportError('application', failure)

    expect(active.getErrors()[0]).toMatchObject({
      code: 'INVALID_WIDGET_OPTIONS',
      origin: 'usage'
    })
  })

  it('receives application-level errors through the devtools plugin', () => {
    let report!: (error: unknown) => void
    const context = {
      onError(handler: (error: unknown) => void) {
        report = handler
        return () => undefined
      }
    } as unknown as VobsContext
    const cleanup = devtoolsPlugin({ expose: false }).install?.(context)
    const failure = new Error('application failed')
    report(failure)

    expect(getDevTools()?.getErrors()).toMatchObject([{ phase: 'application', message: 'application failed', origin: 'application' }])
    cleanup?.()
  })

  it('does not create a collector when the plugin is explicitly disabled', () => {
    const context = {
      onError() { return () => undefined }
    } as unknown as VobsContext
    const cleanup = devtoolsPlugin({ enabled: false, expose: false }).install?.(context)
    expect(getDevTools()).toBeNull()
    cleanup?.()
  })

  it('collects @vobs/http requests and redacts credentials by default', async () => {
    active = createDevTools({ expose: false })
    const client = createHTTPClient({
      headers: { Authorization: 'Bearer secret', 'X-Trace': 'visible' },
      adapter: async () => new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    })

    await client.get('/users')

    expect(active.getNetworkRequests()).toHaveLength(1)
    expect(active.getNetworkRequests()[0]).toMatchObject({
      method: 'GET',
      status: 'success',
      responseStatus: 200,
      headers: { 'x-trace': 'visible' }
    })
    expect(active.getNetworkRequests()[0]?.headers).not.toHaveProperty('authorization')
  })

  it('supports pausing collection and clearing diagnostics without touching business Signals', async () => {
    active = createDevTools({ expose: false })
    const count = state(0, 'count')
    active.setCollectionPaused(true)
    count.value = 1
    await Promise.resolve()
    expect(count.value).toBe(1)
    expect(active.getUpdates()).toHaveLength(0)
    expect(active.getCollectionState()).toEqual({ paused: true })

    active.setCollectionPaused(false)
    count.value = 2
    await Promise.resolve()
    expect(active.getUpdates()).toHaveLength(1)
    active.clearUpdates()
    active.clearErrors()
    active.clearNetworkRequests()
    active.clearLifecycleEvents()
    expect(active.getUpdates()).toHaveLength(0)
    expect(active.getLifecycleEvents()).toHaveLength(0)
  })

  it('drops queued flushes after disposal and rejects new subscriptions', async () => {
    active = createDevTools({ expose: false })
    const count = state(0, 'dispose-check')
    count.value = 1
    const callback = vi.fn()
    active.dispose()
    active.subscribe('update', callback)
    await Promise.resolve()
    expect(callback).not.toHaveBeenCalled()
    expect(getDevTools()).toBeNull()
  })

  it('enforces a unified retention cap for updates, requests, errors, and lifecycle records', async () => {
    active = createDevTools({ expose: false, maxUpdates: 2 })
    const count = state(0, 'bounded')
    count.value = 1
    await Promise.resolve()
    count.value = 2
    await Promise.resolve()
    count.value = 3
    await Promise.resolve()
    expect(active.getUpdates()).toHaveLength(2)

    const client = createHTTPClient({ adapter: async () => new Response('ok', { status: 200 }) })
    await client.get('/one')
    await client.get('/two')
    await client.get('/three')
    expect(active.getNetworkRequests()).toHaveLength(2)

    active.reportError('application', new Error('one'))
    active.reportError('application', new Error('two'))
    active.reportError('application', new Error('three'))
    expect(active.getErrors()).toHaveLength(2)

    createOwner()
    createOwner()
    createOwner()
    expect(active.getLifecycleEvents()).toHaveLength(2)
  })

  it('reclaims disposed Owner/Signal/Effect indexes and dependency edges', () => {
    active = createDevTools({ expose: false })
    for (let index = 0; index < 20; index++) {
      const owner = createOwner()
      owner.run(() => {
        const source = state(index, `disposed-${index}`)
        const derived = memo(() => source.value + 1)
        effect(() => { void derived.value })
      })
      owner.dispose()
    }

    expect(active.takeMemorySnapshot()).toMatchObject({
      signalCount: 0,
      effectCount: 0,
      ownerCount: 0,
      dependencyEdgeCount: 0,
      leakedOwners: 0
    })
    expect(active.getComponentTree()).toEqual([])
  })

  it('keeps concurrent HTTP requests independently correlated with their completion state', async () => {
    active = createDevTools({ expose: false })
    let resolveFirst!: (response: Response) => void
    let resolveSecond!: (response: Response) => void
    const client = createHTTPClient({
      adapter: async config => new Promise<Response>(resolve => {
        if (config.url.includes('/first')) resolveFirst = resolve
        else resolveSecond = resolve
      })
    })

    const first = client.get('/first', { debugContext: { route: '/first', navigationId: 11 } })
    const second = client.get('/second', { debugContext: { route: '/second', navigationId: 12 } })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(active.getNetworkRequests()).toMatchObject([
      { url: '/first', status: 'loading', route: '/first', navigationId: 11 },
      { url: '/second', status: 'loading', route: '/second', navigationId: 12 }
    ])

    resolveSecond(new Response('{}', { status: 200 }))
    resolveFirst(new Response('{}', { status: 200 }))
    await Promise.all([first, second])
    expect(active.getNetworkRequests()).toMatchObject([
      { url: '/first', status: 'success', route: '/first', navigationId: 11 },
      { url: '/second', status: 'success', route: '/second', navigationId: 12 }
    ])
  })

  it('records the final state and attempt counts for HTTP cancellations and retries', async () => {
    active = createDevTools({ expose: false })
    const controller = new AbortController()
    const client = createHTTPClient({
      adapter: async config => new Promise<Response>((_resolve, reject) => {
        config.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
      })
    })
    const cancelled = client.get('/cancelled', { signal: controller.signal, debugContext: { route: '/cancelled' } })
    await new Promise(resolve => setTimeout(resolve, 0))
    controller.abort()
    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' })
    expect(active.getNetworkRequests()[0]).toMatchObject({ status: 'cancelled', route: '/cancelled' })

    let attempts = 0
    const retryClient = createHTTPClient({
      retry: 1,
      adapter: async () => new Response('{}', { status: ++attempts === 1 ? 503 : 200 })
    })
    await retryClient.get('/retry', { debugContext: { route: '/retry' } })
    expect(active.getNetworkRequests()).toContainEqual(expect.objectContaining({
      url: '/retry',
      status: 'success',
      attempt: 1,
      retries: 1,
      route: '/retry'
    }))
  })

  it('correlates Effect-initiated HTTP requests with the same Update', async () => {
    active = createDevTools({ expose: false })
    const client = createHTTPClient({
      adapter: async () => new Response('{}', { status: 200 })
    })
    const owner = createOwner()
    let count!: Signal<number>
    owner.run(() => {
      count = state(0, 'request-trigger')
      effect(() => {
        if (count.value > 0) void client.get('/effect-request')
      })
    })

    count.value = 1
    await Promise.resolve()
    await Promise.resolve()
    const update = active.getUpdates()[0]
    const requestId = update?.requestIds?.[0]
    expect(update?.requestIds).toEqual([expect.any(Number)])
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(active.getNetworkRequests()).toContainEqual(expect.objectContaining({
      id: requestId,
      url: '/effect-request',
      status: 'success'
    }))
    owner.dispose()
  })

  it("correlates a slow Loader's loading state, completion duration, and inner HTTP request", async () => {
    active = createDevTools({ expose: false })
    const client = createHTTPClient({
      adapter: async () => new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    })
    const router = createRouter({
      history: createMemoryHistory('/'),
      routes: [
        { path: '/', component: () => createText('home') },
        {
          path: '/slow',
          component: () => createText('slow'),
          loader: async () => {
            await new Promise(resolve => setTimeout(resolve, 25))
            return client.get('/slow-data')
          }
        }
      ]
    })
    const detach = active.attachRouter(router)
    const navigation = router.push('/slow')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(active.getRouterContext()?.dataRequests).toContainEqual(expect.objectContaining({
      kind: 'loader',
      route: '/slow',
      navigationId: 1,
      status: 'loading'
    }))

    await navigation
    const loader = active.getRouterContext()?.dataRequests.find(request => request.kind === 'loader' && request.route === '/slow')
    expect(loader).toMatchObject({ status: 'success', navigationId: 1, duration: expect.any(Number) })
    expect(loader?.duration).toBeGreaterThanOrEqual(16)
    expect(active.getNetworkRequests()).toContainEqual(expect.objectContaining({
      url: '/slow-data',
      status: 'success',
      route: '/slow',
      navigationId: 1,
      dataRequestId: loader?.id
    }))
    detach()
    router.destroy()
  })

  it('ignores viewport size updates without meaningful DOM changes', async () => {
    active = createDevTools({ expose: false })
    const width = state(1200, 'layout.viewport.width')
    const height = state(800, 'layout.viewport.height')

    width.value = 1199
    height.value = 799
    await Promise.resolve()

    expect(active.getUpdates()).toHaveLength(0)
    expect(active.getPerformanceEntries().filter(entry => entry.kind === 'update')).toHaveLength(0)
    expect(active.getSignals().map(signal => signal.name)).toEqual(expect.arrayContaining([
      'layout.viewport.width',
      'layout.viewport.height'
    ]))

    const container = document.createElement('div')
    const app = createVobs({
      render: () => {
        const text = createText('')
        bindText(text, width)
        return text
      }
    })
    app.mount(container)
    width.value = 1198
    await Promise.resolve()

    expect(active.getUpdates()).toHaveLength(1)
    expect(active.getUpdates()[0]?.domUpdates[0]).toMatchObject({ operation: 'text' })
    app.destroy()
  })

  it('records Runtime DOM mutations and correlates them with Updates and Effects', async () => {
    active = createDevTools({ expose: false })
    let count!: Signal<string>
    const app = createVobs({
      render: () => {
        count = state('before', 'query')
        const text = createText('')
        bindText(text, count)
        return text
      }
    })
    const container = document.createElement('div')
    app.mount(container)

    count.value = 'after'
    await Promise.resolve()

    const update = active.getUpdates()[0]!
    expect(update.domUpdates).toEqual([
      expect.objectContaining({
        operation: 'text',
        previousValue: 'before',
        nextValue: 'after',
        effectId: update.effects[0]?.effectId
      })
    ])
    expect(update.effects[0]?.domUpdates).toBe(1)
    app.destroy()
  })

  it('supports configurable redaction, performance entries, diagnostic export, and extension registration', async () => {
    active = createDevTools({
      expose: false,
      privacy: { redactedHeaders: ['x-private'], redactedFields: ['password'] }
    })
    const inspectorStop = active.registerInspector('resource', {
      inspect: value => ({ value, password: 'should-hide' })
    })
    const timelineStop = active.registerTimeline('upload', {
      label: 'Upload',
      getEvents: () => [{ id: 'upload-1', timestamp: 1, title: 'started', data: { password: 'secret' } }]
    })
    const metricStop = active.registerMetric('queue-size', { read: () => 3 })
    const brokenMetricStop = active.registerMetric('broken', { read: () => { throw new Error('extension failed') } })

    const client = createHTTPClient({
      adapter: async () => new Response('ok', { status: 200 }),
      headers: { 'X-Private-Trace': 'hidden', 'X-Visible': 'visible' }
    })
    await client.post('/users', { password: 'secret', name: 'Ada' })

    expect(active.getNetworkRequests()[0]).toMatchObject({
      headers: { 'x-visible': 'visible' },
      requestBody: { password: '[Redacted]', name: 'Ada' }
    })
    expect(active.inspectExtension('resource', { id: 1 })).toEqual({ value: { id: 1 }, password: '[Redacted]' })
    expect(active.getExtensionSnapshot()).toMatchObject({
      inspectors: ['resource'],
      timelines: ['upload'],
      timelineEvents: { upload: [{ id: 'upload-1', data: { password: '[Redacted]' } }] },
      metrics: { 'queue-size': 3, broken: 0 }
    })
    expect(active.getPerformanceEntries()).toEqual(expect.any(Array))
    const exported = active.exportDiagnostics()
    expect(exported).toMatchObject({
      version: 1,
      network: expect.any(Array),
      extensions: expect.objectContaining({ timelines: ['upload'] })
    })
    active.clearNetworkRequests()
    expect(active.getNetworkRequests()).toHaveLength(0)
    active.importDiagnostics(exported)
    expect(active.getNetworkRequests()).toHaveLength(1)

    inspectorStop()
    timelineStop()
    metricStop()
    brokenMetricStop()
    expect(active.getExtensionSnapshot()).toEqual({ inspectors: [], timelines: [], timelineEvents: {}, metrics: {} })
  })

  it('disallows Signal mutation by default and supports controlled debug editing when explicitly enabled', async () => {
    active = createDevTools({ expose: false })
    const count = state(0, 'count')
    const signal = active.getSignals().find(item => item.name === 'count')!
    expect(active.canMutate()).toBe(false)
    expect(active.setSignalValue(signal.id, 1)).toBe(false)
    expect(count.value).toBe(0)

    active.dispose()
    active = createDevTools({ expose: false, allowMutations: true })
    const editable = state(0, 'editable')
    const editableInfo = active.getSignals().find(item => item.name === 'editable')!
    expect(active.canMutate()).toBe(true)
    expect(active.setSignalValue(editableInfo.id, 2)).toBe(true)
    await Promise.resolve()
    expect(editable.value).toBe(2)
  })

  it('correlates Router navigations and loader requests while keeping unified context', async () => {
    active = createDevTools({ expose: false })
    const router = createRouter({
      history: createMemoryHistory('/'),
      routes: [
        { path: '/', component: () => createText('home') },
        { path: '/reports', component: () => createText('reports'), loader: async () => ({ ok: true }) }
      ]
    })
    const detach = active.attachRouter(router)
    await router.push('/reports')
    expect(active.getRouterContext()).toMatchObject({ route: '/reports', dataRequests: [expect.objectContaining({ kind: 'loader', navigationId: 1, status: 'success' })] })
    expect(active.getNetworkRequests()).toHaveLength(0)
    detach()
    router.destroy()
  })

  it('collects hydration mismatches as structured errors', () => {
    active = createDevTools({ expose: false })
    document.body.innerHTML = '<h1>server</h1>'
    expect(() => hydrate(() => createElement('p'), document.body)).toThrow('hydration')
    expect(active.getErrors()).toMatchObject([{
      phase: 'hydration',
      code: 'VOBS_HYDRATION_MISMATCH',
      hydration: { expected: '<p>', actual: expect.any(String), path: expect.any(String) }
    }])
  })
})
