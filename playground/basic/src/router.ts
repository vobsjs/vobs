import { createBrowserHistory, createRouter, routerPlugin } from '@vobs/router'
import { resourceRouterPlugin } from '@vobs/resource'
import { AsyncPage } from './pages/AsyncPage'
import { CaptchaPage } from './pages/CaptchaPage'
import { ComponentsPage } from './pages/ComponentsPage'
import { DashboardPage } from './pages/DashboardPage'
import { DataPage } from './pages/DataPage'
import { DevToolsPage } from './pages/DevToolsPage'
import { ErrorDiagnosticsPage } from './pages/ErrorDiagnosticsPage'
import { FormsPage } from './pages/FormsPage'
import { LoginPage } from './pages/LoginPage'
import { ResourceTablePage } from './pages/ResourceTablePage'
import { RuntimePage } from './pages/RuntimePage'
import { SSRPage } from './pages/SSRPage'
import { AppLayout, AuthLayout } from './layouts'
import { auth } from './auth'
import { usersResource } from './data/users'
import { playgroundResourceClient } from './resource'

export const router = createRouter({
  history: createBrowserHistory('/'),
  routes: [
    {
      component: AppLayout,
      source: 'src/layouts/_appLyout.tsx',
      meta: { requiresAuth: true },
      children: [
        { path: '/', component: DashboardPage, source: 'src/pages/DashboardPage.tsx' },
        {
          path: '/users',
          component: ResourceTablePage,
          source: 'src/pages/ResourceTablePage.tsx',
          meta: {
            prefetch: () => usersResource.prefetch()
          }
        },
        { path: '/captcha', component: CaptchaPage, source: 'src/pages/CaptchaPage.tsx' },
        { path: '/components', component: ComponentsPage, source: 'src/pages/ComponentsPage.tsx' },
        { path: '/forms', component: FormsPage, source: 'src/pages/FormsPage.tsx' },
        { path: '/data', component: DataPage, source: 'src/pages/DataPage.tsx' },
        { path: '/async', component: AsyncPage, source: 'src/pages/AsyncPage.tsx' },
        { path: '/runtime', component: RuntimePage, source: 'src/pages/RuntimePage.tsx' },
        { path: '/ssr', component: SSRPage, source: 'src/pages/SSRPage.tsx' },
        { path: '/devtools', component: DevToolsPage, source: 'src/pages/DevToolsPage.tsx' },
        { path: '/errors', component: ErrorDiagnosticsPage, source: 'src/pages/ErrorDiagnosticsPage.tsx' }
      ]
    },
    {
      component: AuthLayout,
      source: 'src/layouts/_authLayout.tsx',
      children: [
        { path: '/login', component: LoginPage, source: 'src/pages/LoginPage.tsx' }
      ]
    }
  ]
})

router.beforeEach(to => {
  const isLoginRoute = to.path === '/login'
  if (to.meta.requiresAuth && !auth.session.value) {
    return `/login?redirect=${encodeURIComponent(to.fullPath)}`
  }
  if (isLoginRoute && auth.session.value) {
    return '/'
  }
  return true
})

export const routerPluginInstance = routerPlugin({ router })
export const resourceRouterPluginInstance = resourceRouterPlugin({
  router,
  client: playgroundResourceClient
})
