import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement, createText, createVobs, insertBefore, setRenderer, createDOMRenderer, type VobsNode } from '@vobs/vobs'
import {
  createMemoryHistory,
  createBrowserHistory,
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

  it('匹配静态路由、参数、query 和 hash，并支持命名导航', () => {
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

  it('支持无路径父路由、嵌套 children、父子 meta 合并和命名导航', () => {
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

  it('父级路径下省略 path 的子路由匹配为 index 路由', () => {
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

  it('push、replace 和 back 更新 currentRoute，并忽略相同目标', async () => {
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

  it('browser history 支持 base 路径并转发 popstate', () => {
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

  it('守卫支持异步放行、取消和重定向', async () => {
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

  it('旧导航的 loader 迟到完成时不得覆盖新导航', async () => {
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
    // 被抢占的旧导航不允许改写当前路由与 history
    expect(router.currentRoute.value.path).toBe('/fast')
    expect(router.history.location).toBe('/fast')
    router.destroy()
  })

  it('守卫重定向到当前目标时结束导航，不进入无限循环', async () => {
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

  it('新的导航会取消仍在等待守卫的旧导航', async () => {
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

  it('history 回退被守卫重定向时同步 history 地址', async () => {
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

  it('RouterView 响应路由切换，并把 router 注入路由组件', async () => {
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

  it('RouterView 按从外到内的顺序包裹嵌套路由布局', () => {
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

  it('懒加载路由先显示 loading，完成后显示组件，失败可重试', async () => {
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

  it('routerPlugin 在没有显式 router 时创建并清理自己的 router', () => {
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

  it('路由组件渲染错误进入统一错误边界，并在切换路由后恢复', async () => {
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

  it('Router 暴露真实的路由树、导航状态、历史和性能调试数据', async () => {
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

  it('Router 调试协议记录数据请求并支持 revalidate', async () => {
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

  it('路由 loader 在导航前执行并纳入数据请求轨迹', async () => {
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

  it('loader 失败会记录请求错误并结束导航 error 状态', async () => {
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

  it('DevTools 错误协议保留阶段、路由和 stack', () => {
    const router = createRouter({
      history: createMemoryHistory('/'),
      routes: [{ path: '/', component: () => createText('home') }]
    })
    router.devtools.reportError('render', new Error('render failed'), '/')
    expect(router.devtools.getErrors()[0]).toMatchObject({ phase: 'render', route: '/', message: 'render failed' })
    router.destroy()
  })

  it('action 和 fetcher 统一纳入数据请求轨迹', async () => {
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

  it('数据请求事件携带导航关联和 loading 到 success 的完整过程', async () => {
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
})
