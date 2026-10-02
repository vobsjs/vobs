// @vitest-environment jsdom
/*
 * focus trap 必须只把**真的可聚焦**的元素算进去。
 *
 * 原来 `focusable()` 只过滤 `disabled` 与 `aria-hidden="true"`，于是 `hidden`、
 * `display:none`、`visibility:hidden`、`tabindex="-1"`、`inert` 子树里的元素**全部**被算作可聚焦。
 *
 * 后果不只是"焦点落在隐藏元素上"。Tab 循环用的是 `first`/`last` 两个端点：
 * **最后一个可见元素之后还有隐藏元素**时，`last` 会算成隐藏那个 ——
 * 用户在最后一个可见元素上按 Tab，焦点就被送进不可见区域（表现为"焦点消失了"）。
 * 这正是本文件第一条用例锁住的形态。
 *
 * ⚠️ 判断"隐藏"只看内联样式与 `hidden` 属性，不做 `getComputedStyle`
 * （jsdom 不加载外部样式表；且每次 Tab 强制样式计算太贵）。
 * 由 class / 外部样式表造成的隐藏识别不到 —— 那请用 `hidden` 或 `aria-hidden="true"`。
 */
import { describe, expect, it } from 'vitest'
import { createFocusTrap } from './overlay'

interface Fixture { root: HTMLElement; outside: HTMLButtonElement; cleanup: () => void }

function fixture(): Fixture {
  const root = document.createElement('div')
  const outside = document.createElement('button')
  outside.textContent = 'outside'
  document.body.append(outside, root)
  return {
    root,
    outside,
    cleanup: () => { root.remove(); outside.remove() }
  }
}

function button(label: string): HTMLButtonElement {
  const el = document.createElement('button')
  el.textContent = label
  return el
}

function pressTab(root: HTMLElement, shift = false): void {
  root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift, bubbles: true }))
}

describe('focus trap：不可见元素不得算作可聚焦', () => {
  it('末尾的 hidden 元素不被当作 last（Tab 不落进不可见区域）', () => {
    const f = fixture()
    const first = button('first')
    const visible = button('visible')
    const hidden = button('hidden')
    hidden.hidden = true
    f.root.append(first, visible, hidden)

    const trap = createFocusTrap(f.root)
    trap.activate()
    expect(document.activeElement).toBe(first)

    visible.focus()
    pressTab(f.root)
    // 修复前：last 算成 hidden → 焦点不动或落到 hidden 上；现在应回到 first
    expect(document.activeElement, 'Tab 把焦点送进了隐藏元素').toBe(first)
    expect(document.activeElement).not.toBe(hidden)

    trap.dispose()
    f.cleanup()
  })

  it('display:none 的元素不参与', () => {
    const f = fixture()
    const first = button('first')
    const gone = button('gone')
    gone.style.display = 'none'
    f.root.append(first, gone)

    const trap = createFocusTrap(f.root)
    trap.activate()
    expect(document.activeElement).toBe(first)

    pressTab(f.root)
    expect(document.activeElement).toBe(first)
    trap.dispose()
    f.cleanup()
  })

  it('visibility:hidden 的元素不参与', () => {
    const f = fixture()
    const first = button('first')
    const invisible = button('invisible')
    invisible.style.visibility = 'hidden'
    f.root.append(first, invisible)

    const trap = createFocusTrap(f.root)
    trap.activate()
    pressTab(f.root)
    expect(document.activeElement).toBe(first)
    trap.dispose()
    f.cleanup()
  })

  it('祖先 display:none 时子元素不参与', () => {
    const f = fixture()
    const first = button('first')
    const wrap = document.createElement('div')
    wrap.style.display = 'none'
    const child = button('child')
    wrap.append(child)
    f.root.append(first, wrap)

    const trap = createFocusTrap(f.root)
    trap.activate()
    pressTab(f.root)
    expect(document.activeElement).toBe(first)
    trap.dispose()
    f.cleanup()
  })

  it('tabindex="-1" 不参与 Tab 序列（但仍是可编程聚焦）', () => {
    const f = fixture()
    const first = button('first')
    const programmatic = button('programmatic')
    programmatic.setAttribute('tabindex', '-1')
    f.root.append(first, programmatic)
    // 确认它确实可被程序化聚焦（否则这条测试没有意义）
    programmatic.focus()
    expect(document.activeElement).toBe(programmatic)

    const trap = createFocusTrap(f.root)
    trap.activate()
    first.focus()
    pressTab(f.root)
    expect(document.activeElement).toBe(first)
    trap.dispose()
    f.cleanup()
  })

  it('inert 子树里的元素不参与', () => {
    const f = fixture()
    const first = button('first')
    const inertWrap = document.createElement('div')
    inertWrap.setAttribute('inert', '')
    const inertButton = button('inert')
    inertWrap.append(inertButton)
    f.root.append(first, inertWrap)

    const trap = createFocusTrap(f.root)
    trap.activate()
    pressTab(f.root)
    expect(document.activeElement).toBe(first)
    trap.dispose()
    f.cleanup()
  })

  it('aria-hidden="true" 的祖先同样排除（既有语义保留）', () => {
    const f = fixture()
    const first = button('first')
    const ariaWrap = document.createElement('div')
    ariaWrap.setAttribute('aria-hidden', 'true')
    const ariaButton = button('aria')
    ariaWrap.append(ariaButton)
    f.root.append(first, ariaWrap)

    const trap = createFocusTrap(f.root)
    trap.activate()
    pressTab(f.root)
    expect(document.activeElement).toBe(first)
    trap.dispose()
    f.cleanup()
  })

  it('Shift+Tab 从第一个可见元素回绕到**最后一个可见**元素', () => {
    const f = fixture()
    const first = button('first')
    const lastVisible = button('lastVisible')
    const hiddenAtEnd = button('hiddenAtEnd')
    hiddenAtEnd.hidden = true
    f.root.append(first, lastVisible, hiddenAtEnd)

    const trap = createFocusTrap(f.root)
    trap.activate()
    expect(document.activeElement).toBe(first)
    pressTab(f.root, true)
    expect(document.activeElement, 'Shift+Tab 回绕到了隐藏元素').toBe(lastVisible)
    trap.dispose()
    f.cleanup()
  })

  it('可见元素依旧正常循环（没有把功能一起打死）', () => {
    const f = fixture()
    const first = button('first')
    const last = button('last')
    f.root.append(first, last)

    const trap = createFocusTrap(f.root)
    trap.activate()
    expect(document.activeElement).toBe(first)
    last.focus()
    pressTab(f.root)
    expect(document.activeElement).toBe(first)     // 正向回绕
    first.focus()
    pressTab(f.root, true)
    expect(document.activeElement).toBe(last)      // 反向回绕
    trap.dispose()
    f.cleanup()
  })

  it('全部元素都不可见时，Tab 不把焦点送出 trap', () => {
    const f = fixture()
    const hidden = button('hidden')
    hidden.hidden = true
    f.root.append(hidden)
    f.root.setAttribute('tabindex', '-1')

    const trap = createFocusTrap(f.root)
    trap.activate()
    pressTab(f.root)
    // 没有可聚焦元素时，代码路径会把焦点交给 root 并 preventDefault
    expect(document.activeElement).toBe(f.root)
    expect(document.activeElement).not.toBe(f.outside)
    trap.dispose()
    f.cleanup()
  })
})
