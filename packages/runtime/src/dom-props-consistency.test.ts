// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { compile } from '@vobs/compiler'
import { createDOMRenderer, setRenderer, state } from '@vobs/vobs'
import { isPropertyName } from './dom-props'
import { bindSpreadProps, createElement, setProperty, setStaticProps, spreadProps } from './index'

setRenderer(createDOMRenderer())

const flush = async () => { await Promise.resolve(); await Promise.resolve() }

/*
 * 两条都是"编译期与运行期各写一份、且不一致"的老问题（.artifacts/reports/runtime.supplement.md 缺点 2/3）。
 * `dom-props.ts:1-8` 自称两边已收拢成单一来源，但那只覆盖**属性名**，没覆盖**事件名**，
 * 而属性名表里 `autofocus` 又用 DOM 小写、与同表的 readOnly/tabIndex 约定相反。
 */
describe('on* 事件名：运行期必须与编译期用同一张别名表', () => {
  it('onDoubleClick 展开后挂的是 dblclick，不是不存在的 doubleclick', async () => {
    const calls: string[] = []
    const props = { onDoubleClick: () => calls.push('dbl') }
    const el = createElement('div')
    spreadProps(el, props)

    el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    // 修复前：真实事件名是 "doubleclick"，dblclick 命中 0 次（回调永不触发且静默）
    expect(calls).toEqual(['dbl'])
  })

  it('onDoubleClick 的"隐藏监听"不存在（不会再挂到 doubleclick 上）', () => {
    const calls: string[] = []
    const el = createElement('div')
    spreadProps(el, { onDoubleClick: () => calls.push('dbl') })
    el.dispatchEvent(new Event('doubleclick', { bubbles: true }))
    expect(calls).toEqual([])
  })

  it('自定义事件 onMyEvent 保留大小写语义（不把 myEvent 降成 myevent 之外的东西）', () => {
    const calls: string[] = []
    const el = createElement('div')
    spreadProps(el, { onMyEvent: () => calls.push('custom') })
    el.dispatchEvent(new Event('myevent', { bubbles: true }))
    expect(calls).toEqual(['custom'])
  })

  it('身份稳定的展开里替换 onDoubleClick 时，旧监听被摘掉', async () => {
    const calls: string[] = []
    const first = state<() => void>(() => calls.push('first'))
    const props = { get onDoubleClick() { return first.value } }
    const el = createElement('div')
    bindSpreadProps(el, () => props)
    await flush()

    el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    expect(calls).toEqual(['first'])

    first.value = () => calls.push('second')
    await flush()
    el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    expect(calls).toEqual(['first', 'second'])
  })

  it('编译产物直接跑：onDoubleClick 真的能用', () => {
    // 注意 compile() 直接返回**代码字符串**（不是 { code }）
    const output = compile(
      'export const A = (props) => <div onDoubleClick={props.hit} />',
      { filename: 'a.tsx' }
    )
    expect(output).toContain('"dblclick"')
    expect(output).not.toContain('"doubleclick"')
  })
})

describe('autoFocus={false} 不得让元素自动聚焦', () => {
  /*
   * 判据是**属性存在与否**，不是 `el.autofocus`：
   * 实测 jsdom 与真实 DOM 的 IDL 都不反射 autofocus（`el.autofocus = true` 是 no-op，
   * 既不建属性也不改值），所以 property 通道在这里是静默失败 —— 修法必须走 attribute 通道。
   * 而 autofocus 的语义是"**属性存在**就聚焦"，与属性的值无关，
   * 所以 `String(false)` 写出的 `autofocus="false"` 会让 `autoFocus={false}` **真的自动聚焦**。
   */
  it('autoFocus={false} 不得留下 autofocus 属性', () => {
    const node = document.createElement('input') as HTMLInputElement
    setStaticProps(node, { autoFocus: false })
    // 修复前：走 attribute 通道 → String(false) → autofocus="false" → 仍然自动聚焦
    expect(node.hasAttribute('autofocus')).toBe(false)
  })

  it('autoFocus 为真时属性存在（属性存在即聚焦）', () => {
    const node = document.createElement('input') as HTMLInputElement
    setStaticProps(node, { autoFocus: true })
    expect(node.hasAttribute('autofocus')).toBe(true)
  })

  it('autoFocus 走 property 通道，且映射到全小写的 IDL 名', () => {
    /*
     * 这里曾经断言 `domAttributeName('autoFocus') === 'autofocus'`（走 attribute 别名）。
     * 那个做法是**错的**：`autofocus` 是布尔属性，attribute 通道会把 false 序列化成
     * `autofocus="false"`，而"属性存在即聚焦" → `autoFocus={false}` 反而真的聚焦。
     * 正解是走 property 通道（属性随 IDL 反射被正确移除）。
     */
    expect(isPropertyName('autoFocus')).toBe(true)
    // 但 IDL 名是全小写 `autofocus` —— 直接用驼峰 Reflect.set 只会挂 expando（静默无效）
    const el = document.createElement('input') as HTMLInputElement
    setProperty(el, 'autoFocus', true)
    expect(el.hasAttribute('autofocus')).toBe(true)
    expect(el.autofocus).toBe(true)
    setProperty(el, 'autoFocus', false)
    expect(el.hasAttribute('autofocus')).toBe(false)
    expect(el.autofocus).toBe(false)
  })

  it('展开里值为 false 时不设置属性（初始与增量都算）', async () => {
    const flag = state(false)
    const props = { get autoFocus() { return flag.value } }
    const el = createElement('input')
    bindSpreadProps(el, () => props)
    await flush()
    // 这是缺陷的本体：修复前 `String(false)` 会写出 autofocus="false" → 仍然自动聚焦
    expect(el.hasAttribute('autofocus')).toBe(false)

    // 真值时属性存在（属性存在即聚焦）
    flag.value = true
    await flush()
    expect(el.hasAttribute('autofocus')).toBe(true)
  })

  it('展开里删掉 autoFocus 键时属性被移除', async () => {
    const present = state(true)
    const props = new Proxy({} as Record<string, unknown>, {
      ownKeys: () => (present.value ? ['autoFocus'] : []),
      getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true, value: true }),
      get: (_t, key) => (key === 'autoFocus' ? true : undefined)
    })
    const el = createElement('input')
    bindSpreadProps(el, () => props)
    await flush()
    expect(el.hasAttribute('autofocus')).toBe(true)

    present.value = false
    await flush()
    expect(el.hasAttribute('autofocus')).toBe(false)
  })

  it('小写 autofocus 同样走属性通道（老写法不能是另一套语义）', () => {
    const node = document.createElement('input') as HTMLInputElement
    setStaticProps(node, { autofocus: false })
    expect(node.hasAttribute('autofocus')).toBe(false)
  })
})
