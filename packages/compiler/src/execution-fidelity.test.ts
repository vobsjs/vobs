// @vitest-environment jsdom
/*
 * I4 · 编译期与运行期一致性 / 产物语义保真
 *
 * `packages/compiler` 现有测试有 185 处 `toContain` 字符串断言 —— **产物从未被执行过**。
 * 本文件补上那个缺失的动作：把 JSX 编译成真的产物、写进临时模块、import 进来、
 * 挂到 jsdom 上，然后**只断言 DOM 结果**（不断言产物的字面形状）。
 *
 * 这样任何"编译期与运行期判断分叉"或"产物语义错误"都会露出可见症状。
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { createDOMRenderer } from '@vobs/dom'
import { createVobs, setRenderer } from '@vobs/vobs'
import { compile } from './index'

setRenderer(createDOMRenderer())

const tempDir = mkdtempSync(path.join(tmpdir(), 'vobs-compiler-exec-'))
afterAll(() => { rmSync(tempDir, { recursive: true, force: true }) })

let seq = 0
let mounted: Array<{ destroy(): void }> = []
afterEach(() => { for (const app of mounted) { try { app.destroy() } catch { /* 已销毁 */ } } mounted = [] })

/**
 * 编译一段组件源码 → 写成临时 .mjs → 动态 import → 挂载 → 返回根元素。
 * 临时模块就放在本包目录下，这样 `@vobs/vobs` 的解析与产物在真实使用中一致。
 */
async function renderComponent(source: string): Promise<{ root: Element; mod: Record<string, unknown> }> {
  const out = compile(source, { filename: `Comp${seq}.tsx` })
  const file = path.join(import.meta.dirname, `__exec-${seq}.mjs`)
  seq += 1
  writeFileSync(file, out, 'utf8')
  try {
    const mod = await import(/* @vite-ignore */ pathToFileURL(file).href) as Record<string, unknown>
    const container = document.createElement('div')
    document.body.appendChild(container)
    const Component = mod.App as () => unknown
    const app = createVobs({ render: () => Component() as never })
    app.mount(container)
    mounted.push(app)
    return { root: container, mod }
  } finally {
    rmSync(file, { force: true })
  }
}

describe('I4 · 文本内容的语义保真（编译产物 vs HTML 语义）', () => {
  it('普通文本原样进 DOM', async () => {
    const { root } = await renderComponent('export const App = () => <div>hello world</div>')
    expect(root.querySelector('div')?.textContent).toBe('hello world')
  })

  it('裸 & 与 < 反映为字面字符', async () => {
    const { root } = await renderComponent('export const App = () => <div>a & b</div>')
    expect(root.querySelector('div')?.textContent).toBe('a & b')
  })

  it('尖括号与引号作为文本时不得被当成标记', async () => {
    const { root } = await renderComponent('export const App = () => <div>{"<b>bold</b>"}</div>')
    expect(root.querySelector('div')?.textContent).toBe('<b>bold</b>')
    expect(root.querySelector('b')).toBeNull()
  })

  it('花括号里的比较表达式产出正确文本', async () => {
    const { root } = await renderComponent(
      'export const App = () => { const n = 2; return <div>{n > 1 ? "yes" : "no"}</div> }'
    )
    expect(root.querySelector('div')?.textContent).toBe('yes')
  })
})

describe('I4 · 属性通道：编译产物必须与运行期同一张表', () => {
  it('className 落成 class', async () => {
    const { root } = await renderComponent('export const App = () => <div className="a b" />')
    expect(root.querySelector('div')?.getAttribute('class')).toBe('a b')
  })

  it('htmlFor 落成 for（label 关联必须成立）', async () => {
    const { root } = await renderComponent(
      'export const App = () => <label htmlFor="name">N</label>'
    )
    expect(root.querySelector('label')?.getAttribute('for')).toBe('name')
    expect(root.querySelector('label')?.htmlFor).toBe('name')
  })

  it('tabIndex 落成 tabindex', async () => {
    const { root } = await renderComponent('export const App = () => <div tabIndex={3} />')
    expect(root.querySelector('div')?.getAttribute('tabindex')).toBe('3')
  })

  it('colSpan / rowSpan 落成 colspan / rowspan', async () => {
    const { root } = await renderComponent(
      'export const App = () => <table><tbody><tr><td colSpan={2} rowSpan={3}>x</td></tr></tbody></table>'
    )
    const td = root.querySelector('td')
    expect(td?.getAttribute('colspan')).toBe('2')
    expect(td?.getAttribute('rowspan')).toBe('3')
  })

  it('布尔属性：真值存在、假值不设置', async () => {
    const on = await renderComponent('export const App = () => <input disabled />')
    expect((on.root.querySelector('input') as HTMLInputElement)?.disabled).toBe(true)
    const off = await renderComponent('export const App = () => <input disabled={false} />')
    expect((off.root.querySelector('input') as HTMLInputElement)?.disabled).toBe(false)
    expect(off.root.querySelector('input')?.hasAttribute('disabled')).toBe(false)
  })

  it('autoFocus={false} 不得留下 autofocus 属性（属性存在即聚焦）', async () => {
    const { root } = await renderComponent('export const App = () => <input autoFocus={false} />')
    expect(root.querySelector('input')?.hasAttribute('autofocus')).toBe(false)
  })

  it('受控 value 落到 property', async () => {
    const { root } = await renderComponent('export const App = () => <input value="v1" />')
    expect((root.querySelector('input') as HTMLInputElement).value).toBe('v1')
  })
})

describe('I4 · 事件名：编译期与运行期必须得出同一事件名', () => {
  it('onDoubleClick 绑定的是 dblclick', async () => {
    const { root, mod } = await renderComponent(
      'export const App = () => <button onDoubleClick={() => { globalThis.__dbl = (globalThis.__dbl ?? 0) + 1 }}>x</button>'
    )
    const btn = root.querySelector('button')!
    ;(globalThis as Record<string, unknown>).__dbl = 0
    btn.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    expect((globalThis as Record<string, unknown>).__dbl).toBe(1)
    // 不存在的 doubleclick 不应被挂上
    btn.dispatchEvent(new Event('doubleclick', { bubbles: true }))
    expect((globalThis as Record<string, unknown>).__dbl).toBe(1)
    void mod
  })

  it('onClick 绑定的是 click', async () => {
    const { root } = await renderComponent(
      'export const App = () => <button onClick={() => { globalThis.__clk = (globalThis.__clk ?? 0) + 1 }}>x</button>'
    )
    ;(globalThis as Record<string, unknown>).__clk = 0
    root.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect((globalThis as Record<string, unknown>).__clk).toBe(1)
  })
})
