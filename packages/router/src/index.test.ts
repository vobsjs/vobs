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

  it('导航 state 随 history 条目存取，back 时恢复', async () => {
    const router = createRouter({
      history: createMemoryHistory('/'),
      routes: [
        { path: '/', name: 'home', component: () => createText('home') },
        { path: '/result', name: 'result', component: () => createText('result') }
      ]
    })

    // push 携带 state（对象目标与字符串目标的透传路径都要覆盖）
    await router.push({ path: '/result', state: { orderId: 'A-1' } })
    expect(router.currentRoute.value.path).toBe('/result')
    expect(router.currentRoute.value.state).toEqual({ orderId: 'A-1' })
    expect(router.history.state).toEqual({ orderId: 'A-1' })

    await router.push({ path: '/', state: { orderId: 'A-2' } })
    expect(router.currentRoute.value.state).toEqual({ orderId: 'A-2' })

    // back 回到上一条目，state 一并恢复
    router.history.back()
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/result'))
    expect(router.currentRoute.value.state).toEqual({ orderId: 'A-1' })
    router.destroy()
  })

  it('replace 更新当前条目的 state，同路径 state-only 变更被去重忽略', async () => {
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

    // replace 到不同路径：state 写入新条目
    await router.replace({ path: '/b', state: { retried: true } })
    expect(router.currentRoute.value.path).toBe('/b')
    expect(router.currentRoute.value.state).toEqual({ retried: true })
    expect(router.history.state).toEqual({ retried: true })

    // 与既有“相同目标忽略”语义一致：同路径仅 state 变化不会触发导航
    await router.replace({ path: '/b', state: { retried: false } })
    expect(router.currentRoute.value.state).toEqual({ retried: true })

    // replace 覆盖了 /a 的条目而非新增：back 直接回到初始 /
    // （若 replace 误作 push，这里会回到 /a）
    router.history.back()
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/'))
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

  it('hash history 挂载 URL hash 并转发 hashchange', () => {
    const originalURL = window.location.href
    window.history.replaceState(null, '', '/#/users?tab=all')
    const history = createHashHistory()
    const paths: string[] = []
    const stop = history.listen(path => paths.push(path))

    // hash 为空视为根路径；带 hash 时读取路径 + query
    expect(history.location).toBe('/users?tab=all')

    // push/replace 写 URL hash（pushState 不触发 hashchange，不误报）
    history.push('/users/2')
    expect(window.location.hash).toBe('#/users/2')
    history.replace('/orders?page=2', { page: 2 })
    expect(window.location.hash).toBe('#/orders?page=2')
    expect(history.state).toEqual({ page: 2 })

    // 手动改 URL / 前进后退 → hashchange 转发新路径，state 从当前条目回读
    window.history.pushState({ page: 3 }, '', '#/users/3')
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    expect(paths).toEqual(['/users/3'])
    expect(history.state).toEqual({ page: 3 })

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

  // 回归：未提供 error 兜底时，路由子树抛错不能静默渲染成空白页。
  // 真实场景：弹窗条件 children 内层绑定裸读可空信号，信号置 null 时
  // 子 effect（depth 深）先于结构卸载 effect 执行 → null.message 抛错 →
  // RouterView boundary 捕获 → 旧实现 fallback 返回 null → 整页空白。
  it('路由渲染抛错且未提供 error 时渲染内置兜底界面（非空白）', async () => {
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
      expect(fallback?.textContent).toContain('页面渲染出错')
      expect(fallback?.textContent).toContain('render exploded')
      expect(fallback?.querySelector('button')).not.toBeNull()
    })
    app.destroy()
    router.destroy()
  })

  it('显式 error 兜底返回 null 时尊重用户选择渲染空白', () => {
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

  it('兜底界面点击重试可恢复渲染', async () => {
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

  it('路由子树内 effect 抛错由 boundary 捕获并切换到兜底（弹窗卸载竞态场景）', async () => {
    // 复刻 Labelune 崩溃链：条件渲染的子树内层 effect 裸读可空信号，
    // 信号置 null 时该 effect 先于结构卸载执行并抛错，错误必须被
    // RouterView boundary 兜住（默认兜底界面），而不是炸掉整个页面。
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
          // 模拟编译产物：{req.value.message} → bindText 裸读可空信号
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

    // 置 null：内层 effect 抛 null.message（depth 优先，先于任何结构卸载执行），
    // 错误必须被 boundary 接住并显示兜底界面
    data.set(null)
    await vi.waitFor(() => {
      expect(container.querySelector('.vobs-route-error')).not.toBeNull()
    })
    expect(container.textContent).toContain('页面渲染出错')
    app.destroy()
    router.destroy()
  })
})

/*
 * 缺参数不能再静默降级。
 *
 * 原来 fillRouteParams 找不到值就原样返回 token —— `push({ name: 'user' })` 会"成功"
 * 落到 `/users/:id`（地址栏里是字面量 `:id`、params.id 也是 ':id'），不报错、结果错，
 * 页面还渲染得出来，只是数据不对。这类静默错比直接抛错难查得多。
 */
describe('缺参数', () => {
  it('resolve 缺少路径参数时报错，而不是静默给出字面量地址', () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/users/:id', name: 'user', component: () => createText('user') }]
    })
    expect(() => router.resolve({ name: 'user' })).toThrow(/需要参数 "id"/)
    // 正常路径不受影响
    expect(router.resolve({ name: 'user', params: { id: '42' } }).path).toBe('/users/42')
    router.destroy()
  })
})
/*
 * 守卫的生命周期。
 *
 * 原来 beforeEach 只把守卫 push 进 guards 数组，不绑 Owner —— 于是"组件卸载后守卫照旧执行"：
 * 守卫里读路由状态、发请求、做鉴权跳转，全都发生在一个已经不存在的组件的名义下。
 * 实测确认：Owner 销毁后守卫执行 0 次（原来会照旧执行）。
 */
describe('守卫生命周期', () => {
  it('在 Owner 作用域内注册的守卫，随 Owner 销毁自动摘除', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', name: 'home', component: () => createText('home') },
        { path: '/b', name: 'b', component: () => createText('b') }
      ]
    })

    let called = 0
    const owner = createOwner()
    // 在组件里注册就是这个形态：当前 Owner 是组件
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
 * 抢占（被后一次导航顶掉）的两个坑。
 *
 * 1) 公开 API 的 promise 没人接时不该被判 unhandledRejection —— 最常见的写法就是
 *    `void router.push(...)`（playground 里到处是），而"被顶掉"根本不是错误。
 *    契约本身（await 时收到 NavigationCancelledError）保持不变。
 * 2) `push(当前地址)` 不该误杀正在飞的导航 —— 原来 `++navigationId` 排在同址判断之前，
 *    于是推进 id 把在飞导航当成"被抢占"杀掉。
 */
describe('导航抢占', () => {
  const routes = [
    { path: '/', name: 'home', component: () => createText('home') },
    { path: '/b', name: 'b', component: () => createText('b') },
    { path: '/c', name: 'c', component: () => createText('c') }
  ]
  const tick = (ms = 5) => new Promise(resolve => setTimeout(resolve, ms))

  it('void push 被抢占不产生 unhandledRejection，而 await 仍拿到 NavigationCancelledError', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes })
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => { unhandled.push(reason) }
    process.on('unhandledRejection', onUnhandled)

    let first = true
    router.beforeEach(async () => { if (first) { first = false; await tick(20) } })

    const superseded = router.push({ name: 'b' })      // 会被抢占
    await tick(5)
    await router.push({ name: 'c' }).catch(() => {})    // 抢占者
    await tick(40)

    // 契约：await 的调用方仍然收到拒绝
    await expect(superseded).rejects.toThrowError(NavigationCancelledError)
    expect(unhandled).toEqual([])

    process.off('unhandledRejection', onUnhandled)
    router.destroy()
  })

  it('push(当前地址) 不会误杀在飞的导航', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes })
    let first = true
    router.beforeEach(async () => { if (first) { first = false; await tick(20) } })

    const inFlight = router.push({ name: 'b' })
    await tick(5)
    // 同一个地址：应该是彻底的空操作（连 id 都不该推进）
    await expect(router.push(router.currentRoute.value)).resolves.toBeTruthy()
    // 在飞的那个必须正常完成
    await expect(inFlight).resolves.toMatchObject({ fullPath: '/b' })
    expect(router.currentRoute.value.fullPath).toBe('/b')

    router.destroy()
  })
})
/*
 * revalidate() 的作用范围。
 *
 * 原来无参时**不过滤路由**，把 dataLoaders 里所有历史 key 全部重放：访问过 5 个路由之后
 * 调一次 revalidate() 就会给 5 个路由各发一轮请求，其中大多数早已不在屏幕上。
 * 现在无参 = 当前路由；显式传 route 的行为不变。
 */
describe('revalidate 的作用范围', () => {
  it('无参只重跑当前路由的 loader，显式传 route 仍然有效', async () => {
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
    expect(loads).toEqual(['b'])          // 原来会是 ['a', 'b']

    loads.length = 0
    await router.devtools.revalidate('/a')
    expect(loads).toEqual(['a'])

    router.destroy()
  })
})
/*
 * 守卫/loader 永不 resolve 时，导航必须收敛 —— 不能永远悬着。
 *
 * 原来抢占只是把 navigationId 推进一格，并不会放弃那次 `await guard(...)`，
 * 于是 push 的 promise 永远 pending（navigationState 也跟着卡在 loading），
 * 而且 destroy 也不收（destroy 里也只是 `navigationId++`）。
 *
 * 现在每次导航有中止器：被抢占或 destroy 时立刻中止，并以既有的
 * NavigationCancelledError 契约拒绝。这两个用例如果回归，会直接超时失败。
 */
describe('导航收敛', () => {
  const routes = [
    { path: '/', name: 'home', component: () => createText('home') },
    { path: '/b', name: 'b', component: () => createText('b') },
    { path: '/c', name: 'c', component: () => createText('c') }
  ]
  const tick = (ms = 10) => new Promise(resolve => setTimeout(resolve, ms))

  it('守卫永不 resolve 时，被抢占会让 push 收敛而不是永远悬着', async () => {
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

  it('守卫永不 resolve 时，destroy 也会让 push 收敛', async () => {
    const router = createRouter({ history: createMemoryHistory('/'), routes })
    router.beforeEach(async () => { await new Promise(() => {}) })

    const stuck = router.push({ name: 'b' })
    await tick()
    router.destroy()

    await expect(stuck).rejects.toThrowError(NavigationCancelledError)
  })
})
/*
 * 守卫要求重定向时，**不该先加载被放弃目标的数据**。
 *
 * 原来重定向处理排在 loader 循环之后，于是 `push(需要重定向的路由)` 会把原目标的 loader
 * 也跑一遍 —— 那份数据马上就被丢弃了（实测 loader 跑了 ['a','b']）。现在重定向前移，
 * 只跑最终目标（['b']）。
 */
describe('重定向与 loader', () => {
  it('守卫重定向时不加载被放弃目标的数据', async () => {
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

    expect(loads).toEqual(['b'])                       // 原来会是 ['a', 'b']
    expect(router.currentRoute.value.fullPath).toBe('/b')
    router.destroy()
  })
})