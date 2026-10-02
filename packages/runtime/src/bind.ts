// 动态绑定：将 Signal 绑定到 DOM 节点

import { effect } from '@vobs/reactivity'
import type { Signal } from '@vobs/reactivity'
import { registerSelectValueBinding, setAttribute, setProperty, setTextContent } from './ops'

export type ValueSource<T> = Signal<T> | (() => T)

function readSource<T>(source: ValueSource<T>): T {
  return typeof source === 'function' ? source() : source.value
}

export function bindText(
  node: Text,
  source: ValueSource<unknown>
): void {
  effect(() => {
    const value = readSource(source)
    setTextContent(node, value === null || value === undefined || typeof value === 'boolean' ? '' : String(value))
  })
}

export function bindAttribute(
  node: Element,
  key: string,
  source: ValueSource<unknown>
): void {
  effect(() => {
    const value = readSource(source)
    /*
     * 只挡 null/undefined：`String(undefined)` 会把字面量 "undefined" 写进 placeholder 等属性。
     *
     * ⚠️ **`false` 必须透传**，不能在这里当成"不设置" —— HTML 的属性分两类：
     * - **枚举属性**（spellcheck / contenteditable / draggable / autocomplete…）**值有语义**：
     *   `spellcheck="false"` 与缺省（= true）意图**相反**，所以 `spellCheck={false}`
     *   必须真的写出 `spellcheck="false"`。这一条有测试钉住（jsx-integration ⑤）。
     * - **布尔属性**（disabled / checked / autofocus…）只看"存在与否"、与值无关 ——
     *   那类必须走 **property 通道**（`bindProperty` + 布尔清除值 false）才能正确移除。
     *
     * 曾经试过在这里把 `false` 一律当"移除"来修 `autoFocus={false}`，结果把 spellCheck
     * 的语义弄反了（`false` 变成"移除属性" = 回到缺省 true = 打开拼写检查，与意图相反）。
     * 正确做法是让**布尔属性走 property 通道**，见 `dom-props.ts` 的 PROPERTY_NAMES。
     */
    if (value === null || value === undefined) return
    setAttribute(node, key, key === 'style' && value && typeof value === 'object' && !Array.isArray(value)
      ? Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== null && entry !== undefined && entry !== false)
        .map(([name, entry]) => `${name.replace(/[A-Z]/gu, match => `-${match.toLowerCase()}`)}:${String(entry)}`)
        .join(';')
      : String(value))
  })
}

export function bindProperty(
  node: Element,
  key: string,
  source: ValueSource<unknown>
): void {
  // Select initial-value auto resync: remember the bound reader so that inserting
  // <option> children later re-applies the current value (see ops.insertBefore).
  if (key === 'value' && node.nodeName === 'SELECT') {
    registerSelectValueBinding(node, () => readSource(source))
  }
  effect(() => {
    const value = readSource(source)
    // property 键的 false 有语义（如 disabled={false} 必须清除）必须透传；
    // 但 null/undefined 跳过——DOM 会把 undefined 强转成字符串 "undefined"（如 input.value）
    if (value === null || value === undefined) return
    setProperty(node, key, value)
  })
}
