// @vitest-environment jsdom
// JSX 编译产物 + runtime 集成回归：复现 Labelune 侧报过的两个场景
// ③ 列表内动态 style 表达式（品牌色板：动态 style 渲染不出来 → 全透明）
// ④ 列表条目内「节点↔null」条件（信号已 set 但节点不出现/不移除）
import { describe, expect, it } from 'vitest'
import { compile } from '@vobs/compiler'
import { createDOMRenderer } from '@vobs/vobs'
import {
  createElement,
  createText,
  createTemplate,
  cloneTemplate,
  insertBefore,
  insertDynamic,
  insertList,
  insertDynamicValue,
  bindAttribute,
  bindText,
  bindProperty,
  setStaticProps,
  setProperty,
  setAttribute, addEventListener, spreadProps, setRef,
  setRenderer
} from '@vobs/runtime'
import { state } from '@vobs/reactivity'

/** 编译 JSX 源码并执行：helper 以运行时实现注入（与 vite-plugin 编译路径等价） */
function runJsx(source: string): unknown {
  const compiled = compile(source, { filename: 'integration.tsx' }) as unknown as string
  const imports = compiled.match(/import \{([^}]+)\} from "@vobs\/vobs";/)
  if (!imports) throw new Error('编译产物缺少 runtime 导入')
  const code = compiled.replace(imports[0], '')
  const names = imports[1]!.split(',').map(name => name.trim()).filter(Boolean)
  const impls: Record<string, unknown> = {
    createElement, createText, createTemplate, cloneTemplate,
    insertBefore, insertDynamic, insertList, insertDynamicValue,
    bindAttribute, bindText, bindProperty, setStaticProps, setProperty,
    setAttribute, addEventListener, spreadProps, setRef
  }
  const args = names.map(name => {
    if (!(name in impls)) throw new Error(`未注入的 runtime helper: ${name}`)
    return impls[name]
  })
  return new Function(...names, `"use strict";\n${code}; return el;`)(...args)
}

describe('JSX 编译 × runtime 集成回归', () => {
  it('③ 列表内动态 style 表达式正常着色（品牌色板场景）', () => {
    setRenderer(createDOMRenderer())
    const el = runJsx(`
      const colors = [{ hex: '#10b981', label: '绿' }, { hex: '#f97316', label: '橙' }]
      const el = <div>{colors.map(c => (
        <button type="button" class="dot" style={\`background: \${c.hex}\`} key={c.hex}>{c.label}</button>
      ))}</div>
    `) as HTMLElement
    const dots = el.querySelectorAll('button')
    expect(dots.length).toBe(2)
    expect((dots[0] as HTMLElement).style.background).toContain('rgb(16, 185, 129)')
    expect((dots[0] as HTMLElement).style.background).not.toBe('')
  })

  it('④ 列表条目内「节点↔null」条件响应外部信号', async () => {
    setRenderer(createDOMRenderer())
    const el = runJsx(`
      const active = { value: 'a' }
      const items = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]
      const el = <div>{items.map(item => (
        <div class="row" key={item.id}>
          {active.value === item.id ? <span class="dot-on">on</span> : null}
          <span>{item.label}</span>
        </div>
      ))}</div>
    `) as HTMLElement
    // 注意：源码里的 active 被编译产物捕获为普通对象，外部信号驱动需通过行内 effect 订阅的信号
    // 这里直接验证初次渲染 + 条件分支两种初始形态
    expect(el.querySelectorAll('.dot-on').length).toBe(1)
  })

  it('④b 列表条目内「节点↔null」条件随真实信号翻转', async () => {
    setRenderer(createDOMRenderer())
    const active = state('a')
    const el = runJsxWith(`
      const items = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]
      const el = <div>{items.map(item => (
        <div class="row" key={item.id}>
          {active.value === item.id ? <span class="dot-on">on</span> : null}
          <span>{item.label}</span>
        </div>
      ))}</div>
    `, { active }) as HTMLElement
    expect(el.querySelectorAll('.dot-on').length).toBe(1)
    active.value = 'b'
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(el.querySelectorAll('.dot-on').length).toBe(1)
    expect((el.querySelectorAll('.row')[1] as HTMLElement).querySelector('.dot-on')).not.toBeNull()
    expect((el.querySelectorAll('.row')[0] as HTMLElement).querySelector('.dot-on')).toBeNull()
  })

  it('④c 列表条目内「节点↔null」条件随列表项对象属性翻转（item 信号驱动）', async () => {
    setRenderer(createDOMRenderer())
    const items = state([
      { id: 'a', label: 'A', on: true },
      { id: 'b', label: 'B', on: false }
    ])
    const el = runJsxWith(`
      const el = <div>{items.value.map(item => (
        <div class="row" key={item.id}>
          {item.on ? <span class="dot-on">on</span> : null}
          <span>{item.label}</span>
        </div>
      ))}</div>
    `, { items }) as HTMLElement
    expect(el.querySelectorAll('.dot-on').length).toBe(1)
    items.value = [
      { id: 'a', label: 'A', on: false },
      { id: 'b', label: 'B', on: true }
    ]
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(el.querySelectorAll('.dot-on').length).toBe(1)
    expect((el.querySelectorAll('.row')[1] as HTMLElement).querySelector('.dot-on')).not.toBeNull()
    expect((el.querySelectorAll('.row')[0] as HTMLElement).querySelector('.dot-on')).toBeNull()
  })

  it('② 指针事件编译为 pointerdown 监听并可触发', () => {
    setRenderer(createDOMRenderer())
    const el = runJsx(`
      const el = <div onPointerDown={() => { window.__downs = (window.__downs ?? 0) + 1 }} />
    `) as HTMLElement
    el.dispatchEvent(new PointerEvent('pointerdown'))
    expect((window as unknown as { __downs?: number }).__downs).toBe(1)
  })

  it('⑤ role/spellCheck/autoComplete 属性正确落 DOM', () => {
    setRenderer(createDOMRenderer())
    const el = runJsx(`
      const el = <div>
        <div role="dialog" />
        <input spellCheck={false} autoComplete="off" />
        <td colSpan={2} />
      </div>
    `) as HTMLElement
    expect(el.querySelector('[role="dialog"]')).not.toBeNull()
    const input = el.querySelector('input') as HTMLInputElement
    expect(input.getAttribute('autocomplete')).toBe('off')
    expect(input.getAttribute('spellcheck')).toBe('false')
    expect((el.querySelector('td') as HTMLTableCellElement).colSpan).toBe(2)
  })

  it('⑥ select 绑定 value 时选项异步到达自动重同步（不再需要 ref 兜底）', async () => {
    setRenderer(createDOMRenderer())
    const items = state<string[]>([])
    const el = runJsxWith(`
      const current = { value: 'b' }
      const el = <select value={current.value}>{items.value.map(o => <option value={o}>{o}</option>)}</select>
    `, { items }) as HTMLSelectElement
    expect(el.value).toBe('')
    items.value = ['a', 'b', 'c']
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(el.value).toBe('b')
  })

  it('⑥b select 选项经 optgroup 插入同样重同步', async () => {
    setRenderer(createDOMRenderer())
    interface Group { readonly label: string; readonly options: readonly string[] }
    const groups = state<readonly Group[]>([])
    const el = runJsxWith(`
      const current = { value: 'b' }
      const el = <select value={current.value}>{groups.value.map(group => (
        <optgroup label={group.label}>{group.options.map(o => <option value={o}>{o}</option>)}</optgroup>
      ))}</select>
    `, { groups }) as HTMLSelectElement
    expect(el.value).toBe('')
    groups.value = [{ label: 'G', options: ['a', 'b'] }]
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(el.value).toBe('b')
  })
})

/** runJsx 变体：额外注入外部依赖（真实信号等），供编译产物闭包引用 */
function runJsxWith(source: string, deps: Record<string, unknown> = {}): unknown {
  const compiled = compile(source, { filename: 'integration-deps.tsx' }) as unknown as string
  const imports = compiled.match(/import \{([^}]+)\} from "@vobs\/vobs";/)
  if (!imports) throw new Error('编译产物缺少 runtime 导入')
  const code = compiled.replace(imports[0], '')
  const names = imports[1]!.split(',').map(name => name.trim()).filter(Boolean)
  const impls: Record<string, unknown> = {
    createElement, createText, createTemplate, cloneTemplate,
    insertBefore, insertDynamic, insertList, insertDynamicValue,
    bindAttribute, bindText, bindProperty, setStaticProps, setProperty,
    setAttribute, addEventListener, spreadProps, setRef
  }
  const argNames = [...names, ...Object.keys(deps)]
  const args = [...names.map(name => {
    if (!(name in impls)) throw new Error(`未注入的 runtime helper: ${name}`)
    return impls[name]
  }), ...Object.values(deps)]
  return new Function(...argNames, `"use strict";\n${code}; return el;`)(...args)
}
