// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createDOMRenderer, createVobs, setRenderer, state } from '@vobs/vobs'
import { scheduler } from '@vobs/reactivity'
import { KitFilterBar, KitPageActions } from './index'

setRenderer(createDOMRenderer())
const settle = async (): Promise<void> => { scheduler.flush(); await null }

/*
 * Regression tests for two classes of problems in kit.
 *
 * 1. `role` silently swallowed: exactly isomorphic to ui's Alert/Switch/
 *     StatusBar — `role` wasn't in `bindCommonAttributes`' skip list, so the
 *     generic attribute channel first wrote the author's value, and an
 *     unconditional `setAttribute(root, 'role', …)` right after clobbered it.
 *     Verified: `KitFilterBar role="form"` yielded `search`;
 *     `KitPageActions role="toolbar"` yielded `group`.
 *
 * 2. Frozen labels: `readProp(props, 'searchLabel', 'Search')` was read
 *     **once** in the component body and handed to Button, after which signal
 *     changes left the button text unchanged (component bodies run once).
 *     Switching to functional children lets insertDynamic re-run it.
 */
interface Props extends Record<string, unknown> {}

async function mount(component: (props: Props) => unknown, props: Props) {
  const host = document.createElement('main')
  document.body.appendChild(host)
  const app = createVobs({
    renderer: createDOMRenderer(),
    render: () => component(props) as ReturnType<typeof KitFilterBar>
  })
  app.mount(host)
  await settle()
  return { host, cleanup: () => { app.destroy(); host.remove() } }
}

describe('kit role fallback and label reactivity', () => {
  it('KitFilterBar respects the author-passed role, falling back to search only when absent', async () => {
    const custom = await mount(KitFilterBar as never, { role: 'form' })
    expect(custom.host.querySelector('form')?.getAttribute('role')).toBe('form')
    custom.cleanup()

    const fallback = await mount(KitFilterBar as never, {})
    expect(fallback.host.querySelector('form')?.getAttribute('role')).toBe('search')
    fallback.cleanup()
  })

  it('KitPageActions respects the author-passed role, falling back to group only when absent', async () => {
    const custom = await mount(KitPageActions as never, { role: 'toolbar' })
    expect(custom.host.querySelector('.vobs-kit-page-actions')?.getAttribute('role')).toBe('toolbar')
    custom.cleanup()

    const fallback = await mount(KitPageActions as never, {})
    expect(fallback.host.querySelector('.vobs-kit-page-actions')?.getAttribute('role')).toBe('group')
    fallback.cleanup()
  })

  it('searchLabel follows the signal (it used to freeze after one read)', async () => {
    const label = state('Search')
    // Key: pass as a getter bag (what the compiler emits is a getter bag), not a signal object directly
    const props: Props = { get searchLabel() { return label.value } }
    const { host, cleanup } = await mount(KitFilterBar as never, props)
    expect(host.textContent).toContain('Search')

    label.value = 'Query'
    await settle()
    expect(host.textContent).toContain('Query')
    expect(host.textContent).not.toContain('Search')
    cleanup()
  })
})
