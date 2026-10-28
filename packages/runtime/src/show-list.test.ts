// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createDOMRenderer, setRenderer, insertShow, insertList } from '@vobs/vobs'
import { effect, state } from '@vobs/reactivity'

const tick = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

/**
 * insertShow — the compiled artifact dedicated to "keyed lists inside ternary/&&
 * branches" (the C232 cure).
 * Contract: cond only manages the container's mount/unmount; inside the container the
 * list goes through standard insertList (keyed reuse);
 * unmount = dispose the container scope (in-row effects cleaned up too, no ghost updates).
 */
describe('insertShow', () => {
  it('mounts the container and renders list rows when the condition is true; unmounts wholesale when false', async () => {
    setRenderer(createDOMRenderer())
    const parent = document.createElement('div')
    const visible = state(true)
    const items = state(['a', 'b'])
    insertShow(parent, null, () => visible.value, container => {
      insertList(container, null, () => items.value, item => {
        const el = document.createElement('span')
        el.dataset.item = item
        el.textContent = item
        return el
      })
    })
    expect(parent.querySelectorAll('span')).toHaveLength(2)
    expect(parent.textContent).toBe('ab')

    visible.value = false
    await tick()
    expect(parent.querySelectorAll('span')).toHaveLength(0)

    visible.value = true
    await tick()
    expect(parent.querySelectorAll('span')).toHaveLength(2)
    expect(parent.textContent).toBe('ab')
  })

  it('with the condition unchanged and the list changed, keyed reuse — reused rows don\'t re-render, only new rows go through renderItem', async () => {
    setRenderer(createDOMRenderer())
    const parent = document.createElement('div')
    const visible = state(true)
    const items = state([{ id: 'a' }, { id: 'b' }])
    let renderCount = 0
    insertShow(parent, null, () => visible.value, container => {
      insertList(container, null, () => items.value, item => {
        renderCount++
        const el = document.createElement('span')
        el.dataset.id = item.id
        return el
      }, item => item.id)
    })
    expect(renderCount).toBe(2)

    // cond jitter (false → true): the container is rebuilt, the whole list re-mounted
    visible.value = false
    await tick()
    renderCount = 0
    visible.value = true
    await tick()
    expect(renderCount).toBe(2)

    // cond stays true, only list data changes: keyed reuse — row a doesn't re-render, only row c is created
    renderCount = 0
    items.value = [{ id: 'a' }, { id: 'c' }]
    await tick()
    expect(renderCount).toBe(1)
    expect(parent.querySelector('[data-id="a"]')).not.toBeNull()
    expect(parent.querySelector('[data-id="b"]')).toBeNull()
    expect(parent.querySelector('[data-id="c"]')).not.toBeNull()
  })

  it('in-row effects are cleaned up after unmount and no longer respond to signals (no ghost updates)', async () => {
    setRenderer(createDOMRenderer())
    const parent = document.createElement('div')
    const visible = state(true)
    const items = state(['a'])
    const counter = state(0)
    const runs: number[] = []
    insertShow(parent, null, () => visible.value, container => {
      insertList(container, null, () => items.value, () => {
        const el = document.createElement('span')
        effect(() => {
          counter.value
          runs.push(counter.value)
          return () => { runs.push(-1) }
        })
        return el
      })
    })
    expect(runs).toEqual([0])

    visible.value = false
    await tick()
    expect(runs).toEqual([0, -1])

    counter.value = 1
    await tick()
    // Ghost effects must not fire again
    expect(runs).toEqual([0, -1])
  })

  it('high-frequency condition jitter produces no duplicate containers', async () => {
    setRenderer(createDOMRenderer())
    const parent = document.createElement('div')
    const visible = state(true)
    let mountCount = 0
    insertShow(
      parent,
      null,
      () => visible.value,
      () => { mountCount++ }
    )
    for (let i = 0; i < 5; i++) {
      visible.value = !visible.value
    }
    await tick()
    // Same-value signal writes don't trigger the effect; the final visible value depends on
    // the last write after the odd/even jitter.
    // Core assertion: mount happens only on a "false → true edge", never mounting repeatedly
    expect(mountCount).toBeLessThanOrEqual(3)
    expect(mountCount).toBeGreaterThanOrEqual(1)
    visible.value = true
    await tick()
    // Mounts once more from false → true; if already mounted, no repeat
    const after = mountCount
    visible.value = true
    await tick()
    expect(mountCount).toBe(after)
  })
})
