// 动态绑定：将 Signal 绑定到 DOM 节点

import { effect } from '@vobs/reactivity'
import type { Signal } from '@vobs/reactivity'
import { setAttribute, setProperty, setTextContent } from './ops'

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
  effect(() => {
    setProperty(node, key, readSource(source))
  })
}
