import { describe, it, expect, beforeEach, vi } from 'vitest'
import { effect } from '@vobs/reactivity'
import {
  createDOMRenderer,
  createComponent,
  createInjectionKey,
  createElement,
  createText,
  createVobs,
  inject,
  injectRequired,
  provide,
  setRenderer,
  addEventListener,
  type VobsLocatedError,
  type VobsPlugin
} from './index'

describe('createVobs', () => {
  beforeEach(() => {
    setRenderer(createDOMRenderer())
  })

  it('throws when render is missing', () => {
    expect(() => createVobs({} as any)).toThrow()
  })

  it('supports an application-level error observer without overriding the original exception', () => {
    const errors: unknown[] = []
    const app = createVobs({
      render: () => { throw new Error('render failed') },
      onError: error => errors.push(error)
    })
    expect(() => app.mount(document.createElement('div'))).toThrow('render failed')
    expect(errors[0]).toBeInstanceOf(Error)
    expect((errors[0] as Error).message).toBe('render failed')
  })

  it('mounted is true after mount', () => {
    const app = createVobs({
      render: () => {
        return createText('hello')
      }
    })

    const container = document.createElement('div')
    app.mount(container)

    expect(app.mounted).toBe(true)
    expect(container.textContent).toBe('hello')

    app.destroy()
    expect(app.mounted).toBe(false)
    expect(container.innerHTML).toBe('')
  })

  it('installs plugins in dependency order and cleans up in reverse', () => {
    const calls: string[] = []
    const dependency = {
      name: 'dependency',
      install: () => {
        calls.push('install-dependency')
        return () => calls.push('cleanup-dependency')
      }
    }
    const plugin: VobsPlugin = {
      name: 'plugin',
      requires: [dependency],
      install: () => {
        calls.push('install-plugin')
        return () => calls.push('cleanup-plugin')
      }
    }

    const app = createVobs({ render: () => createText(''), plugins: [plugin] })
    app.destroy()

    expect(calls).toEqual([
      'install-dependency',
      'install-plugin',
      'cleanup-plugin',
      'cleanup-dependency'
    ])
  })

  it('injections cannot be silently overridden by default', () => {
    const key = createInjectionKey<string>('test.value')
    const plugin: VobsPlugin = {
      name: 'context',
      install: context => {
        context.provide(key, 'first')
        expect(() => context.provide(key, 'second')).toThrow('already exists')
        context.provide(key, 'second', { override: true })
        expect(context.inject(key)).toBe('second')
      }
    }

    createVobs({ render: () => createText(''), plugins: [plugin] }).destroy()
  })

  it('plugins can access the app, register destroy callbacks, and declare optional dependencies', () => {
    const calls: string[] = []
    let contextApp: ReturnType<typeof createVobs> | undefined
    const optional: VobsPlugin = {
      name: 'optional',
      install: () => { calls.push('optional-install') }
    }
    const plugin: VobsPlugin = {
      name: 'lifecycle',
      version: '0.1.0',
      optional: [optional],
      install(context) {
        contextApp = context.app
        context.onDestroy(() => { calls.push('on-destroy') })
        return () => { calls.push('cleanup') }
      }
    }

    const app = createVobs({ render: () => createText(''), plugins: [plugin] })
    expect(contextApp).toBe(app)
    expect(calls).toEqual([])

    app.destroy()
    expect(calls).toEqual(['cleanup', 'on-destroy'])
  })

  it('component provide/inject resolves through the Owner hierarchy and can override parent values', () => {
    const key = createInjectionKey<string>('test.component-context')
    let injected: string | undefined
    let nestedInjected: string | undefined

    function Child(): ReturnType<typeof createText> {
      injected = inject(key)
      provide(key, 'child')
      nestedInjected = inject(key)
      return createText('child')
    }

    function Parent(): ReturnType<typeof createText> {
      provide(key, 'parent')
      return createComponent(Child, {}) as ReturnType<typeof createText>
    }

    const app = createVobs({ render: () => createComponent(Parent, {}) })
    app.mount(document.createElement('div'))

    expect(injected).toBe('parent')
    expect(nestedInjected).toBe('child')
    app.destroy()
  })

  it('calling provide outside a component gives a scope error', () => {
    const key = createInjectionKey<string>('test.outside-context')
    expect(() => provide(key, 'value')).toThrow('Owner scope')
  })

  it('inject supports fallback values and required-injection validation', () => {
    const key = createInjectionKey<string>('test.optional')
    expect(inject(key, 'fallback')).toBe('fallback')
    expect(() => injectRequired(key, 'test.optional')).toThrow('required injection')
    const app = createVobs({
      render: () => {
        provide(key, 'provided')
        return createText(`${injectRequired(key)}:${inject(key, 'fallback')}`)
      }
    })
    const container = document.createElement('div')
    app.mount(container)
    expect(container.textContent).toBe('provided:provided')
    app.destroy()
  })

  it('plugins can observe startup errors but cannot swallow the original error', () => {
    const failure = new Error('install failed')
    let reported: unknown
    const observer: VobsPlugin = {
      name: 'observer',
      install(context) {
        context.onError(error => { reported = error })
      }
    }
    const broken: VobsPlugin = {
      name: 'broken',
      install() {
        throw failure
      }
    }

    expect(() => createVobs({ render: () => createText(''), plugins: [observer, broken] }))
      .toThrow(failure)
    expect(reported).toBe(failure)
  })

  it('component errors keep the source location provided by the compiler', () => {
    const failure = new Error('render failed')
    const app = createVobs({
      render: () => createComponent(() => { throw failure }, {}, {
        file: 'src/Page.tsx',
        line: 12,
        column: 7
      })
    })

    expect(() => app.mount(document.createElement('div'))).toThrow(failure)
    expect((failure as VobsLocatedError).vobsSource).toEqual({
      file: 'src/Page.tsx',
      line: 12,
      column: 7
    })
  })

  it('component effect errors keep the source location too and keep propagating to the app', () => {
    const failure = new Error('effect failed')
    const app = createVobs({
      render: () => createComponent(() => {
        effect(() => { throw failure })
        return createText('ready')
      }, {}, { file: 'src/EffectPage.tsx', line: 8, column: 3 })
    })

    expect(() => app.mount(document.createElement('div'))).toThrow(failure)
    expect((failure as VobsLocatedError).vobsSource).toEqual({
      file: 'src/EffectPage.tsx',
      line: 8,
      column: 3
    })
  })

  it('event listeners are removed automatically when the component Owner is disposed', () => {
    let button!: HTMLButtonElement
    let clicks = 0
    const app = createVobs({
      render: () => createComponent(() => {
        button = createElement('button') as HTMLButtonElement
        addEventListener(button, 'click', () => { clicks++ })
        return button
      }, {})
    })
    app.mount(document.createElement('div'))
    button.dispatchEvent(new Event('click'))
    app.destroy()
    button.dispatchEvent(new Event('click'))
    expect(clicks).toBe(1)
  })
})

/*
 * Three "between declaration and implementation" seams of the plugin contract.
 * All were reproduced in real measurements first (probes in .artifacts/probe-plugin.mjs).
 */
describe('plugin contract diagnostics', () => {
  const mount = (plugins: VobsPlugin[]) =>
    createVobs({ renderer: createDOMRenderer(), render: () => createText(''), plugins })

  it('a second same-name plugin with a different object warns (with version); passing the same object repeatedly stays quiet', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const plugin = { name: '@x/a', version: '1.0.0', install: () => {} }

    // `use` on the same object twice: normal usage, no noise expected
    mount([plugin, plugin])
    expect(warn).not.toHaveBeenCalled()

    // Same name but a different object: used to be skipped silently with no hint
    mount([plugin, { name: '@x/a', version: '2.0.0', install: () => {} }])
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('@x/a')
    expect(String(warn.mock.calls[0][0])).toContain('1.0.0')

    warn.mockRestore()
  })

  it('install returning a Promise throws at install time instead of exploding at destroy', () => {
    const app = createVobs({ renderer: createDOMRenderer(), render: () => createText('') })
    expect(() => app.use({ name: 'async', install: (async () => {}) as unknown as () => void }))
      .toThrow(/must synchronously return a cleanup function or return nothing/)
    // Key point: the error happens at install time; destroy no longer has a problem
    expect(() => app.destroy()).not.toThrow()
  })

  it('install returning a non-function is rejected too', () => {
    const app = createVobs({ renderer: createDOMRenderer(), render: () => createText('') })
    expect(() => app.use({ name: 'bad', install: (() => 42) as unknown as () => void }))
      .toThrow(/must synchronously return a cleanup function or return nothing/)
    app.destroy()
  })

  it('optional is declaration-only: plugins inside it are not installed (existing semantics, locked by test)', () => {
    const calls: string[] = []
    const optional: VobsPlugin = { name: 'opt', install: () => { calls.push('opt') } }
    mount([{ name: 'main', optional: [optional], install: () => { calls.push('main') } }])
    expect(calls).toEqual(['main'])
  })
})
