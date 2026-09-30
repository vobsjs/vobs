import { afterEach, describe, expect, it } from 'vitest'
import {
  createVobsSlotHost,
  defineDshOverlay,
  defineDshPanel,
  defineDshPlugin,
  DSH_REACT_GLOBAL,
  DSH_ROOT_CLASS,
  resetDshReact,
  resolveDshReact,
  useDshReact,
  type DshClientContext,
  type DshClientPlugin,
  type DshReact,
  type DshSlotRegistration
} from './index.js'

/* ------------------------------------------------------------------ 测试替身 */

function createReactStub(): { react: DshReact; effects: Array<() => void | (() => void)> } {
  const effects: Array<() => void | (() => void)> = []
  return {
    effects,
    react: {
      createElement: (type, props) => ({ type, props }),
      useRef: <T,>(initial: T | null) => ({ current: initial }),
      useEffect: effect => {
        effects.push(effect)
      }
    }
  }
}

interface FakeContext {
  ctx: DshClientContext
  registered: Array<{ options: DshSlotRegistration; component: unknown }>
  injectedSlots: string[]
  effects: Array<() => void | (() => void)>
}

function createFakeContext(): FakeContext {
  const registered: Array<{ options: DshSlotRegistration; component: unknown }> = []
  const injectedSlots: string[] = []
  const effects: Array<() => void | (() => void)> = []
  return {
    registered,
    injectedSlots,
    effects,
    ctx: {
      slots: {
        inject(name, callback) {
          injectedSlots.push(name)
          callback()
        },
        register(options, component) {
          registered.push({ options, component })
          return () => {}
        }
      },
      effect(callback) {
        effects.push(callback)
      }
    }
  }
}

/** 把 slot 宿主组件当成 React 来"提交"：赋 ref、跑 effect。 */
function commitHost(
  component: unknown,
  effects: Array<() => void | (() => void)>
): { host: HTMLElement; cleanups: Array<() => void> } {
  const node = (component as () => { props?: { ref?: { current: HTMLElement | null } } })()
  const host = document.createElement('div')
  document.body.appendChild(host)
  const ref = node?.props?.ref
  if (ref === undefined || ref === null) throw new Error('宿主组件没有传 ref')
  ref.current = host

  const cleanups: Array<() => void> = []
  for (const effect of effects) {
    const cleanup = effect()
    if (typeof cleanup === 'function') cleanups.push(cleanup)
  }
  return { host, cleanups }
}

afterEach(() => {
  resetDshReact()
  delete (globalThis as Record<string, unknown>)[DSH_REACT_GLOBAL]
  document.body.innerHTML = ''
})

/* ---------------------------------------------------------------- React 绑定 */

describe('React 绑定', () => {
  it('没有任何绑定时抛出可操作的错误', () => {
    expect(() => resolveDshReact()).toThrow(/拿不到 DSH 平台提供的 React/u)
    expect(() => resolveDshReact()).toThrow(/useDshReact/u)
  })

  it('useDshReact 手动注入后可用', () => {
    const stub = createReactStub()
    useDshReact(stub.react)
    expect(resolveDshReact()).toBe(stub.react)
  })

  it('回退到 globalThis 上的构建期注入', () => {
    const stub = createReactStub()
    ;(globalThis as Record<string, unknown>)[DSH_REACT_GLOBAL] = stub.react
    expect(resolveDshReact()).toBe(stub.react)
  })

  it('手动注入优先于全局键', () => {
    const manual = createReactStub().react
    const fromGlobal = createReactStub().react
    ;(globalThis as Record<string, unknown>)[DSH_REACT_GLOBAL] = fromGlobal
    useDshReact(manual)
    expect(resolveDshReact()).toBe(manual)
  })
})

/* ------------------------------------------------------------ slot 宿主组件 */

describe('createVobsSlotHost', () => {
  it('在宿主元素上开 shadow root，把 vobs 渲染进去，并在清理时清空', () => {
    const stub = createReactStub()
    useDshReact(stub.react)

    const host = createVobsSlotHost(() => {
      const el = document.createElement('div')
      el.className = 'probe'
      el.textContent = 'vobs-ok'
      return el
    }, { styles: '.probe{color:red}' })

    const { host: element, cleanups } = commitHost(host, stub.effects)
    const shadow = element.shadowRoot

    expect(shadow).not.toBeNull()
    expect(shadow?.querySelector('style')?.textContent).toBe('.probe{color:red}')
    expect(shadow?.querySelector(`.${DSH_ROOT_CLASS}`)).not.toBeNull()
    expect(shadow?.querySelector('.probe')?.textContent).toBe('vobs-ok')
    expect(['light', 'dark']).toContain(shadow?.querySelector(`.${DSH_ROOT_CLASS}`)?.getAttribute('data-scheme'))

    for (const cleanup of cleanups) cleanup()
    expect(element.shadowRoot?.childNodes.length).toBe(0)
  })

  it('样式表与 vobs 根平级，挂载时不会把样式一起清掉', () => {
    const stub = createReactStub()
    useDshReact(stub.react)
    const host = createVobsSlotHost(() => document.createElement('span'), { styles: 'span{color:blue}' })
    const { host: element } = commitHost(host, stub.effects)

    const children = [...(element.shadowRoot?.childNodes ?? [])]
    expect(children.length).toBe(2)
    expect(children[0]?.nodeName).toBe('STYLE')
    expect(children[1]?.nodeName).toBe('DIV')
  })

  it('可以按自身需要解析配色', () => {
    const stub = createReactStub()
    useDshReact(stub.react)
    const host = createVobsSlotHost(() => document.createElement('span'), { scheme: () => 'dark' })
    const { host: element } = commitHost(host, stub.effects)
    expect(element.shadowRoot?.querySelector(`.${DSH_ROOT_CLASS}`)?.getAttribute('data-scheme')).toBe('dark')
  })
})

/* -------------------------------------------------------------- 插件注册器 */

describe('defineDshPlugin', () => {
  it('默认注入 slots，并与自定义注入合并去重', () => {
    const plugin = defineDshPlugin({ inject: ['slots', 'connection', 'locale'], setup: () => {} })
    expect(plugin.inject).toEqual(['slots', 'connection', 'locale'])
  })

  it('把 setup 的返回值接到 cordis effect 上', () => {
    const disposed: string[] = []
    const plugin = defineDshPlugin({
      setup() {
        return () => {
          disposed.push('disposed')
        }
      }
    })
    const fake = createFakeContext()
    plugin.apply(fake.ctx)

    expect(fake.effects.length).toBe(1)
    expect(disposed.length).toBe(0)

    // cordis 的 effect：回调的返回值就是销毁时要执行的清理函数。
    const cleanup = fake.effects[0]?.()
    expect(typeof cleanup).toBe('function')
    expect(disposed.length).toBe(0)
    ;(cleanup as () => void)()
    expect(disposed).toEqual(['disposed'])
  })

  it('setup 不返回清理函数时不产生 effect', () => {
    const fake = createFakeContext()
    defineDshPlugin({ setup: () => {} }).apply(fake.ctx)
    expect(fake.effects.length).toBe(0)
  })
})

describe('defineDshOverlay', () => {
  it('注册进 shell.overlay，带默认 id 与 order', () => {
    const fake = createFakeContext()
    defineDshOverlay({}, () => document.createElement('div')).apply(fake.ctx)

    expect(fake.injectedSlots).toEqual(['shell.overlay'])
    expect(fake.registered[0]?.options).toMatchObject({
      name: 'shell.overlay',
      id: 'vobs-overlay',
      order: 100
    })
    expect(typeof fake.registered[0]?.component).toBe('function')
  })

  it('尊重显式的 id / order / locale / label，且不把外观选项混进注册对象', () => {
    const fake = createFakeContext()
    defineDshOverlay(
      { id: 'probe', order: 7, locale: 'ns', label: '探针', styles: 'x{}', hostStyle: { top: 0 } },
      () => document.createElement('div')
    ).apply(fake.ctx)

    const options = fake.registered[0]?.options as DshSlotRegistration
    expect(options).toMatchObject({ name: 'shell.overlay', id: 'probe', order: 7, locale: 'ns', label: '探针' })
    expect(options.styles).toBeUndefined()
    expect(options.hostStyle).toBeUndefined()
  })
})

describe('defineDshPanel', () => {
  it('注册 main（keyed）并同时注册 sidebar.panellist 入口', () => {
    const fake = createFakeContext()
    defineDshPanel(
      {
        key: 'vobs-console',
        label: 'Vobs Console',
        sidebarEntry: { label: 'Console', renderIcon: () => document.createElement('i') }
      },
      () => document.createElement('section')
    ).apply(fake.ctx)

    expect(fake.injectedSlots).toEqual(['main', 'sidebar.panellist'])
    expect(fake.registered[0]?.options).toMatchObject({ name: 'main', key: 'vobs-console', label: 'Vobs Console' })
    expect(fake.registered[1]?.options).toMatchObject({
      name: 'sidebar.panellist',
      id: 'vobs-console',
      label: 'Console'
    })
    expect(fake.registered[1]?.options.key).toBeUndefined()
  })

  it('没有 sidebarEntry 时只注册 main', () => {
    const fake = createFakeContext()
    defineDshPanel({ key: 'solo' }, () => document.createElement('section')).apply(fake.ctx)
    expect(fake.injectedSlots).toEqual(['main'])
    expect(fake.registered.length).toBe(1)
  })

  it('返回的插件是可用的 DshClientPlugin', () => {
    const plugin: DshClientPlugin = defineDshPanel({ key: 'k' }, () => document.createElement('section'))
    expect(plugin.inject).toContain('slots')
    expect(typeof plugin.apply).toBe('function')
  })

  it('setup 在注册之前拿到 ctx', () => {
    const fake = createFakeContext()
    const seen: string[] = []
    defineDshPanel(
      {
        key: 'k',
        setup(ctx) {
          seen.push(ctx.slots === fake.ctx.slots ? 'same-ctx' : 'other-ctx')
          // setup 执行时注册还没发生
          seen.push(`registered=${fake.registered.length}`)
        }
      },
      () => document.createElement('section')
    ).apply(fake.ctx)

    expect(seen).toEqual(['same-ctx', 'registered=0'])
    expect(fake.registered.length).toBe(1)
  })

  it('浮层同样支持 setup', () => {
    const fake = createFakeContext()
    let called = 0
    defineDshOverlay({ setup: () => { called += 1 } }, () => document.createElement('div')).apply(fake.ctx)
    expect(called).toBe(1)
  })
})
