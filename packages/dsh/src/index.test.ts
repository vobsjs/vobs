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

/* ------------------------------------------------------------------ Test doubles */

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

/** "Commit" the slot host component as React would: assign the ref, run the effects. */
function commitHost(
  component: unknown,
  effects: Array<() => void | (() => void)>
): { host: HTMLElement; cleanups: Array<() => void> } {
  const node = (component as () => { props?: { ref?: { current: HTMLElement | null } } })()
  const host = document.createElement('div')
  document.body.appendChild(host)
  const ref = node?.props?.ref
  if (ref === undefined || ref === null) throw new Error('host component did not provide a ref')
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

/* ---------------------------------------------------------------- React binding */

describe('React binding', () => {
  it('throws an actionable error when no binding exists', () => {
    expect(() => resolveDshReact()).toThrow(/cannot obtain the React provided by the DSH platform/u)
    expect(() => resolveDshReact()).toThrow(/useDshReact/u)
  })

  it('works after manual injection via useDshReact', () => {
    const stub = createReactStub()
    useDshReact(stub.react)
    expect(resolveDshReact()).toBe(stub.react)
  })

  it('falls back to the build-time injection on globalThis', () => {
    const stub = createReactStub()
    ;(globalThis as Record<string, unknown>)[DSH_REACT_GLOBAL] = stub.react
    expect(resolveDshReact()).toBe(stub.react)
  })

  it('manual injection takes precedence over the global key', () => {
    const manual = createReactStub().react
    const fromGlobal = createReactStub().react
    ;(globalThis as Record<string, unknown>)[DSH_REACT_GLOBAL] = fromGlobal
    useDshReact(manual)
    expect(resolveDshReact()).toBe(manual)
  })
})

/* ------------------------------------------------------------ slot host component */

describe('createVobsSlotHost', () => {
  it('opens a shadow root on the host element, renders vobs into it, and empties it on cleanup', () => {
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

  it('stylesheet sits next to the vobs root; mounting does not clear it away', () => {
    const stub = createReactStub()
    useDshReact(stub.react)
    const host = createVobsSlotHost(() => document.createElement('span'), { styles: 'span{color:blue}' })
    const { host: element } = commitHost(host, stub.effects)

    const children = [...(element.shadowRoot?.childNodes ?? [])]
    expect(children.length).toBe(2)
    expect(children[0]?.nodeName).toBe('STYLE')
    expect(children[1]?.nodeName).toBe('DIV')
  })

  it('lets you resolve the color scheme yourself', () => {
    const stub = createReactStub()
    useDshReact(stub.react)
    const host = createVobsSlotHost(() => document.createElement('span'), { scheme: () => 'dark' })
    const { host: element } = commitHost(host, stub.effects)
    expect(element.shadowRoot?.querySelector(`.${DSH_ROOT_CLASS}`)?.getAttribute('data-scheme')).toBe('dark')
  })
})

/* -------------------------------------------------------------- Plugin registration */

describe('defineDshPlugin', () => {
  it('injects slots by default and merges/dedupes custom injections', () => {
    const plugin = defineDshPlugin({ inject: ['slots', 'connection', 'locale'], setup: () => {} })
    expect(plugin.inject).toEqual(['slots', 'connection', 'locale'])
  })

  it('hooks the setup return value into the cordis effect', () => {
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

    // cordis's effect: the callback's return value is the cleanup run on destroy.
    const cleanup = fake.effects[0]?.()
    expect(typeof cleanup).toBe('function')
    expect(disposed.length).toBe(0)
    ;(cleanup as () => void)()
    expect(disposed).toEqual(['disposed'])
  })

  it('registers no effect when setup returns no cleanup', () => {
    const fake = createFakeContext()
    defineDshPlugin({ setup: () => {} }).apply(fake.ctx)
    expect(fake.effects.length).toBe(0)
  })
})

describe('defineDshOverlay', () => {
  it('registers into shell.overlay with default id and order', () => {
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

  it('respects explicit id / order / locale / label and keeps appearance options out of the registration', () => {
    const fake = createFakeContext()
    defineDshOverlay(
      { id: 'probe', order: 7, locale: 'ns', label: 'Probe', styles: 'x{}', hostStyle: { top: 0 } },
      () => document.createElement('div')
    ).apply(fake.ctx)

    const options = fake.registered[0]?.options as DshSlotRegistration
    expect(options).toMatchObject({ name: 'shell.overlay', id: 'probe', order: 7, locale: 'ns', label: 'Probe' })
    expect(options.styles).toBeUndefined()
    expect(options.hostStyle).toBeUndefined()
  })
})

describe('defineDshPanel', () => {
  it('registers main (keyed) and the sidebar.panellist entry together', () => {
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

  it('registers only main when there is no sidebarEntry', () => {
    const fake = createFakeContext()
    defineDshPanel({ key: 'solo' }, () => document.createElement('section')).apply(fake.ctx)
    expect(fake.injectedSlots).toEqual(['main'])
    expect(fake.registered.length).toBe(1)
  })

  it('returns a usable DshClientPlugin', () => {
    const plugin: DshClientPlugin = defineDshPanel({ key: 'k' }, () => document.createElement('section'))
    expect(plugin.inject).toContain('slots')
    expect(typeof plugin.apply).toBe('function')
  })

  it('setup receives ctx before registration happens', () => {
    const fake = createFakeContext()
    const seen: string[] = []
    defineDshPanel(
      {
        key: 'k',
        setup(ctx) {
          seen.push(ctx.slots === fake.ctx.slots ? 'same-ctx' : 'other-ctx')
          // registration has not happened yet when setup runs
          seen.push(`registered=${fake.registered.length}`)
        }
      },
      () => document.createElement('section')
    ).apply(fake.ctx)

    expect(seen).toEqual(['same-ctx', 'registered=0'])
    expect(fake.registered.length).toBe(1)
  })

  it('overlays support setup too', () => {
    const fake = createFakeContext()
    let called = 0
    defineDshOverlay({ setup: () => { called += 1 } }, () => document.createElement('div')).apply(fake.ctx)
    expect(called).toBe(1)
  })
})
