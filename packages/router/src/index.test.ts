import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement, createText, createVobs, insertBefore, setRenderer, createDOMRenderer, type VobsNode } from '@vobs/vobs'
import { createOwner, effect, runWithOwner, state } from '@vobs/reactivity'
import {
  createMemoryHistory,
  createBrowserHistory,
  createHashHistory,
  createRouter,
  lazy,
  NavigationCancelledError,
  ROUTER_KEY,
  RouterView,
  routerPlugin,
  useRoute,
  useRouter
} from './index'

describe('@vobs/router', () => {
  beforeEach(() => {
    setRenderer(createDOMRenderer())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('matches static routes, params, query and hash, and supports named navigation', () => {
    const router = createRouter({
      history: createMemoryHistory('/users/42?tab=profile&tag=a&tag=b#bio'),
      routes: [
        { path: '/', name: 'home', component: () => createText('home') },
        { path: '/users/:id', name: 'user', component: () => createText('user') }
      ]
    })

    expect(router.currentRoute.value.path).toBe('/users/42')
    expect(router.currentRoute.value.params).toEqual({ id: '42' })
    expect(router.currentRoute.value.query).toEqual({ tab: 'profile', tag: ['a', 'b'] })
    expect(router.currentRoute.value.hash).toBe('#bio')
    expect(router.resolve({ name: 'user', params: { id: '7' }, query: { tab: 'activity' } }).fullPath)
      .toBe('/users/7?tab=activity')
    router.destroy()
  })

  it('navigation state is stored with the history entry and restored on back', async () => {
    const router = createRouter({
      history: createMemoryHistory('/'),
      routes: [
        { path: '/', name: 'home', component: () => createText('home') },
        { path: '/result', name: 'result', component: () => createText('result') }
      ]
    })

    // push carries state (both object-target and string-target passthrough paths must be covered)
    await router.push({ path: '/result', state: { orderId: 'A-1' } })
    expect(router.currentRoute.value.path).toBe('/result')
    expect(router.currentRoute.value.state).toEqual({ orderId: 'A-1' })
    expect(router.history.state).toEqual({ orderId: 'A-1' })

    await router.push({ path: '/', state: { orderId: 'A-2' } })
    expect(router.currentRoute.value.state).toEqual({ orderId: 'A-2' })

    // back returns to the previous entry, restoring the state along with it
    router.history.back()
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/result'))
    expect(router.currentRoute.value.state).toEqual({ orderId: 'A-1' })
    router.destroy()
  })

  it('replace updates the current entry\'s state; same-path state-only changes are ignored as duplicates', async () => {
    const history = createMemoryHistory('/')
    const router = createRouter({
      history,
      routes: [
        { path: '/', name: 'home', component: () => createText('home') },
        { path: '/a', name: 'a', component: () => createText('a') },
        { path: '/b', name: 'b', component: () => createText('b') }
      ]
    })

    await router.push('/a')
    expect(router.currentRoute.value.state).toBeUndefined()

    // replace to a different path: state is written to the new entry
    await router.replace({ path: '/b', state: { retried: true } })
    expect(router.currentRoute.value.path).toBe('/b')
    expect(router.currentRoute.value.state).toEqual({ retried: true })
    expect(router.history.state).toEqual({ retried: true })

    // Consistent with the existing "same target ignored" semantics: a same-path state-only change does not trigger navigation
    await router.replace({ path: '/b', state: { retried: false } })
    expect(router.currentRoute.value.state).toEqual({ retried: true })

    // replace overwrote /a's entry instead of appending: back goes straight to the initial /
    // (if replace had been mistakenly a push, this would return to /a)
    router.history.back()
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/'))
    router.destroy()
  })

  it('supports pathless parent routes, nested children, parent-child meta merging and named navigation', () => {
    const Layout = () => createText('layout')
    const router = createRouter({
      history: createMemoryHistory('/users/42'),
      routes: [{
        component: Layout,
        meta: { requiresAuth: true, section: 'app' },
        children: [{
          path: '/users/:id',
          name: 'user',
          meta: { section: 'users' },
          component: () => createText('user')
        }]
      }]
    })

    expect(router.currentRoute.value.record?.name).toBe('user')
    expect(router.currentRoute.value.matched).toHaveLength(2)
    expect(router.currentRoute.value.params).toEqual({ id: '42' })
    expect(router.currentRoute.value.meta).toEqual({ requiresAuth: true, section: 'users' })
    expect(router.resolve({ name: 'user', params: { id: 7 } }).path).toBe('/users/7')
    router.destroy()
  })

  it('a child route omitting path under a parent path matches as an index route', () => {
    const router = createRouter({
      history: createMemoryHistory('/admin'),
      routes: [{
        path: '/admin',
        component: () => createText('layout'),
        children: [{ component: () => createText('index') }]
      }]
    })

    expect(router.currentRoute.value.path).toBe('/admin')
    expect(router.currentRoute.value.record).toBeTruthy()
    router.destroy()
  })

  it('push, replace and back update currentRoute and ignore identical targets', async () => {
    const history = createMemoryHistory('/')
    const router = createRouter({
      history,
      routes: [
        { path: '/', component: () => createText('home') },
        { path: '/users', component: () => createText('users') }
      ]
    })

    const first = await router.push('/users')
    expect(first).toMatchObject({ path: '/users' })
    expect(history.location).toBe('/users')
    expect(await router.push('/users')).toBe(first)

    await router.replace({ path: '/', query: { page: 2 } })
    expect(router.currentRoute.value.fullPath).toBe('/?page=2')
    expect(history.location).toBe('/?page=2')

    await router.push('/users')
    router.back()
    await Promise.resolve()
    await Promise.resolve()
    expect(router.currentRoute.value.fullPath).toBe('/?page=2')
    router.destroy()
  })

  it('browser history supports a base path and forwards popstate', () => {
    const originalURL = window.location.href
    window.history.replaceState(null, '', '/vobs/users?tab=all')
    const history = createBrowserHistory('/vobs')
    const paths: string[] = []
    const stop = history.listen(path => paths.push(path))

    expect(history.location).toBe('/users?tab=all')
    history.push('/users/2#details')
    expect(window.location.pathname).toBe('/vobs/users/2')
    expect(window.location.hash).toBe('#details')
    window.history.pushState(null, '', '/vobs/users/3')
    window.dispatchEvent(new PopStateEvent('popstate'))
    expect(paths).toEqual(['/users/3'])

    stop()
    window.history.replaceState(null, '', originalURL)
  })

  it('hash history mounts the URL hash and forwards hashchange', () => {
    const originalURL = window.location.href
    window.history.replaceState(null, '', '/#/users?tab=all')
    const history = createHashHistory()
    const paths: string[] = []
    const stop = history.listen(path => paths.push(path))

    // an empty hash counts as the root path; with a hash it reads path + query
    expect(history.location).toBe('/users?tab=all')

    // push/replace write the URL hash (pushState does not fire hashchange, so no false report)
    history.push('/users/2')
    expect(window.location.hash).toBe('#/users/2')
    history.replace('/orders?page=2', { page: 2 })
    expect(window.location.hash).toBe('#/orders?page=2')
    expect(history.state).toEqual({ page: 2 })

    // manual URL edits / forward+back → hashchange forwards the new path, state is read back from the current entry
    window.history.pushState({ page: 3 }, '', '#/users/3')
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    expect(paths).toEqual(['/users/3'])
    expect(history.state).toEqual({ page: 3 })

    stop()
    window.history.replaceState(null, '', originalURL)
  })

  it('guards support async allow, cancellation and redirect', async () => {
    const router = createRouter({
      history: createMemoryHistory('/'),
      routes: [
        { path: '/', component: () => createText('home') },
        { path: '/login', component: () => createText('login') },
        { path: '/private', component: () => createText('private') }
      ]
    })
    router.beforeEach(async to => {
      await Promise.resolve()
      return to.path === '/private' ? '/login' : undefined
    })

    expect(await router.push('/private')).toMatchObject({ path: '/login' })
    expect(router.currentRoute.value.path).toBe('/login')

    const removeGuard = router.beforeEach(() => false)
    expect(await router.push('/')).toBe(false)
    expect(router.currentRoute.value.path).toBe('/login')
    removeGuard()
    router.destroy()
  })

  it('an old navigation\'s loader completing late must not overwrite the new navigation', async () => {
    let resolveSlowLoader!: () => void
    const router = createRouter({
      history: createMemoryHistory('/'),
      routes: [
        { path: '/', component: () => createText('home') },
        {
          path: '/slow',
          component: () => createText('slow'),
          loader: () => new Promise<void>(resolve => { resolveSlowLoader = resolve })
        },
        { path: '/fast', component: () => createText('fast'), loader: () => Promise.resolve() }
      ]
    })

    const slowNavigation = router.push('/slow')
    expect(router.currentRoute.value.path).toBe('/')
    await router.push('/fast')
    expect(router.currentRoute.value.path).toBe('/fast')

    resolveSlowLoader()
    await expect(slowNavigation).rejects.toThrowError(NavigationCancelledError)
    // a preempted old navigation must not rewrite the current route or history
    expect(router.currentRoute.value.path).toBe('/fast')
    expect(router.history.location).toBe('/fast')
    router.destroy()
  })

  it('a guard redirecting to the current target ends the navigation without entering an infinite loop', async () => {
    const router = createRouter({
      history: createMemoryHistory('/'),
      routes: [
        { path: '/', component: () => createText('home') },
        { path: '/target', component: () => createText('target') }
      ]
    })
    router.beforeEach(to => to.path === '/target' ? '/target' : undefined)

    await expect(router.push('/target')).resolves.toBe(false)
    expect(router.currentRoute.value.path).toBe('/')
    router.destroy()
  })

  it('a new navigation cancels an old navigation still awaiting its guard', async () => {
    let release!: () => void
    const router = createRouter({
      history: createMemoryHistory('/'),
      routes: [
        { path: '/', component: () => createText('home') },
        { path: '/slow', component: () => createText('slow') },
        { path: '/fast', component: () => createText('fast') }
      ]
    })
    router.beforeEach(async to => {
      if (to.path === '/slow') await new Promise<void>(resolve => { release = resolve })
    })

    const slow = router.push('/slow')
    await Promise.resolve()
    await expect(router.push('/fast')).resolves.toMatchObject({ path: '/fast' })
    release()
    await expect(slow).rejects.toBeInstanceOf(NavigationCancelledError)
    router.destroy()
  })

  it('history back redirected by a guard syncs the history address', async () => {
    const history = createMemoryHistory('/')
    const router = createRouter({
      history,
      routes: [
        { path: '/', component: () => createText('home') },
        { path: '/login', component: () => createText('login') },
        { path: '/private', component: () => createText('private') }
      ]
    })
    await router.push('/login')
    await router.push('/private')
    router.beforeEach(to => to.path === '/login' ? '/private' : undefined)

    router.back()
    await vi.waitFor(() => {
      expect(router.currentRoute.value.path).toBe('/private')
      expect(history.location).toBe('/private')
    })
    router.destroy()
  })

  it('RouterView reacts to route changes and injects the router into route components', async () => {
    const router = createRouter({
      history: createMemoryHistory('/'),
      routes: [
        { path: '/', component: () => createText('home') },
        {
          path: '/users/:id',
          component: () => {
            const route = useRoute()
            const node = createElement('p')
            node.textContent = `user:${route.value.params.id}`
            expect(useRouter()).toBe(router)
            return node
          }
        }
      ]
    })
    const container = document.createElement('div')
    const app = createVobs({
      render: () => RouterView({
        loading: () => createText('loading'),
        notFound: () => createText('not-found')
      }),
      plugins: [routerPlugin({ router })]
    })

    app.mount(container)
    expect(container.textContent).toBe('home')
    await router.push('/users/7')
    app.update()
    expect(container.textContent).toBe('user:7')
    await router.push('/missing')
    app.update()
    expect(container.textContent).toBe('not-found')
    app.destroy()
    router.destroy()
  })

  it('RouterView wraps nested route layouts outside-in', () => {
    const wrap = (tag: string, label: string) => (props: { children?: VobsNode }) => {
      const node = createElement(tag)
      node.setAttribute('data-layout', label)
      if (props.children) insertBefore(node, props.children, null)
      return node
    }
    const router = createRouter({
      history: createMemoryHistory('/'),
      routes: [{
        component: wrap('main', 'app'),
        children: [{
          component: wrap('section', 'section'),
          children: [{ path: '/', component: () => createText('dashboard') }]
        }]
      }]
    })
    const container = document.createElement('div')
    const app = createVobs({ render: () => RouterView({ router }) })

    app.mount(container)
    expect(container.querySelector('[data-layout="app"] [data-layout="section"]')?.textContent)
      .toBe('dashboard')
    app.destroy()
    router.destroy()
  })

  it('lazy routes show loading first, the component after load, and can retry on failure', async () => {
    let loadCount = 0
    const loader = vi.fn(async () => {
      loadCount++
      if (loadCount === 1) throw new Error('chunk failed')
      return { default: () => createText('lazy') }
    })
    const router = createRouter({
      history: createMemoryHistory('/lazy'),
      routes: [{ path: '/lazy', component: lazy(loader) }]
    })
    const container = document.createElement('div')
    const app = createVobs({
      render: () => RouterView({
        loading: () => createText('loading'),
        error: (error, retry) => {
          const node = createElement('button')
          node.textContent = error.message
          ;(node as HTMLButtonElement).onclick = retry
          return node
        }
      }),
      plugins: [routerPlugin({ router })]
    })

    app.mount(container)
    expect(container.textContent).toBe('loading')
    await vi.waitFor(() => {
      app.update()
      expect(container.textContent).toBe('chunk failed')
    })
    const button = container.querySelector('button') as HTMLButtonElement | null
    expect(button).toBeTruthy()
    button?.click()
    await vi.waitFor(() => {
      app.update()
      expect(container.textContent).toBe('lazy')
    })
    expect(loadCount).toBe(2)
    app.destroy()
    router.destroy()
  })

  it('routerPlugin creates and cleans up its own router when none is passed explicitly', () => {
    let injected = false
    const router = createRouter({
      history: createMemoryHistory('/'),
      routes: [{ path: '/', component: () => createText('home') }]
    })
    const plugin = routerPlugin({ routes: [{ path: '/', component: () => createText('home') }] })
    const consumer = {
      name: 'consumer',
      requires: [plugin],
      install(context: { inject: (key: typeof ROUTER_KEY) => unknown }) {
        injected = context.inject(ROUTER_KEY) !== undefined
      }
    }
    const app = createVobs({ render: () => createText('app'), plugins: [consumer] })
    expect(injected).toBe(true)
    app.destroy()
    router.destroy()
  })

  it('route component render errors enter the unified error boundary and recover after switching routes', async () => {
    const router = createRouter({
      history: createMemoryHistory('/broken'),
      routes: [
        { path: '/broken', component: () => { throw new Error('page failed') } },
        { path: '/ok', component: () => createText('ok') }
      ]
    })
    const container = document.createElement('div')
    const app = createVobs({
      render: () => RouterView({
        router,
        error: error => createText(`route error: ${error.message}`)
      })
    })

    app.mount(container)
    app.update()
    expect(container.textContent).toBe('route error: page failed')
    await router.push('/ok')
    app.update()
    expect(container.textContent).toBe('ok')
    app.destroy()
    router.destroy()
  })

  it('Router exposes real route tree, navigation state, history and performance debug data', async () => {
    const router = createRouter({
      history: createMemoryHistory('/'),
      routes: [{
        path: '/',
        component: () => createText('home'),
        source: 'src/routes.ts:4',
        meta: { requiresAuth: true },
        children: [
          { path: 'users/:id', name: 'user', component: () => createText('user') }
        ]
      }]
    })
    const events: unknown[] = []
    const stop = router.devtools.subscribe('navigation:end', payload => events.push(payload))

    expect(router.devtools.getRouteTree()[0]).toMatchObject({ path: '/', source: 'src/routes.ts:4', children: [{ path: '/users/:id', name: 'user' }] })
    await router.push('/users/42?tab=profile')

    expect(router.devtools.getCurrentRoute()).toMatchObject({ path: '/users/42', params: { id: '42' }, query: { tab: 'profile' } })
    expect(router.devtools.getNavigationState().status).toBe('idle')
    expect(router.devtools.getNavigationHistory()).toHaveLength(1)
    expect(router.devtools.getNavigationHistory()[0]).toMatchObject({ from: '/', to: '/users/42?tab=profile', status: 'success', source: 'push' })
    expect(router.devtools.getPerformanceMetrics().navigationCount).toBe(1)
    expect(events).toHaveLength(1)

    stop()
    router.destroy()
  })

  it('Router debug protocol records data requests and supports revalidate', async () => {
    const router = createRouter({
      history: createMemoryHistory('/'),
      routes: [{ path: '/', component: () => createText('home') }]
    })
    let loads = 0
    await router.devtools.trackDataRequest('loader', 'route:/', async () => {
      loads++
      return { loads }
    })
    expect(router.devtools.getDataRequests()[0]).toMatchObject({ kind: 'loader', key: 'route:/', status: 'success', result: { loads: 1 } })
    await router.devtools.revalidate()
    expect(loads).toBe(2)
    expect(router.devtools.getDataRequests().filter(request => request.status === 'success')).toHaveLength(2)
    router.destroy()
  })

  it('route loaders run before navigation and appear in the data request trace', async () => {
    let loaded = 0
    const router = createRouter({
      history: createMemoryHistory('/'),
      routes: [
        { path: '/', component: () => createText('home') },
        { path: '/reports', component: () => createText('reports'), loader: async () => ({ count: ++loaded }) }
      ]
    })
    await router.push('/reports')
    const request = router.devtools.getDataRequests()[0]
    expect(request).toMatchObject({ kind: 'loader', key: '/reports#/reports', status: 'success', result: { count: 1 } })
    expect(router.currentRoute.value.path).toBe('/reports')
    router.destroy()
  })

  it('a loader failure records the request error and ends the navigation in error state', async () => {
    const router = createRouter({
      history: createMemoryHistory('/'),
      routes: [
        { path: '/', component: () => createText('home') },
        { path: '/broken', component: () => createText('broken'), loader: async () => { throw new Error('loader failed') } }
      ]
    })

    await expect(router.push('/broken')).rejects.toThrow('loader failed')
    expect(router.devtools.getNavigationState()).toMatchObject({ status: 'error', to: '/broken', error: 'loader failed' })
    expect(router.devtools.getNavigationHistory()).toMatchObject([{ status: 'error', to: '/broken', error: 'loader failed' }])
    expect(router.devtools.getDataRequests()).toMatchObject([{ kind: 'loader', status: 'error', error: 'loader failed' }])
    expect(router.currentRoute.value.path).toBe('/')
    router.destroy()
  })

  it('the DevTools error protocol keeps phase, route and stack', () => {
    const router = createRouter({
      history: createMemoryHistory('/'),
      routes: [{ path: '/', component: () => createText('home') }]
    })
    router.devtools.reportError('render', new Error('render failed'), '/')
    expect(router.devtools.getErrors()[0]).toMatchObject({ phase: 'render', route: '/', message: 'render failed' })
    router.destroy()
  })

  it('actions and fetchers are uniformly included in the data request trace', async () => {
    const router = createRouter({
      history: createMemoryHistory('/'),
      routes: [{ path: '/', component: () => createText('home') }]
    })

    let actionRuns = 0
    await expect(router.devtools.runAction('form:save', async () => ({ ok: ++actionRuns }))).resolves.toEqual({ ok: 1 })
    await expect(router.devtools.runFetcher('users:refresh', async () => ['a'])).resolves.toEqual(['a'])
    await router.devtools.revalidate()
    expect(actionRuns).toBe(1)
    expect(router.devtools.getDataRequests()).toMatchObject([
      { kind: 'action', key: 'form:save', route: '/', status: 'success', result: { ok: 1 } },
      { kind: 'fetcher', key: 'users:refresh', route: '/', status: 'success', result: ['a'] }
    ])
    router.destroy()
  })

  it('data request events carry navigation association and the full loading-to-success progression', async () => {
    const router = createRouter({
      history: createMemoryHistory('/'),
      routes: [{ path: '/', component: () => createText('home') }]
    })
    const events: unknown[] = []
    const stop = router.devtools.subscribe('data-request', event => events.push(event))
    await router.devtools.trackDataRequest('loader', 'route:/', async () => ({ ok: true }), {
      trigger: 'manual',
      route: '/'
    })
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({ status: 'loading', trigger: 'manual', route: '/' })
    expect(events[1]).toMatchObject({ status: 'success', duration: expect.any(Number) })
    stop()
    router.destroy()
  })

  // Regression: when no error fallback is provided, a route subtree throwing must not silently
  // render a blank page.
  // Real scenario: an inner binding in a modal's conditional children bare-read a nullable signal;
  // when the signal is set to null, the child effect (deep in depth order) runs before the
  // structural unmount effect → throws on null.message →
  // caught by the RouterView boundary → the old implementation's fallback returned null → whole page blank.
  it('renders the built-in fallback UI (not blank) when a route render throws and no error fallback is provided', async () => {
    const router = createRouter({
      history: createMemoryHistory('/'),
      routes: [
        { path: '/', component: () => createText('home') },
        {
          path: '/boom',
          component: () => {
            throw new Error('render exploded')
          }
        }
      ]
    })
    const container = document.createElement('div')
    const app = createVobs({ render: () => RouterView({ router }), plugins: [routerPlugin({ router })] })
    app.mount(container)
    expect(container.textContent).toBe('home')

    void router.push('/boom')
    await vi.waitFor(() => {
      const fallback = container.querySelector('.vobs-route-error')
      expect(fallback).not.toBeNull()
      expect(fallback?.textContent).toContain('Page failed to render')
      expect(fallback?.textContent).toContain('render exploded')
      expect(fallback?.querySelector('button')).not.toBeNull()
    })
    app.destroy()
    router.destroy()
  })

  it('renders blank when an explicit error fallback returns null, respecting the user\'s choice', () => {
    const router = createRouter({
      history: createMemoryHistory('/'),
      routes: [
        {
          path: '/',
          component: () => {
            throw new Error('boom')
          }
        }
      ]
    })
    const container = document.createElement('div')
    const app = createVobs({
      render: () => RouterView({ router, error: () => null }),
      plugins: [routerPlugin({ router })]
    })
    app.mount(container)
    expect(container.textContent).toBe('')
    expect(container.querySelector('.vobs-route-error')).toBeNull()
    app.destroy()
    router.destroy()
  })

  it('clicking retry in the fallback UI recovers rendering', async () => {
    let shouldThrow = true
    const router = createRouter({
      history: createMemoryHistory('/'),
      routes: [{
        path: '/',
        component: () => {
          if (shouldThrow) throw new Error('first render fails')
          return createText('recovered')
        }
      }]
    })
    const container = document.createElement('div')
    const app = createVobs({ render: () => RouterView({ router }), plugins: [routerPlugin({ router })] })
    app.mount(container)
    await vi.waitFor(() => {
      expect(container.querySelector('.vobs-route-error')).not.toBeNull()
    })

    shouldThrow = false
    const button = container.querySelector('.vobs-route-error button') as HTMLButtonElement
    button.click()
    await vi.waitFor(() => {
      expect(container.textContent).toBe('recovered')
    })
    app.destroy()
    router.destroy()
  })

  it('an effect throwing inside the route subtree is caught by the boundary and switches to the fallback (modal unmount race scenario)', async () => {
    // Replicates the Labelune crash chain: an inner effect of a conditionally rendered subtree
    // bare-reads a nullable signal; when the signal is set to null, that effect runs before the
    // structural unmount and throws. The error must be caught by the RouterView boundary
    // (default fallback UI), not blow up the whole page.
    const data = state<{ message: string } | null>({ message: 'init' })
    const router = createRouter({
      history: createMemoryHistory('/'),
      routes: [{
        path: '/',
        component: () => {
          const box = createElement('div')
          box.className = 'page-content'
          const text = document.createTextNode('')
          box.appendChild(text)
          // Simulates compiled output: {req.value.message} → bindText bare-reads a nullable signal
          effect(() => {
            text.textContent = `msg:${data.value!.message}`
          })
          return box
        }
      }]
    })
    const container = document.createElement('div')
    const app = createVobs({ render: () => RouterView({ router }), plugins: [routerPlugin({ router })] })
    app.mount(container)
    expect(container.querySelector('.page-content')).not.toBeNull()

    // Set to null: the inner effect throws on null.message (depth-first, before any structural
    // unmount runs); the error must be caught by the boundary and shown as the fallback UI
    data.set(null)
    await vi.waitFor(() => {
      expect(container.querySelector('.vobs-route-error')).not.toBeNull()
    })
    expect(container.textContent).toContain('Page failed to render')
    app.destroy()
    router.destroy()
  })
})

/*
 * Missing params must not silently degrade.
 *
 * fillRouteParams used to return the token as-is when no value was found — `push({ name: 'user' })`
 * would "successfully" land on `/users/:id` (the address bar showed the literal `:id` and params.id
 * was ':id'): no error, wrong result; the page even rendered, just with wrong data. This class of
 * silent error is far harder to diagnose than a direct throw.
 */
describe('missing params', () => {
  it('resolve throws when a path param is missing instead of silently producing a literal address', () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/users/:id', name: 'user', component: () => createText('user') }]
    })
    expect(() => router.resolve({ name: 'user' })).toThrow(/requires the parameter "id"/)
    // the normal path is unaffected
    expect(router.resolve({ name: 'user', params: { id: '42' } }).path).toBe('/users/42')
    router.destroy()
  })
})
/*
 * Guard lifecycle.
 *
 * beforeEach used to only push the guard into the guards array without binding an Owner — so
 * "guards kept running after their component unmounted": reading route state, issuing requests,
 * and performing auth redirects all happened in the name of a component that no longer existed.
 * Measured confirmation: after Owner disposal the guard runs 0 times (it used to keep running).
 */
describe('guard lifecycle', () => {
  it('guards registered inside an Owner scope are removed automatically when the Owner is disposed', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', name: 'home', component: () => createText('home') },
        { path: '/b', name: 'b', component: () => createText('b') }
      ]
    })

    let called = 0
    const owner = createOwner()
    // Registering inside a component is exactly this form: the current Owner is the component
    runWithOwner(owner, () => { router.beforeEach(() => { called++ }) })

    await router.push({ name: 'b' })
    expect(called).toBe(1)

    owner.dispose()
    called = 0
    await router.push({ name: 'home' })
    expect(called).toBe(0)

    router.destroy()
  })
})
/*
 * The two pitfalls of preemption (being superseded by a later navigation).
 *
 * 1) The public API's promise must not be flagged unhandledRejection when nobody attaches — the
 *    most common form is `void router.push(...)` (all over the playground), and "being superseded"
 *    is not an error at all. The contract itself (awaiting receives NavigationCancelledError)
 *    stays unchanged.
 * 2) `push(current address)` must not mistakenly kill an in-flight navigation — `++navigationId`
 *    used to run before the same-address check, so advancing the id killed the in-flight
 *    navigation as if preempted.
 */
describe('navigation preemption', () => {
  const routes = [
    { path: '/', name: 'home', component: () => createText('home') },
    { path: '/b', name: 'b', component: () => createText('b') },
    { path: '/c', name: 'c', component: () => createText('c') }
  ]
  const tick = (ms = 5) => new Promise(resolve => setTimeout(resolve, ms))

  it('a preempted void push produces no unhandledRejection, while await still receives NavigationCancelledError', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes })
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => { unhandled.push(reason) }
    process.on('unhandledRejection', onUnhandled)

    let first = true
    router.beforeEach(async () => { if (first) { first = false; await tick(20) } })

    const superseded = router.push({ name: 'b' })      // will be preempted
    await tick(5)
    await router.push({ name: 'c' }).catch(() => {})    // the preemptor
    await tick(40)

    // Contract: awaiting callers still receive the rejection
    await expect(superseded).rejects.toThrowError(NavigationCancelledError)
    expect(unhandled).toEqual([])

    process.off('unhandledRejection', onUnhandled)
    router.destroy()
  })

  it('push(current address) does not mistakenly kill the in-flight navigation', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes })
    let first = true
    router.beforeEach(async () => { if (first) { first = false; await tick(20) } })

    const inFlight = router.push({ name: 'b' })
    await tick(5)
    // Same address: should be a complete no-op (the id must not even advance)
    await expect(router.push(router.currentRoute.value)).resolves.toBeTruthy()
    // the in-flight one must complete normally
    await expect(inFlight).resolves.toMatchObject({ fullPath: '/b' })
    expect(router.currentRoute.value.fullPath).toBe('/b')

    router.destroy()
  })
})
/*
 * The scope of revalidate().
 *
 * Without an argument it used to **not filter by route** at all, replaying every historical key in
 * dataLoaders: after visiting 5 routes, one revalidate() call fired a round of requests for all 5,
 * most of them long gone from the screen. Now no argument = current route; passing a route
 * explicitly behaves unchanged.
 */
describe('revalidate scope', () => {
  it('no argument re-runs only the current route\'s loader; an explicit route still works', async () => {
    const loads: string[] = []
    const route = (name: string, path: string) => ({
      path,
      name,
      component: () => createText(name),
      loader: () => { loads.push(name) }
    })
    const router = createRouter({
      history: createMemoryHistory('/'),
      routes: [route('home', '/'), route('a', '/a'), route('b', '/b')]
    })

    await router.push({ name: 'a' })
    await router.push({ name: 'b' })
    expect(loads).toEqual(['a', 'b'])

    loads.length = 0
    await router.devtools.revalidate()
    expect(loads).toEqual(['b'])          // used to be ['a', 'b']

    loads.length = 0
    await router.devtools.revalidate('/a')
    expect(loads).toEqual(['a'])

    router.destroy()
  })
})
/*
 * When a guard/loader never resolves, the navigation must settle — it cannot hang forever.
 *
 * Preemption used to only advance navigationId without abandoning the `await guard(...)`, so the
 * push promise stayed pending forever (and navigationState was stuck on loading with it); destroy
 * did not collect it either (destroy only did `navigationId++` as well).
 *
 * Now each navigation has an aborter: preemption or destroy aborts immediately and rejects with the
 * existing NavigationCancelledError contract. If these two cases regress, they fail by timeout.
 */
describe('navigation settling', () => {
  const routes = [
    { path: '/', name: 'home', component: () => createText('home') },
    { path: '/b', name: 'b', component: () => createText('b') },
    { path: '/c', name: 'c', component: () => createText('c') }
  ]
  const tick = (ms = 10) => new Promise(resolve => setTimeout(resolve, ms))

  it('when a guard never resolves, preemption makes push settle instead of hanging forever', async () => {
    const router = createRouter({ history: createMemoryHistory('/'), routes })
    let hang = true
    router.beforeEach(async () => { if (hang) { hang = false; await new Promise(() => {}) } })

    const stuck = router.push({ name: 'b' })
    await tick()
    await router.push({ name: 'c' }).catch(() => {})

    await expect(stuck).rejects.toThrowError(NavigationCancelledError)
    expect(router.currentRoute.value.fullPath).toBe('/c')
    router.destroy()
  })

  it('when a guard never resolves, destroy also makes push settle', async () => {
    const router = createRouter({ history: createMemoryHistory('/'), routes })
    router.beforeEach(async () => { await new Promise(() => {}) })

    const stuck = router.push({ name: 'b' })
    await tick()
    router.destroy()

    await expect(stuck).rejects.toThrowError(NavigationCancelledError)
  })
})
/*
 * When a guard demands a redirect, **the abandoned target's data must not be loaded first**.
 *
 * Redirect handling used to sit after the loader loop, so `push(a route needing redirection)` also
 * ran the original target's loader — that data was discarded immediately (measured: loaders ran
 * ['a','b']). Now the redirect happens first, running only the final target (['b']).
 */
describe('redirect vs loaders', () => {
  it('does not load the abandoned target\'s data when a guard redirects', async () => {
    const loads: string[] = []
    const route = (name: string, path: string) => ({
      path,
      name,
      component: () => createText(name),
      loader: () => { loads.push(name) }
    })
    const router = createRouter({
      history: createMemoryHistory('/'),
      routes: [route('home', '/'), route('a', '/a'), route('b', '/b')]
    })
    router.beforeEach(to => (to.name === 'a' ? { name: 'b' } : undefined))

    await router.push({ name: 'a' })

    expect(loads).toEqual(['b'])                       // used to be ['a', 'b']
    expect(router.currentRoute.value.fullPath).toBe('/b')
    router.destroy()
  })
})