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
    // 与 bindText 一致地挡住 null/undefined：String(undefined) 会把字面量 "undefined"
    // 写进 placeholder 等属性。false 必须透传（如 spellCheck={false} → spellcheck="false"）
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
