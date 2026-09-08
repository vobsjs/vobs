import { beforeEach, describe, expect, it } from 'vitest'
import { createComponent, createDOMRenderer, createVobs, setRenderer } from '@vobs/vobs'
import { Drawer } from './drawer'
import { createDOMPortalAdapter, createFocusTrap, createOverlayManager } from './overlay'

describe('@vobs/ui overlay protocol', () => {
  beforeEach(() => {
    setRenderer(createDOMRenderer())
  })

  it('portal adapter mounts outside the component placeholder and cleans up on destroy', () => {
    const container = document.createElement('main')
    const portalTarget = document.createElement('aside')
    const app = createVobs({
      render: () => createComponent(Drawer, {
        open: true,
        title: 'Details',
        portal: createDOMPortalAdapter(),
        portalTarget,
        children: 'Portal body'
      })
    })
    app.mount(container)

    expect(container.querySelector('.vui-drawer')).toBeNull()
    expect(portalTarget.querySelector('.vui-drawer')?.textContent).toContain('Portal body')
    app.destroy()
    expect(portalTarget.querySelector('.vui-drawer')).toBeNull()
  })

  it('focus trap cycles Tab and restores the previously focused element', () => {
    const outside = document.createElement('button')
    const root = document.createElement('div')
    const first = document.createElement('button')
    const last = document.createElement('button')
    root.append(first, last)
    document.body.append(outside, root)
    outside.focus()

    const trap = createFocusTrap(root)
    trap.activate()
    expect(document.activeElement).toBe(first)
    last.focus()
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    expect(document.activeElement).toBe(first)
    trap.deactivate()
    expect(document.activeElement).toBe(outside)
    trap.dispose()
    root.remove()
    outside.remove()
  })

  it('overlay manager preserves stack order and notifies subscribers', () => {
    const manager = createOverlayManager()
    const snapshots: string[][] = []
    const stop = manager.subscribe(entries => snapshots.push(entries.map(entry => entry.id)))
    manager.open({ id: 'dialog', modal: true })
    manager.open({ id: 'menu' })
    manager.bringToFront('dialog')
    manager.close('menu')
    stop()

    expect(manager.entries.map(entry => entry.id)).toEqual(['dialog'])
    expect(snapshots).toEqual([[], ['dialog'], ['dialog', 'menu'], ['menu', 'dialog'], ['dialog']])
  })
})
