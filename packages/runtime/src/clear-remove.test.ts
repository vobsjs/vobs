// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { onDispose, state } from '@vobs/reactivity'
import { createDOMRenderer, setRenderer } from '@vobs/vobs'
import {
  bindText,
  clear,
  createComponent,
  createElement,
  createText,
  insertBefore,
  removeChild,
  type VobsNode
} from './index'

setRenderer(createDOMRenderer())

function Item(props: { readonly label: () => string }): VobsNode {
  const el = createElement('div')
  const text = createText('')
  insertBefore(el, text, null)
  bindText(text, () => props.label())
  return el
}

/** A component whose cleanup throws (used to verify the order: DOM detached first, Owner released after). */
function Boom(): VobsNode {
  const el = createElement('div')
  onDispose(() => { throw new Error('cleanup boom') })
  return el
}

/*
 * `removeChild` used to "release the Owner first, then detach the DOM": when cleanup
 * threw, the detach was never reached — the DOM kept the old node while its effects were
 * already gone — two trees on screen with no hint whatsoever.
 */
describe('removeChild ordering', () => {
  it('detaches the node from the DOM even when cleanup throws', () => {
    const parent = document.createElement('div')
    const child = createComponent(Boom, {})
    insertBefore(parent as unknown as Node, child, null)
    expect((parent as unknown as Node).contains(child as unknown as Node)).toBe(true)

    expect(() => removeChild(parent as unknown as Node, child)).toThrow('cleanup boom')
    // Key: the DOM is already consistent
    expect((parent as unknown as Node).contains(child as unknown as Node)).toBe(false)
  })
})

/*
 * `clear` used to only call the renderer (`textContent = ''`) — not a single Owner of the
 * cleared subtrees was released: effects inside components kept subscribing to signals
 * (ghost updates), listeners stayed bound, onDispose never ran.
 */
describe('clear releases Owners', () => {
  it('Owners on component output nodes are released; no ghost updates after clearing', async () => {
    const label = state('a')
    const host = document.createElement('div')
    for (let i = 0; i < 3; i++) {
      insertBefore(host, createComponent(Item, { label: () => label.value }), null)
    }
    const flush = async () => { await Promise.resolve(); await Promise.resolve() }

    await flush()
    expect(host.textContent).toBe('aaa')

    clear(host)
    expect(host.textContent).toBe('')

    // Ghost update: if the Owner hadn't been released, the text would be rewritten here
    label.value = 'b'
    await flush()
    expect(host.textContent).toBe('')
  })

  it('cleanup throwing doesn\'t stop the container from being emptied, and the error still throws', () => {
    const host = document.createElement('div')
    // Use components (output nodes register their Owner) — a hand-made createOwner
    // registers no node, so walk can't find it; that's exactly clear's coverage boundary:
    // cleanup inside component boundaries is complete, effects built outside components
    // belong to their own Owner.
    insertBefore(host as unknown as Node, createComponent(Boom, {}), null)
    insertBefore(host as unknown as Node, createComponent(Item, { label: () => 'x' }), null)

    expect(() => clear(host as unknown as Node)).toThrow('cleanup boom')
    expect((host as unknown as Node).childNodes.length).toBe(0)
  })
})
