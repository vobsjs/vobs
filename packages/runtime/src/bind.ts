// Dynamic binding: bind a Signal to a DOM node

import { effect } from '@vobs/reactivity'
import type { Signal } from '@vobs/reactivity'
import { applyClassList, registerSelectValueBinding, setAttribute, setProperty, setTextContent } from './ops'

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
     * Only null/undefined are blocked here: `String(undefined)` would write the literal
     * "undefined" into placeholder and similar attributes.
     *
     * ⚠️ **`false` must pass through** — it must not be treated as "don't set" here,
     * because HTML attributes come in two kinds:
     * - **Enumerated attributes** (spellcheck / contenteditable / draggable / autocomplete…)
     *   have **semantic values**: `spellcheck="false"` means the **opposite** of the default
     *   (= true), so `spellCheck={false}` really must emit `spellcheck="false"`. A test
     *   pins this down (jsx-integration ⑤).
     * - **Boolean attributes** (disabled / checked / autofocus…) only care about presence,
     *   not value — those must go through the **property channel** (`bindProperty` with the
     *   boolean clearing value false) to be removed correctly.
     *
     * Treating `false` as "remove" here looks like it would fix `autoFocus={false}`, but it
     * actually inverts spellCheck's semantics (`false` becomes "remove attribute" = back to
     * the default true = spell check on, the opposite of the intent). The correct approach
     * is to route **boolean attributes through the property channel** — see PROPERTY_NAMES
     * in `dom-props.ts`.
     */
    if (value === null || value === undefined) return
    /*
     * `classList` has a dedicated channel: it writes the same HTML attribute as `class`
     * and needs the "remember the last contribution, replace it this time" merge semantics
     * (see applyClassList in ops.ts). A direct `setAttribute(node,'classList', …)` would
     * only write a `classlist` attribute the browser doesn't know.
     */
    if (key === 'classList') {
      applyClassList(node, value)
      return
    }
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
    // false on property keys is semantic (e.g. disabled={false} must clear) and must pass
    // through; but null/undefined are skipped — the DOM coerces undefined into the string
    // "undefined" (e.g. input.value)
    if (value === null || value === undefined) return
    setProperty(node, key, value)
  })
}
