// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createAuth } from '@vobs/auth'
import { createI18n } from '@vobs/i18n'
import { createResourceClient } from '@vobs/resource'
import { createMemoryHistory, createRouter } from '@vobs/router'
import { createTheme } from '@vobs/theme'
import { createDOMRenderer, createVobs, setRenderer, state } from '@vobs/vobs'
import { scheduler } from '@vobs/reactivity'
import { KitResourcePage } from './resource-page'

setRenderer(createDOMRenderer())
const settle = async (): Promise<void> => { scheduler.flush(); await null }

/*
 * data-vobs-* are **the framework's own diagnostic attributes**; only this
 * component's effect may write them.
 *
 * They used to be missing from bindCommonAttributes' skip list → author
 * `data-*` props with the same names also went through the generic channel
 * → one attribute, two writers: overwritten by the real value first, then
 * "resurrected" to the author's value whenever another prop changed (verified
 * by deep reading). Same root cause as ui's swallowed role. Locked in here:
 * no matter how the author passes them, the real values can't be clobbered.
 *
 * **Honest note**: I **could not reproduce** the reported "resurrection" —
 * after temporarily reverting the skip-list change, the two tests below
 * **still passed**. So this change is **hardening** (one attribute keeps a
 * single writer), not a fix for a proven bug; the tests pin the contract and
 * **cannot distinguish before/after the fix**.
 */
function setup(extra: Record<string, unknown> = {}) {
  const client = createResourceClient()
  const resource = client.resource({ key: ['users'], fetcher: () => Promise.resolve([{ id: 1, name: 'Ada' }]) })
  const auth = createAuth({ session: state({ user: { id: '1', roles: ['admin'], permissions: ['users.read'] } }) })
  const router = createRouter({ routes: [{ path: '/users' }], history: createMemoryHistory('/users') })
  const i18n = createI18n({ defaultLocale: 'en-US', messages: { 'en-US': {} } })
  const theme = createTheme()
  const container = document.createElement('main')
  const app = createVobs({
    render: () => KitResourcePage({
      resource, columns: [{ id: 'name', label: 'Name', key: 'name' }],
      requiredPermission: 'users.read', auth, router, i18n, theme, ...extra
    })
  })
  app.mount(container)
  return { container, app, cleanup: () => { app.destroy(); router.destroy(); resource.dispose(); client.clear(); auth.dispose() } }
}

describe('KitResourcePage diagnostic attributes', () => {
  it('author-passed data-vobs-route with the same name never clobbers the real route', async () => {
    const { container, cleanup } = setup({ 'data-vobs-route': '/author' })
    await settle()
    expect(container.querySelector('[data-vobs-route]')?.getAttribute('data-vobs-route')).toBe('/users')
    cleanup()
  })

  it('the real value stays stable after other props change (it used to "resurrect" to the author\'s value)', async () => {
    const title = state('Users')
    const { container, cleanup } = setup({
      'data-vobs-route': '/author',
      get title() { return title.value }
    })
    await settle()
    title.value = 'Users 2'          // triggers a re-run of the generic attribute channel
    await settle()
    expect(container.querySelector('[data-vobs-route]')?.getAttribute('data-vobs-route')).toBe('/users')
    cleanup()
  })
})
