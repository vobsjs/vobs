import { beforeEach, describe, expect, it } from 'vitest'
import { state } from '@vobs/reactivity'
import {
  createComponent,
  createDOMRenderer,
  createElement,
  createVobs,
  insertBefore,
  setRenderer
} from '@vobs/vobs'
import { ActivityRail } from './activity-rail'
import { ChatComposer } from './chat-composer'
import { EditorTabs } from './editor-tabs'
import { FileTree } from './file-tree'
import { StatusBar } from './status-bar'
import { WorkbenchTitlebar } from './workbench-titlebar'

describe('@vobs/ui third batch', () => {
  beforeEach(() => {
    setRenderer(createDOMRenderer())
  })

  it('ActivityRail keeps selection controlled and preserves spacer/divider structure', () => {
    const active = state('files')
    const container = document.createElement('main')
    const app = createVobs({
      render: () => createComponent(ActivityRail, {
        items: [
          { id: 'files', label: 'Files' },
          { id: 'search', label: 'Search' },
          { divider: true },
          { spacer: true },
          { id: 'settings', label: 'Settings' }
        ],
        get value() { return active.value },
        onChange: id => { active.value = id }
      })
    })
    app.mount(container)

    expect(container.querySelectorAll('.vui-activityrail__btn').length).toBe(3)
    expect(container.querySelector('.vui-activityrail__divider')).toBeTruthy()
    expect(container.querySelector('.vui-activityrail__spacer')).toBeTruthy()
    ;(container.querySelector('[aria-label="Settings"]') as HTMLElement).click()
    app.update()
    expect(active.value).toBe('settings')
    expect(container.querySelector('[aria-label="Settings"]')?.classList.contains('is-active')).toBe(true)
    app.destroy()
  })

  it('FileTree expands folders, selects rows and emits toggle state', () => {
    const toggles: Array<[string, boolean]> = []
    const selected: string[] = []
    const container = document.createElement('main')
    const app = createVobs({
      render: () => createComponent(FileTree, {
        items: [{
          id: 'src',
          label: 'src',
          kind: 'folder',
          children: [{ id: 'main', label: 'main.ts', kind: 'file' }]
        }],
        onToggle: (id, expanded) => toggles.push([id, expanded]),
        onSelect: id => selected.push(id)
      })
    })
    app.mount(container)

    expect(container.querySelector('[data-file-id="main"]')).toBeNull()
    ;(container.querySelector('[data-file-id="src"]') as HTMLElement).click()
    app.update()
    expect(container.querySelector('[data-file-id="main"]')).toBeTruthy()
    expect(toggles).toEqual([['src', true]])
    expect(selected).toEqual(['src'])
    app.destroy()
  })

  it('EditorTabs supports active selection, close callbacks and arrow navigation', () => {
    const active = state('one')
    const closed: string[] = []
    const container = document.createElement('main')
    const app = createVobs({
      render: () => createComponent(EditorTabs, {
        tabs: [
          { id: 'one', label: 'one.ts', closeable: true },
          { id: 'two', label: 'two.ts' }
        ],
        get value() { return active.value },
        onChange: id => { active.value = id },
        onClose: id => closed.push(id)
      })
    })
    app.mount(container)

    const first = container.querySelector('[data-editor-tab-id="one"]') as HTMLElement
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    app.update()
    expect(active.value).toBe('two')
    ;(container.querySelector('.close') as HTMLElement).click()
    expect(closed).toEqual(['one'])
    app.destroy()
  })

  it('WorkbenchTitlebar, StatusBar and ChatComposer expose named native controls', () => {
    const sent: string[] = []
    const container = document.createElement('main')
    const app = createVobs({
      render: () => {
        const root = createElement('div')
        insertBefore(root, createComponent(WorkbenchTitlebar, {
          mode: 'Agent',
          project: 'vobs',
          onProjectClick: () => undefined
        }), null)
        insertBefore(root, createComponent(StatusBar, {
          left: [{ id: 'sync', label: 'Synced', dot: 'success' }],
          onItemClick: () => undefined
        }), null)
        insertBefore(root, createComponent(ChatComposer, {
          value: 'hello',
          onSend: value => sent.push(value)
        }), null)
        return root
      }
    })
    app.mount(container)

    expect(container.querySelector('.vui-wbtitlebar__mode-chip')?.textContent).toBe('Agent')
    expect(container.querySelector('.vui-wbtitlebar__project-selector')?.textContent).toBe('vobs')
    expect(container.querySelector('.vui-wbtitlebar__light')?.hasAttribute('style')).toBe(false)
    expect(container.querySelector('.vui-statusbar__dot--success')).toBeTruthy()
    expect((container.querySelector('.vui-composer__input') as HTMLTextAreaElement).value).toBe('hello')
    ;(container.querySelector('.vui-composer__send') as HTMLButtonElement).click()
    expect(sent).toEqual(['hello'])
    app.destroy()
  })
})
