// @vitest-environment jsdom
// 回归测试（源自 Labelune 弹窗踩坑，docs/todo.md 备忘）：
// ① Dialog 条件 children → null 时与兄弟内容共存（应用层「开关与数据分离」模式的语义保证）
// ② 用户态组件透传 children 按节点渲染（编译产物形态模拟，编译器侧另有产物断言）
// ③ insertDynamic 卸载子树时旧 effect 一并清理（幽灵订阅检测）
import { describe, expect, it } from 'vitest'
import { createDOMRenderer, setRenderer, createComponent, insertBefore, insertDynamic, insertDynamicValue } from '@vobs/vobs'
import { effect, state } from '@vobs/reactivity'

const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

describe('Dialog 条件 children 与兄弟内容共存', () => {
  // 模拟 Labelune TemplatesPage 结构：页面先有内容，末尾挂 Dialog（children 条件渲染）
  it('关闭弹窗（open 与 children 同一信号）后兄弟内容仍在', async () => {
    setRenderer(createDOMRenderer())
    const request = state<{ message: string } | null>(null)

    // 模拟编译产物：children getter + open getter 都读同一个信号
    function buildBody(): HTMLElement {
      const div = document.createElement('div')
      div.className = 'template-dialog'
      div.textContent = 'dialog-body'
      return div
    }

    // @vobs/ui Dialog 的核心结构：backdrop(root) > surface > (head) + body(mountSlot → insertDynamic)
    const root = document.createElement('div')
    root.setAttribute('role', 'presentation')

    const surface = document.createElement('section')
    surface.setAttribute('role', 'dialog')
    const body = document.createElement('div')
    surface.appendChild(body)
    root.appendChild(surface)

    // Dialog 的 open effect（模拟 dialog.ts 第 70-79 行）
    effect(() => {
      const open = request.value !== null
      ;(root as HTMLElement & { hidden: boolean }).hidden = !open
    })

    // mountSlot：children 插槽
    insertDynamic(body, null, () => {
      const value = request.value !== null ? buildBody() : null
      return value
    })

    // 页面结构：panel 在 Dialog 之前（同级兄弟）
    const page = document.createElement('div')
    const panel = document.createElement('div')
    panel.className = 'templates-grid'
    panel.textContent = 'template-card-content'
    page.appendChild(panel)
    page.appendChild(root)

    // 打开弹窗：open 与 children 同时为真
    request.set({ message: '删除模板？' })
    await flush()
    expect(body.querySelector('.template-dialog')).not.toBeNull()
    expect(page.querySelector('.templates-grid')).not.toBeNull()

    // 关闭弹窗：open 与 children 同时变 null（应用层最初的写法）
    request.set(null)
    await flush()
    expect(body.querySelector('.template-dialog')).toBeNull()
    // 关键断言：兄弟内容不消失
    expect(page.querySelector('.templates-grid')).not.toBeNull()
    expect(page.textContent).toContain('template-card-content')
  })
})

describe('用户态组件透传 children', () => {
  // 模拟编译产物：function Section({children}) { return <section>{children}</section> }
  // children 编译为 props 上的 getter（get accessor），读取时求值
  it('children 为节点时正常渲染而非 [object HTMLDivElement]', async () => {
    setRenderer(createDOMRenderer())
    function Section(props: { readonly children?: unknown }): Node {
      const section = document.createElement('section')
      // children 运行时为节点，类型上 unknown 需收敛到 DynamicChild 可接受形态
      insertDynamicValue(section, null, () => Reflect.get(props, 'children') as never)
      return section
    }
    // 调用方编译产物：children getter 返回构建好的节点（transformElement IIFE 求值结果）
    const node = createComponent(Section, {
      get children() {
        const div = document.createElement('div')
        div.textContent = 'inner'
        return div
      }
    })
    const host = document.createElement('div')
    insertBefore(host, node, null)
    expect(host.textContent).toBe('inner')
    expect(host.textContent).not.toContain('[object')
  })

  it('children 为节点数组时展开渲染', () => {
    setRenderer(createDOMRenderer())
    function Section(props: { readonly children?: unknown }): Node {
      const section = document.createElement('section')
      // children 运行时为节点/节点数组，类型上 unknown 需收敛到 DynamicChild 可接受形态
      insertDynamicValue(section, null, () => Reflect.get(props, 'children') as never)
      return section
    }
    const node = createComponent(Section, {
      get children() {
        const a = document.createElement('span')
        a.textContent = 'a'
        const b = document.createElement('span')
        b.textContent = 'b'
        return [a, b]
      }
    })
    const host = document.createElement('div')
    insertBefore(host, node, null)
    expect(host.textContent).toBe('ab')
  })
})

describe('insertDynamic 卸载子树的 effect 清理', () => {
  it('条件翻转为 null 后旧组件 effect 被清理（幽灵订阅检测）', async () => {
    setRenderer(createDOMRenderer())
    const visible = state(true)
    const unrelated = state(0)
    let cleanups = 0
    function Inner(): Node {
      effect(() => {
        unrelated.value // 组件体读取信号
        return () => {
          cleanups += 1
        }
      })
      return document.createElement('span')
    }
    const parent = document.createElement('div')
    insertDynamic(parent, null, () => (visible.value ? createComponent(Inner, {}) : null))
    await flush()
    expect(parent.querySelector('span')).not.toBeNull()

    visible.set(false)
    await flush()
    expect(parent.querySelector('span')).toBeNull()
    // 关键断言：旧 effect 已清理，不再订阅 unrelated
    expect(cleanups).toBe(1)

    unrelated.set(99)
    await flush()
    expect(cleanups).toBe(1)
  })

  it('嵌套组件 owner 随子树卸载一并清理', async () => {
    setRenderer(createDOMRenderer())
    const visible = state(true)
    const unrelated = state(0)
    const cleanups: string[] = []
    function Outer(): Node {
      effect(() => {
        unrelated.value
        return () => cleanups.push('outer')
      })
      const wrap = document.createElement('div')
      insertBefore(wrap, createComponent(Inner, {}), null)
      return wrap
    }
    function Inner(): Node {
      effect(() => {
        unrelated.value
        return () => cleanups.push('inner')
      })
      return document.createElement('span')
    }
    const parent = document.createElement('div')
    insertDynamic(parent, null, () => (visible.value ? createComponent(Outer, {}) : null))
    await flush()

    visible.set(false)
    await flush()
    expect(cleanups).toContain('outer')
    expect(cleanups).toContain('inner')

    unrelated.set(1)
    await flush()
    expect(cleanups.filter(entry => entry === 'outer')).toHaveLength(1)
    expect(cleanups.filter(entry => entry === 'inner')).toHaveLength(1)
  })
})
