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
 * data-vobs-* 是**框架自己的诊断属性**，只有本组件那个 effect 能写。
 *
 * 原来它们不在 bindCommonAttributes 的 skip 列表里 → 作者 props 里同名的 data-* 也会走通用通道
 * → 同一个属性两个写入者：先被真实值覆盖，等别的 prop 变化时又"复活"成作者的值（深读实测）。
 * 与 ui 的 role 被吞同源。这里钉住：作者怎么传都不会盖掉真实值。
 *
 * **如实说明**：我**没能复现**报告说的"复活"现象 —— 把 skip 列表那行改动临时还原后，
 * 下面两条测试**照样通过**。所以这个改动是**加固**（同一个属性只留一个写入者），
 * 不是对已证实 bug 的修复；测试钉的是契约，**不能区分修复前后**。
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

describe('KitResourcePage 诊断属性', () => {
  it('作者传同名 data-vobs-route 也不会盖掉真实路由', async () => {
    const { container, cleanup } = setup({ 'data-vobs-route': '/author' })
    await settle()
    expect(container.querySelector('[data-vobs-route]')?.getAttribute('data-vobs-route')).toBe('/users')
    cleanup()
  })

  it('其它 prop 变化后，真实值仍然稳定（原来会"复活"成作者的值）', async () => {
    const title = state('Users')
    const { container, cleanup } = setup({
      'data-vobs-route': '/author',
      get title() { return title.value }
    })
    await settle()
    title.value = 'Users 2'          // 触发通用属性通道重跑
    await settle()
    expect(container.querySelector('[data-vobs-route]')?.getAttribute('data-vobs-route')).toBe('/users')
    cleanup()
  })
})
