# @vobs/test-utils

In-memory test renderer and assertion helpers for mounting Vobs components without a DOM.

## Install

```bash
npm install @vobs/test-utils
```

## Quick start

```ts
import { expect, it } from 'vitest'
import { addEventListener, bindText, createElement, createText, insertBefore, state } from '@vobs/vobs'
import { flushPromises, mount } from '@vobs/test-utils'

it('increments on click', async () => {
  const view = mount(() => {
    const count = state(0)
    const button = createElement('button')
    const text = createText('')
    insertBefore(button, text, null)
    bindText(text, () => `count: ${count.value}`)
    addEventListener(button, 'click', () => { count.value++ })
    return button
  })

  view.fireEvent('click', { target: 'button' })
  await flushPromises()

  expect(view.queryByText('count: 1')).toBeTruthy()
  view.destroy()
})
```

## API

| Signature | Description |
| --- | --- |
| `mount(render, options?)` | Mount a render function into an in-memory renderer; returns a `MountedTestApp`. `options.plugins` accepts `VobsPlugin[]`. |
| `createTestRenderer()` | Standalone `TestRenderer` exposing `container`, `renderer` and query helpers. |
| `view.queryByText(text)` | Find a text node with exact content. |
| `view.queryByTag(tag)` | Find the first element with that tag. |
| `view.queryByAttr(name, value)` | Find the first element with a matching attribute. |
| `view.fireEvent(event, { target })` | Invoke the handler registered for `event` on the element with that tag. |
| `view.update()` / `view.destroy()` | Flush an app update / unmount the app. |
| `act(fn)` | Run updates as one deterministic reactive transaction (`batch`). |
| `flushEffects()` | Flush queued effects without relying on implementation-specific timers. |
| `flushPromises()` | Resolve pending promise continuations, then flush reactive effects. |
| `measure(label, fn)` | Measure synchronous execution; returns `{ label, duration, result }`. |

## Types

TestNode, TestElement, TestText, TestComment, TestRenderer, MountedTestApp, PerformanceMeasurement
