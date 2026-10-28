// @vitest-environment jsdom
/*
 * The value replay when `<select value={…}>` gets options inserted **must not establish
 * a hidden subscription**.
 *
 * Mechanism: `bindProperty(select,'value',…)` registers a reader (`selectValueReaders` in
 * `ops.ts`), and inserting an `<option>` synchronously replays the current value.
 * The insertion usually happens while some effect is running (`insertList`/
 * `insertDynamic` are both effect-driven) — if the read inside the replay were counted
 * into the **outer effect's dependencies**, the effect would from then on be woken by
 * that signal: one extra edge in the dependency graph nobody intended (a "hidden
 * subscription"), showing up as "some unrelated effect re-ran when options were inserted".
 *
 * The criterion is **behavioral**: the outer effect's re-run count.
 * Before the fix: inserting an option re-ran the outer effect (it had accidentally
 * subscribed to the value signal).
 * After: the outer effect is driven only by signals it reads itself.
 */
import { describe, expect, it } from 'vitest'
import { createDOMRenderer, setRenderer, state } from '@vobs/vobs'
import { effect, scheduler } from '@vobs/reactivity'
import { bindProperty, createElement, insertBefore, setAttribute } from './index'

setRenderer(createDOMRenderer())
const settle = (): void => { scheduler.flush() }

function optionFor(value: string): HTMLOptionElement {
  const option = createElement('option') as HTMLOptionElement
  setAttribute(option, 'value', value)
  return option
}

describe('<select> value replay must not establish hidden subscriptions', () => {
  it('inserting an option does not wake effects other than the "value signal"', () => {
    const select = createElement('select') as HTMLSelectElement
    const selectedValue = state('b')
    const unrelated = state(0)

    bindProperty(select, 'value', () => selectedValue.value)

    // Outer effect: reads only `unrelated`, unrelated to the select's value
    let runs = 0
    const stop = effect(() => {
      runs += 1
      void unrelated.value
      // Insert an option inside the effect — simulating list-driven dynamic options
      const option = optionFor('a')
      insertBefore(select, option, null)
    })
    settle()
    const afterFirst = runs
    expect(afterFirst).toBeGreaterThanOrEqual(1)

    // Change the **value signal**: the outer effect never read it; it must not be woken
    selectedValue.value = 'a'
    settle()
    expect(runs, 'the option-insertion path made the outer effect accidentally subscribe to the select\'s value signal').toBe(afterFirst)

    stop.dispose()
  })

  it('the replay still works: dynamically inserted options hit the already-bound value', () => {
    const select = createElement('select') as HTMLSelectElement
    const selectedValue = state('b')
    bindProperty(select, 'value', () => selectedValue.value)
    settle()

    insertBefore(select, optionFor('a'), null)
    insertBefore(select, optionFor('b'), null)
    settle()

    // The option for value 'b' now exists → select.value should hit it
    expect(select.value).toBe('b')
  })

  it('the value signal\'s own changes still drive select.value (the binding wasn\'t broken by untrack)', () => {
    const select = createElement('select') as HTMLSelectElement
    const selectedValue = state('a')
    bindProperty(select, 'value', () => selectedValue.value)
    insertBefore(select, optionFor('a'), null)
    insertBefore(select, optionFor('b'), null)
    settle()
    expect(select.value).toBe('a')

    selectedValue.value = 'b'
    settle()
    expect(select.value, 'the bound effect didn\'t follow the value signal').toBe('b')
  })

  it('options inside an optgroup also trigger the replay (existing semantics unchanged)', () => {
    const select = createElement('select') as HTMLSelectElement
    const selectedValue = state('x')
    bindProperty(select, 'value', () => selectedValue.value)
    const group = createElement('optgroup')
    insertBefore(select, group, null)
    insertBefore(group, optionFor('x'), null)
    settle()
    expect(select.value).toBe('x')
  })

  it('inserting an option into a select with no bound value is safe (no reader exists)', () => {
    const select = createElement('select') as HTMLSelectElement
    expect(() => {
      insertBefore(select, optionFor('a'), null)
    }).not.toThrow()
    expect(select.value).toBe('a')
  })
})
