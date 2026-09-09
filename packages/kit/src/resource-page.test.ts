import { beforeEach, describe, expect, it } from 'vitest'
import { createAuth, type Session } from '@vobs/auth'
import { createI18n } from '@vobs/i18n'
import { createResourceClient } from '@vobs/resource'
import { createMemoryHistory, createRouter } from '@vobs/router'
import { createTheme } from '@vobs/theme'
import { createDOMRenderer, createVobs, setRenderer, state } from '@vobs/vobs'
import { KitResourcePage } from './resource-page'

describe('@vobs/kit KitResourcePage', () => {
  beforeEach(() => setRenderer(createDOMRenderer()))

  it('组合五个基础上下文并渲染 Resource 表格', async () => {
    const client = createResourceClient()
    const resource = client.resource({ key: ['users'], fetcher: () => Promise.resolve([{ id: 1, name: 'Ada' }]) })
    const auth = createAuth({ session: state<Session | null>({
      user: { id: '1', roles: ['admin'], permissions: ['users.read'] }
    }) })
    const router = createRouter({ routes: [{ path: '/users' }], history: createMemoryHistory('/users') })
    const i18n = createI18n({ defaultLocale: 'en-US', messages: {
      'en-US': { common: { loading: 'Loading', empty: 'Empty' }, auth: { unauthorized: 'Unauthorized' } }
    } })
    const theme = createTheme()
    const container = document.createElement('main')
    const app = createVobs({
      render: () => KitResourcePage({
        resource,
        columns: [{ id: 'name', label: 'Name', key: 'name' }],
        title: 'Users',
        toolbar: 'Search controls',
        requiredPermission: 'users.read',
        auth,
        router,
        i18n,
        theme
      })
    })
    app.mount(container)
    await resource.prefetch()
    app.update()
    expect(container.textContent).toContain('Users')
    expect(container.textContent).toContain('Ada')
    expect(container.querySelector('.vobs-kit-page__toolbar')?.textContent).toBe('Search controls')
    expect(container.querySelector('.vobs-data-table__filter')).toBeNull()
    expect(container.querySelector('[data-vobs-route="/users"]')).toBeTruthy()
    app.destroy()
    router.destroy()
    resource.dispose()
    client.clear()
    auth.dispose()
    i18n.dispose()
    theme.dispose()
  })

  it('未授权时使用 unauthorized 内容且不渲染表格', () => {
    const auth = createAuth({ session: state<Session | null>({
      user: { id: '1', roles: [], permissions: [] }
    }) })
    const router = createRouter({ routes: [], history: createMemoryHistory('/') })
    const i18n = createI18n({ defaultLocale: 'en-US' })
    const theme = createTheme()
    const client = createResourceClient()
    const resource = client.resource(() => Promise.resolve([]))
    const container = document.createElement('main')
    const app = createVobs({
      render: () => KitResourcePage({
        resource,
        columns: [],
        requiredPermission: 'users.read',
        unauthorized: 'Forbidden',
        auth,
        router,
        i18n,
        theme
      })
    })
    app.mount(container)
    expect(container.textContent).toContain('Forbidden')
    expect(container.querySelector('.vobs-data-table')).toBeNull()
    app.destroy()
    router.destroy()
    client.clear()
    auth.dispose()
    i18n.dispose()
    theme.dispose()
  })
})
