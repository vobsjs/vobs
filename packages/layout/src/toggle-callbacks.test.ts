// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createComponent } from '@vobs/runtime'
import { createDOMRenderer, createVobs, setRenderer, state } from '@vobs/vobs'
import { scheduler } from '@vobs/reactivity'
import { KitLayout } from './layout'

setRenderer(createDOMRenderer())
const settle = async (): Promise<void> => { scheduler.flush(); await null }

/*
 * 默认 header 的开关按钮要同时触发 onToggleSidebar 与状态回调。
 *
 * 深读报告称"受控时默认按钮只调 onSidebarCollapsedChange，onToggleSidebar 只有自定义 header 会调，
 * 所以只接 onToggleSidebar 的应用点了没反应"。**实测不成立**：点默认 header 的
 * `.vobs-kit-header__toggle-button`，两个回调各触发 1 次。
 *
 * 代码路径也对得上：`createDefaultToggle`（header.ts:80-83）读的是 KitHeader 的 onToggleSidebar，
 * 而 KitHeader 的该 prop 来自 `createHeaderSlot` 里那个"先 context.toggleSidebar() 再调作者回调"的
 * 包装（layout.ts:196-200）—— 而且 `createHeaderSlot` 只有一处调用（layout.ts:136），
 * 默认与自定义 header 共用同一条路径。
 *
 * 既然核查结果是"没有这个 bug"，就把**当前正确的契约**钉住，免得日后真被改坏。
 */
function mount(props: NonNullable<Parameters<typeof KitLayout>[0]>) {
  const host = document.createElement('main')
  document.body.appendChild(host)
  const app = createVobs({ renderer: createDOMRenderer(), render: () => createComponent(KitLayout, props) })
  app.mount(host)
  const toggle = (): HTMLElement | null => host.querySelector<HTMLElement>('.vobs-kit-header__toggle-button')
  const click = (): void => { toggle()?.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) }
  return { host, toggle, click, cleanup: () => { app.destroy(); host.remove() } }
}

describe('KitLayout 开关回调契约', () => {
  it('受控时：默认 header 按钮同时调 onToggleSidebar 与 onSidebarCollapsedChange', async () => {
    const toggles: number[] = []
    const changes: boolean[] = []
    const collapsed = state(false)
    const { click, cleanup } = mount({
      menu: [{ key: '/home', label: 'Home' }],
      get sidebarCollapsed() { return collapsed.value },
      onToggleSidebar: () => { toggles.push(1) },
      onSidebarCollapsedChange: (value: boolean) => { changes.push(value) }
    })
    await settle()

    click()
    await settle()
    expect(toggles).toHaveLength(1)
    expect(changes).toEqual([true])          // false → true（受控，由作者决定是否采纳）
    cleanup()
  })

  it('非受控时：状态回调同样会触发（作者可以据此持久化）', async () => {
    const changes: boolean[] = []
    const { host, click, cleanup } = mount({
      menu: [{ key: '/home', label: 'Home' }],
      onSidebarCollapsedChange: (value: boolean) => { changes.push(value) }
    })
    await settle()

    // 非受控的默认是 collapsed=true（sidebarExpanded 默认 false）→ 点一下是**展开**
    expect(host.querySelector('.vobs-kit-layout--sidebar-collapsed')).toBeTruthy()
    click()
    await settle()
    expect(host.querySelector('.vobs-kit-layout--sidebar-collapsed')).toBeNull()
    expect(changes).toEqual([false])
    cleanup()
  })
})
