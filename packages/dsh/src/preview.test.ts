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

/** 把插件对象包成 bundle factory（等价于 dshBundle 产出的那一层）。 */
function factoryOf(plugin: unknown): PreviewFactory {
  return () => plugin
}

afterEach(() => {
  for (const node of containers.splice(0)) node.remove()
  delete (globalThis as Record<string, unknown>).__ModuleLoader__
  delete (globalThis as Record<string, unknown>).__VOBS_DSH_PREVIEW__
  resetDshReact()
})

/* ------------------------------------------------------------ 加载器垫片 */

describe('installLoaderShim', () => {
  it('捕获 bundle 注册的 factory', () => {
    const factories = installLoaderShim()
    const loader = (globalThis as Record<string, unknown>).__ModuleLoader__ as {
      load(entry: { id: string; factory: PreviewFactory }): void
    }
    const factory = factoryOf({})
    loader.load({ id: 'my-plugin', factory })
    expect(factories.get('my-plugin')).toBe(factory)
  })

  it('幂等：重复安装不会丢掉已注册的 factory', () => {
    const first = installLoaderShim()
    const factory = factoryOf({})
    first.set('a', factory)
    const second = installLoaderShim()
    expect(second).toBe(first)
    expect(second.get('a')).toBe(factory)
  })

  it('忽略畸形的注册项', () => {
    const factories = installLoaderShim()
    const loader = (globalThis as Record<string, unknown>).__ModuleLoader__ as {
      load(entry: unknown): void
    }
    loader.load({ id: 42 })
    loader.load(null)
    expect(factories.size).toBe(0)
  })

  it('readLoaderRegistry 在没装垫片时返回空表', () => {
    expect(readLoaderRegistry().size).toBe(0)
  })
})

/* -------------------------------------------------------------- 迷你 React */

describe('previewReact', () => {
  it('createElement 产出可渲染的 vnode', () => {
    const vnode = previewReact.createElement('div', { id: 'x' }, 'hello')
    expect(vnode.type).toBe('div')
    expect(vnode.children).toEqual(['hello'])
  })

  it('useRef 在渲染上下文之外调用会明确报错', () => {
    expect(() => previewReact.useRef(null)).toThrow(/渲染期间/u)
    expect(() => previewReact.useEffect(() => undefined)).toThrow(/渲染期间/u)
  })
})

/* ---------------------------------------------------------------- 预览外壳 */

describe('startPreview', () => {
  it('没有捕获到 factory 时给出可操作的提示，而不是白屏', () => {
    const container = makeContainer()
    const handle = startPreview({ container, packageName: 'nope' })
    expect(container.textContent).toContain('没有捕获到任何 factory')
    expect(handle.slots).toEqual([])
  })

  it('浮层插件渲染进 overlay 层', () => {
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
    // 适配层把 vobs 内容挂在宿主元素的 shadow root 里，light DOM 查不到 —— 断言要穿透。
    const host = container.querySelector('.pv__overlay .pv__slot > div')
    expect(host?.shadowRoot?.querySelector('.panel')?.textContent).toBe('hello')
    expect(container.textContent).toContain('slots: shell.overlay')
  })

  it('整页面板渲染进主区域，侧栏入口渲染进左轨道', () => {
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

  it('插件 apply 抛错时把错误显示出来', () => {
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

  it('没有注册任何 slot 时明确提示', () => {
    installLoaderShim().set('silent', factoryOf({ inject: [], apply() {} }))
    const container = makeContainer()
    startPreview({ container, packageName: 'silent' })
    expect(container.textContent).toContain('没有注册任何 slot')
  })

  it('要求未提供的模块时报错而不是静默失败', () => {
    installLoaderShim().set(
      'needs-lodash',
      ((require: (id: string) => unknown) => {
        require('lodash')
        return { inject: [], apply() {} }
      }) as PreviewFactory
    )
    const container = makeContainer()
    startPreview({ container, packageName: 'needs-lodash' })
    expect(container.textContent).toContain('未提供的模块 lodash')
  })

  it('只注册一个 factory 且未指定包名时自动选中', () => {
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

  it('destroy 跑清理函数并清空外壳', () => {
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

  it('宿主组件的 shadow root 真的建起来并渲染了 vobs 内容', () => {
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
