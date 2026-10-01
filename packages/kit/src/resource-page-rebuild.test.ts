// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { createAuth, type Session } from '@vobs/auth'
import { createI18n } from '@vobs/i18n'
import { createResourceClient } from '@vobs/resource'
import { createMemoryHistory, createRouter } from '@vobs/router'
import { createTheme } from '@vobs/theme'
import { createDOMRenderer, createVobs, setRenderer, state } from '@vobs/vobs'
import { scheduler } from '@vobs/reactivity'
import { KitResourcePage } from './resource-page'

setRenderer(createDOMRenderer())
const settle = async (): Promise<void> => { scheduler.flush(); await null }

const ADMIN: Session = { user: { id: '1', roles: ['admin'], permissions: ['users.read'] } }
const NOBODY: Session = { user: { id: '1', roles: [], permissions: [] } }

function setup() {
  const client = createResourceClient()
  const resource = client.resource({ key: ['users'], fetcher: () => Promise.resolve([{ id: 1, name: 'Ada' }]) })
  const session = state<Session | null>(ADMIN)
  const auth = createAuth({ session })
  const router = createRouter({ routes: [{ path: '/users' }], history: createMemoryHistory('/users') })
  const i18n = createI18n({ defaultLocale: 'en-US', messages: { 'en-US': { common: {}, auth: { unauthorized: 'Unauthorized' } } } })
  const theme = createTheme()
  const container = document.createElement('main')
  const app = createVobs({
    render: () => KitResourcePage({
      resource, columns: [{ id: 'name', label: 'Name', key: 'name' }], title: 'Users',
      requiredPermission: 'users.read', auth, router, i18n, theme
    })
  })
  app.mount(container)
  return { container, session, cleanup: () => { app.destroy(); router.destroy(); resource.dispose(); client.clear(); auth.dispose() } }
}

describe('KitResourcePage 重建时机', () => {
  beforeEach(() => setRenderer(createDOMRenderer()))

  it('权限不变、只换 session 对象时页面不重建', async () => {
    const { container, session, cleanup } = setup()
    await settle()
    const tableBefore = container.querySelector('.vobs-data-table')
    expect(tableBefore).toBeTruthy()
    session.value = { user: { id: '1', roles: ['admin'], permissions: ['users.read'] } }
    await settle()
    expect(container.querySelector('.vobs-data-table')).toBe(tableBefore)
    cleanup()
  })

  it('权限真的变了才重建', async () => {
    const { container, session, cleanup } = setup()
    await settle()
    expect(container.querySelector('.vobs-data-table')).toBeTruthy()
    session.value = NOBODY
    await settle()
    expect(container.querySelector('.vobs-data-table')).toBeNull()
    expect(container.textContent).toContain('Unauthorized')
    cleanup()
  })
})
