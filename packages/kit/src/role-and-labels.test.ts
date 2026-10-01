// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createDOMRenderer, createVobs, setRenderer, state } from '@vobs/vobs'
import { scheduler } from '@vobs/reactivity'
import { KitFilterBar, KitPageActions } from './index'

setRenderer(createDOMRenderer())
const settle = async (): Promise<void> => { scheduler.flush(); await null }

/*
 * kit 里两类问题的回归测试。
 *
 * 一、`role` 被静默吞掉：与 ui 的 Alert/Switch/StatusBar 完全同构 —— `role` 不在
 *     `bindCommonAttributes` 的 skip 列表里，通用属性通道会先把作者传的值写上，
 *     紧接着一行无条件的 `setAttribute(root, 'role', …)` 又把它盖掉。
 *     实测：`KitFilterBar role="form"` 拿到 `search`；`KitPageActions role="toolbar"` 拿到 `group`。
 *
 * 二、标签冻结：`readProp(props, 'searchLabel', 'Search')` 在组件体里读**一次**就交给 Button，
 *     之后信号变化按钮文字不动（组件体只执行一次）。改成函数式 children 后由 insertDynamic 重跑。
 */
interface Props extends Record<string, unknown> {}

async function mount(component: (props: Props) => unknown, props: Props) {
  const host = document.createElement('main')
  document.body.appendChild(host)
  const app = createVobs({
    renderer: createDOMRenderer(),
    render: () => component(props) as ReturnType<typeof KitFilterBar>
  })
  app.mount(host)
  await settle()
  return { host, cleanup: () => { app.destroy(); host.remove() } }
}

describe('kit role 兜底与标签响应', () => {
  it('KitFilterBar 尊重作者传入的 role，没给才退回 search', async () => {
    const custom = await mount(KitFilterBar as never, { role: 'form' })
    expect(custom.host.querySelector('form')?.getAttribute('role')).toBe('form')
    custom.cleanup()

    const fallback = await mount(KitFilterBar as never, {})
    expect(fallback.host.querySelector('form')?.getAttribute('role')).toBe('search')
    fallback.cleanup()
  })

  it('KitPageActions 尊重作者传入的 role，没给才退回 group', async () => {
    const custom = await mount(KitPageActions as never, { role: 'toolbar' })
    expect(custom.host.querySelector('.vobs-kit-page-actions')?.getAttribute('role')).toBe('toolbar')
    custom.cleanup()

    const fallback = await mount(KitPageActions as never, {})
    expect(fallback.host.querySelector('.vobs-kit-page-actions')?.getAttribute('role')).toBe('group')
    fallback.cleanup()
  })

  it('searchLabel 跟着信号变（原来读一次就冻结）', async () => {
    const label = state('Search')
    // 关键：用 getter 袋传（编译器发射的就是 getter 袋），而不是直接传信号对象
    const props: Props = { get searchLabel() { return label.value } }
    const { host, cleanup } = await mount(KitFilterBar as never, props)
    expect(host.textContent).toContain('Search')

    label.value = '查询'
    await settle()
    expect(host.textContent).toContain('查询')
    expect(host.textContent).not.toContain('Search')
    cleanup()
  })
})
