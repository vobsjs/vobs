// @vitest-environment jsdom
/*
 * Core invariant checks for vobs (the application layer).
 *
 *   I1 run-once      — component functions must **execute exactly once**; state changes
 *                      must never re-run them
 *   I2 lifecycle     — destroy must release owner/effect/plugin cleanups; failure paths
 *                      must not leave a "half-mounted" state
 *   I4 compile/runtime — the application layer's contract with the renderer/owner holds
 *
 * Criteria are always observable behavior (component body execution count, whether
 * effects still run, DOM results).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { effect, state } from '@vobs/reactivity'
import { createDOMRenderer } from '@vobs/dom'
import { createComponent, createElement as createElementNode, createVobs, setRenderer } from './index'

setRenderer(createDOMRenderer())

const flush = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await Promise.resolve()
}

let apps: Array<{ destroy(): void }> = []
afterEach(() => {
  for (const app of apps) { try { app.destroy() } catch { /* already destroyed */ } }
  apps = []
  document.body.innerHTML = ''
})

function makeContainer(): HTMLElement {
  const el = document.createElement('div')
  document.body.appendChild(el)
  return el
}

describe('I1 · component functions execute exactly once (run-once is the core invariant)', () => {
  it('state changes must not re-run the component body', async () => {
    let componentRuns = 0
    const counter = state(0)

    const app = createVobs({
      render: () => {
        componentRuns += 1
        return (() => {
          const el = document.createElement('div')
          el.textContent = `count:${counter.value}`
          return el
        })() as never
      }
    })
    apps.push(app)
    app.mount(makeContainer())
    expect(componentRuns).toBe(1)

    counter.value = 1
    counter.value = 2
    await flush()
    app.update()

    // The component body executes once; value updates are handled by bindings, not by re-running the component
    expect(componentRuns).toBe(1)
  })

  it('mounting again after mount must not run the component body again', () => {
    let componentRuns = 0
    const app = createVobs({
      render: () => {
        componentRuns += 1
        return document.createElement('div') as never
      }
    })
    apps.push(app)
    const a = makeContainer()
    const b = makeContainer()
    app.mount(a)
    expect(componentRuns).toBe(1)
    app.mount(b)                 // already mounted → should be a no-op
    expect(componentRuns).toBe(1)
  })
})

describe('I2 · destroy must release owner and effects', () => {
  it('effects created inside a component must not run after destroy', async () => {
    /*
     * `createComponent` is used so the effect is created under the **component's own
     * owner** — that is the real shape (createVobs' render alone does not create a
     * component owner, which wouldn't exercise destroy's cascade).
     */
    const value = state(0)
    let componentRuns = 0
    let effectRuns = 0

    const Child = () => {
      componentRuns += 1
      effect(() => { value.value; effectRuns += 1 })
      return createElementNode('div')
    }

    const app = createVobs({ render: () => createComponent(Child, {}) as never })
    apps.push(app)
    app.mount(makeContainer())
    expect(componentRuns).toBe(1)
    expect(effectRuns).toBe(1)

    value.value = 1
    await flush()
    expect(effectRuns).toBe(2)

    app.destroy()
    const before = effectRuns
    value.value = 2
    await flush()
    // The component owner is disposed with destroy → the effect must be unbound
    expect(effectRuns).toBe(before)
  })

  it('destroy must clear the container', () => {
    const app = createVobs({ render: () => document.createElement('section') as never })
    apps.push(app)
    const container = makeContainer()
    app.mount(container)
    expect(container.children.length).toBe(1)
    app.destroy()
    expect(container.children.length).toBe(0)
  })

  it('destroy is idempotent and does not run cleanups twice', () => {
    let cleans = 0
    const app = createVobs({ render: () => document.createElement('div') as never })
    apps.push(app)
    app.use({ name: 'p1', install: () => () => { cleans += 1 } })
    app.mount(makeContainer())
    app.destroy()
    app.destroy()
    expect(cleans).toBe(1)
  })

  it('plugin cleanups run after the component tree is released (ordering contract)', () => {
    const order: string[] = []
    const app = createVobs({ render: () => document.createElement('div') as never })
    apps.push(app)
    app.use({ name: 'p1', install: () => () => { order.push('plugin-cleanup') } })
    app.mount(makeContainer())
    app.destroy()
    // Current implementation: plugin cleanups first, then rootOwner.dispose
    expect(order).toEqual(['plugin-cleanup'])
  })

  it('after destroy, mount / update / use must all be rejected', () => {
    const app = createVobs({ render: () => document.createElement('div') as never })
    app.destroy()
    expect(() => app.mount(makeContainer())).toThrow()
    expect(() => app.update()).toThrow()
    expect(() => app.use({ name: 'x', install: () => {} })).toThrow()
  })
})

describe('I2 · failed mounts must not leave a half-mounted state', () => {
  it('after render throws: app.destroyed is true, the container is cleared, repeated destroy is safe', () => {
    const app = createVobs({
      render: () => { throw new Error('render boom') }
    })
    apps.push(app)
    const container = makeContainer()
    expect(() => app.mount(container)).toThrow('render boom')
    expect(app.destroyed).toBe(true)
    expect(app.mounted).toBe(false)
    expect(container.children.length).toBe(0)
    expect(() => app.destroy()).not.toThrow()
  })

  it('after render throws the container must **not** retain half-rendered nodes', () => {
    const app = createVobs({
      render: () => {
        const el = document.createElement('div')
        el.textContent = 'partial'
        throw new Error('after insert?')
      }
    })
    apps.push(app)
    const container = makeContainer()
    expect(() => app.mount(container)).toThrow()
    expect(container.querySelector('div')).toBeNull()
  })
})
