import { afterEach, describe, expect, it } from 'vitest'
import { defineDshOverlay, defineDshPanel, resetDshReact } from './index.js'
import {
  installLoaderShim,
  previewReact,
  readLoaderRegistry,
  startPreview,
  type PreviewFactory
} from './preview.js'

const containers: HTMLElement[] = []

function makeContainer(): HTMLElement {
  const node = document.createElement('div')
  document.body.appendChild(node)
  containers.push(node)
  return node
}

/** Wraps a plugin object into a bundle factory (the layer dshBundle produces). */
function factoryOf(plugin: unknown): PreviewFactory {
  return () => plugin
}

afterEach(() => {
  for (const node of containers.splice(0)) node.remove()
  delete (globalThis as Record<string, unknown>).__ModuleLoader__
  delete (globalThis as Record<string, unknown>).__VOBS_DSH_PREVIEW__
  resetDshReact()
})

/* ------------------------------------------------------------ Loader shim */

describe('installLoaderShim', () => {
  it('captures factories registered by bundles', () => {
    const factories = installLoaderShim()
    const loader = (globalThis as Record<string, unknown>).__ModuleLoader__ as {
      load(entry: { id: string; factory: PreviewFactory }): void
    }
    const factory = factoryOf({})
    loader.load({ id: 'my-plugin', factory })
    expect(factories.get('my-plugin')).toBe(factory)
  })

  it('is idempotent: reinstalling does not lose registered factories', () => {
    const first = installLoaderShim()
    const factory = factoryOf({})
    first.set('a', factory)
    const second = installLoaderShim()
    expect(second).toBe(first)
    expect(second.get('a')).toBe(factory)
  })

  it('ignores malformed registrations', () => {
    const factories = installLoaderShim()
    const loader = (globalThis as Record<string, unknown>).__ModuleLoader__ as {
      load(entry: unknown): void
    }
    loader.load({ id: 42 })
    loader.load(null)
    expect(factories.size).toBe(0)
  })

  it('readLoaderRegistry returns an empty registry when the shim is not installed', () => {
    expect(readLoaderRegistry().size).toBe(0)
  })
})

/* -------------------------------------------------------------- Mini React */

describe('previewReact', () => {
  it('createElement produces a renderable vnode', () => {
    const vnode = previewReact.createElement('div', { id: 'x' }, 'hello')
    expect(vnode.type).toBe('div')
    expect(vnode.children).toEqual(['hello'])
  })

  it('useRef/useEffect throw clearly when called outside rendering', () => {
    expect(() => previewReact.useRef(null)).toThrow(/during component rendering/u)
    expect(() => previewReact.useEffect(() => undefined)).toThrow(/during component rendering/u)
  })
})

/* ---------------------------------------------------------------- Preview shell */

describe('startPreview', () => {
  it('shows an actionable hint instead of a blank screen when no factory was captured', () => {
    const container = makeContainer()
    const handle = startPreview({ container, packageName: 'nope' })
    expect(container.textContent).toContain('No factory captured')
    expect(handle.slots).toEqual([])
  })

  it('renders overlay plugins into the overlay layer', () => {
    installLoaderShim().set(
      'demo-plugin',
      factoryOf(
        defineDshOverlay({ id: 'demo', styles: '.panel{}' }, () => {
          const node = document.createElement('div')
          node.className = 'panel'
          node.textContent = 'hello'
          return node
        })
      )
    )

    const container = makeContainer()
    const handle = startPreview({ container, packageName: 'demo-plugin' })

    expect(handle.slots).toEqual(['shell.overlay'])
    // The adapter mounts vobs content into the host element's shadow root, invisible to light DOM — the assertion must pierce it.
    const host = container.querySelector('.pv__overlay .pv__slot > div')
    expect(host?.shadowRoot?.querySelector('.panel')?.textContent).toBe('hello')
    expect(container.textContent).toContain('slots: shell.overlay')
  })

  it('renders full-page panels into the main area and sidebar entries into the left rail', () => {
    installLoaderShim().set(
      'panel-plugin',
      factoryOf(
        defineDshPanel(
          {
            key: 'console',
            label: 'Console',
            sidebarEntry: {
              label: 'Console',
              renderIcon: () => {
                const icon = document.createElement('i')
                icon.className = 'icon'
                return icon
              }
            }
          },
          () => {
            const page = document.createElement('section')
            page.className = 'page'
            page.textContent = 'console'
            return page
          }
        )
      )
    )

    const container = makeContainer()
    const handle = startPreview({ container, packageName: 'panel-plugin' })

    expect(handle.slots).toEqual(['main', 'sidebar.panellist'])
    const mainHost = container.querySelector('.pv__main .pv__slot > div')
    const railHost = container.querySelector('.pv__rail .pv__slot > div')
    expect(mainHost?.shadowRoot?.querySelector('.page')?.textContent).toBe('console')
    expect(railHost?.shadowRoot?.querySelector('.icon')).not.toBeNull()
  })

  it('displays the error when a plugin apply throws', () => {
    installLoaderShim().set(
      'broken',
      factoryOf({
        inject: [],
        apply() {
          throw new Error('boom')
        }
      })
    )
    const container = makeContainer()
    startPreview({ container, packageName: 'broken' })
    expect(container.textContent).toContain('boom')
  })

  it('states clearly when no slot was registered', () => {
    installLoaderShim().set('silent', factoryOf({ inject: [], apply() {} }))
    const container = makeContainer()
    startPreview({ container, packageName: 'silent' })
    expect(container.textContent).toContain('no slot registered')
  })

  it('errors instead of failing silently when an unprovided module is required', () => {
    installLoaderShim().set(
      'needs-lodash',
      ((require: (id: string) => unknown) => {
        require('lodash')
        return { inject: [], apply() {} }
      }) as PreviewFactory
    )
    const container = makeContainer()
    startPreview({ container, packageName: 'needs-lodash' })
    expect(container.textContent).toContain('unprovided module lodash')
  })

  it('auto-selects when exactly one factory is registered and no package name is given', () => {
    installLoaderShim().set(
      'only-one',
      factoryOf(
        defineDshOverlay({}, () => {
          const node = document.createElement('div')
          node.textContent = 'only'
          return node
        })
      )
    )
    const container = makeContainer()
    const handle = startPreview({ container })
    expect(handle.id).toBe('only-one')
    expect(container.textContent).toContain('only')
  })

  it('destroy runs cleanups and empties the shell', () => {
    const disposed: string[] = []
    installLoaderShim().set(
      'clean-me',
      factoryOf(
        defineDshOverlay(
          {
            setup() {
              return () => {
                disposed.push('disposed')
              }
            }
          },
          () => document.createElement('div')
        )
      )
    )
    const container = makeContainer()
    const handle = startPreview({ container, packageName: 'clean-me' })
    expect(container.textContent).toContain('vobs')
    handle.destroy()
    expect(disposed).toEqual(['disposed'])
    expect(container.textContent).toBe('')
  })

  it('the host component really creates a shadow root and renders vobs content into it', () => {
    installLoaderShim().set(
      'shadow-plugin',
      factoryOf(
        defineDshOverlay({ styles: '.inside{color:red}' }, () => {
          const node = document.createElement('div')
          node.className = 'inside'
          node.textContent = 'in-shadow'
          return node
        })
      )
    )
    const container = makeContainer()
    startPreview({ container, packageName: 'shadow-plugin' })

    const host = container.querySelector('.pv__overlay > .pv__slot > div')
    expect(host?.shadowRoot).not.toBeNull()
    expect(host?.shadowRoot?.querySelector('style')?.textContent).toBe('.inside{color:red}')
    expect(host?.shadowRoot?.querySelector('.vobs-dsh-root .inside')?.textContent).toBe('in-shadow')
  })
})
