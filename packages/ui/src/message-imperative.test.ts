// @vitest-environment jsdom
/*
 * Imperative `message` API usable outside components (item P of the external pitfalls doc).
 *
 * There used to be only the component form `MessageHost`, which obtains the context via
 * `inject` — **only reachable inside a component body**. Consumers were forced to build their
 * own global bridge in `stores/toast.ts` (calling `bindToast` once when the App mounts);
 * the docs say such hand-rolled substitutes are "themselves a breeding ground for future
 * pitfalls".
 *
 * Criteria: `message.success(...)` can be called where there is **no component context at all**
 * (module top level / plain functions), the message actually enters the Host in the UI, and
 * calling after the Host unmounts **throws with an explanation** instead of being silently
 * dropped.
 */
import { describe, expect, it } from 'vitest'
import { createNotification } from '@vobs/notification'
import { scheduler } from '@vobs/reactivity'
import { createComponent, createDOMRenderer, createVobs, setRenderer } from '@vobs/vobs'
import type { VobsNode } from '@vobs/vobs'
import { message, MessageHost } from './index'

setRenderer(createDOMRenderer())
// Messages enter the signal synchronously, but DOM rendering is dispatched asynchronously by the
// scheduler — flush before asserting on text
const flush = (): void => { scheduler.flush() }

function mountHost() {
  const context = createNotification()
  const host = document.createElement('main')
  document.body.appendChild(host)
  const app = createVobs({
    render: () => createComponent(MessageHost, { message: context } as never)
  })
  app.mount(host)
  return {
    context,
    host,
    cleanup: () => { app.destroy(); host.remove(); context.dispose() }
  }
}

describe('imperative message API (usable outside components)', () => {
  it('calling message.success outside a component → the message enters the Host', () => {
    const view = mountHost()
    // Pure module scope here, with no inject context whatsoever
    const id = message.success('已保存')
    expect(typeof id).toBe('string')
    expect(view.context.notifications.value).toHaveLength(1)
    expect(view.context.notifications.value[0]!.content).toBe('已保存')
    flush()
    expect(view.host.textContent).toContain('已保存')
    view.cleanup()
  })

  it('all four types work', () => {
    const view = mountHost()
    message.info('i')
    message.success('s')
    message.warning('w')
    message.error('e')
    expect(view.context.notifications.value.map(item => item.type)).toEqual(['info', 'success', 'warning', 'error'])
    view.cleanup()
  })

  it('dismiss / clear are also callable outside components', () => {
    const view = mountHost()
    const id = message.info('a')
    message.info('b')
    expect(view.context.notifications.value).toHaveLength(2)
    expect(message.dismiss(id)).toBe(true)
    expect(view.context.notifications.value).toHaveLength(1)
    message.clear()
    expect(view.context.notifications.value).toHaveLength(0)
    view.cleanup()
  })

  it('calling after the Host unmounts → throws with an explanation (not silently dropped)', () => {
    const view = mountHost()
    message.info('before')
    view.cleanup()                     // Host unmounted → unbound
    expect(message.bound).toBe(false)
    expect(() => message.success('after')).toThrowError(/MessageHost/u)
  })

  it('calling when no Host was ever mounted → throws as well', () => {
    // The earlier cases in this file have cleaned up, so the bridge should be unbound here
    expect(message.bound).toBe(false)
    expect(() => message.info('nope')).toThrowError(/MessageHost/u)
  })

  it('works again after remounting', () => {
    const view = mountHost()
    expect(message.bound).toBe(true)
    message.success('again')
    expect(view.context.notifications.value).toHaveLength(1)
    view.cleanup()
  })

  it('a later-mounted Host takes over the binding (the earlier-unmounted one does not clear the bridge)', () => {
    const first = mountHost()
    const second = mountHost()
    expect(message.bound).toBe(true)
    // Unmount the first: the bridge should still point at the second
    first.cleanup()
    expect(message.bound, 'the earlier-unmounted Host cleared the bridge').toBe(true)
    message.info('goes-to-second')
    expect(second.context.notifications.value).toHaveLength(1)
    second.cleanup()
    expect(message.bound).toBe(false)
  })

  it('helper functions returning nodes are unaffected too (calling outside components is unrelated to rendering)', () => {
    const view = mountHost()
    const notifyFromHelper = (): string => message.warning('helper')
    expect(notifyFromHelper()).toBeTruthy()
    flush()
    expect(view.host.textContent).toContain('helper')
    view.cleanup()
  })

  it('type declarations are complete (returns a string id)', () => {
    const view = mountHost()
    const id: string = message.error('x')
    expect(id.startsWith('')).toBe(true)
    view.cleanup()
  })

  it('MessageHost is still a valid node (the component form was not broken)', () => {
    const view = mountHost()
    expect(view.host.querySelector('.vui-message-host')).not.toBeNull()
    view.cleanup()
  })
})

// Keep the type reference from being flagged as unused
void (null as unknown as VobsNode)
