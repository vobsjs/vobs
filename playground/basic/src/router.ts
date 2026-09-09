import { createBrowserHistory, createRouter, routerPlugin } from '@vobs/router'
import { resourceRouterPlugin } from '@vobs/resource'
import { AsyncPage } from './pages/async/AsyncPage'
import { CaptchaPage } from './pages/captcha/CaptchaPage'
import { CLIPage } from './pages/cli/CLIPage'
import { ComponentsPage } from './pages/components/ComponentsPage'
import { DashboardPage } from './pages/dashboard/DashboardPage'
import { DataPage } from './pages/data/DataPage'
import { DevToolsPage } from './pages/devtools/DevToolsPage'
import { ErrorDiagnosticsPage } from './pages/errors/ErrorDiagnosticsPage'
import { FormsPage } from './pages/forms/FormsPage'
import { LoginPage } from './pages/auth/LoginPage'
import { PaymentConfigPage } from './pages/payment/PaymentConfigPage'
import { PaymentPage } from './pages/payment/PaymentPage'
import { PaymentResultPage } from './pages/payment/PaymentResultPage'
import { ResourceTablePage } from './pages/users/ResourceTablePage'
import { RuntimePage } from './pages/runtime/RuntimePage'
import { SSRPage } from './pages/ssr/SSRPage'
import { UserDetailPage } from './pages/users/UserDetailPage'
import { AppLayout, AuthLayout } from './layouts'
import { auth } from './plugins/auth'
import { usersResource, playgroundResourceClient } from './data/users'

export const router = createRouter({
  history: createBrowserHistory('/'),
  routes: [
    {
      component: AppLayout,
      source: 'src/layouts/_appLayout.tsx',
      meta: { requiresAuth: true },
      children: [
        { path: '/', component: DashboardPage, source: 'src/pages/dashboard/DashboardPage.tsx' },
        {
          path: '/users',
          component: ResourceTablePage,
          source: 'src/pages/users/ResourceTablePage.tsx',
          meta: {
            prefetch: () => usersResource.prefetch()
          }
        },
        { path: '/users/:id', component: UserDetailPage, source: 'src/pages/users/UserDetailPage.tsx' },
        { path: '/captcha', component: CaptchaPage, source: 'src/pages/captcha/CaptchaPage.tsx' },
        { path: '/components', component: ComponentsPage, source: 'src/pages/components/ComponentsPage.tsx' },
        { path: '/forms', component: FormsPage, source: 'src/pages/forms/FormsPage.tsx' },
        { path: '/data', component: DataPage, source: 'src/pages/data/DataPage.tsx' },
        { path: '/async', component: AsyncPage, source: 'src/pages/async/AsyncPage.tsx' },
        { path: '/cli', component: CLIPage, source: 'src/pages/cli/CLIPage.tsx' },
        { path: '/payment', component: PaymentPage, source: 'src/pages/payment/PaymentPage.tsx' },
        { path: '/payment/config', component: PaymentConfigPage, source: 'src/pages/payment/PaymentConfigPage.tsx' },
        { path: '/payment/result', component: PaymentResultPage, source: 'src/pages/payment/PaymentResultPage.tsx' },
        { path: '/runtime', component: RuntimePage, source: 'src/pages/runtime/RuntimePage.tsx' },
        { path: '/ssr', component: SSRPage, source: 'src/pages/ssr/SSRPage.tsx' },
        { path: '/devtools', component: DevToolsPage, source: 'src/pages/devtools/DevToolsPage.tsx' },
        { path: '/errors', component: ErrorDiagnosticsPage, source: 'src/pages/errors/ErrorDiagnosticsPage.tsx' }
      ]
    },
    {
      component: AuthLayout,
      source: 'src/layouts/_authLayout.tsx',
      children: [
        { path: '/login', component: LoginPage, source: 'src/pages/auth/LoginPage.tsx' }
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
