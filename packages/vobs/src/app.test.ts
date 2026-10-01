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

  it('没有 render 时抛错', () => {
    expect(() => createVobs({} as any)).toThrow()
  })

  it('支持应用级错误观察器且不会覆盖原始异常', () => {
    const errors: unknown[] = []
    const app = createVobs({
      render: () => { throw new Error('render failed') },
      onError: error => errors.push(error)
    })
    expect(() => app.mount(document.createElement('div'))).toThrow('render failed')
    expect(errors[0]).toBeInstanceOf(Error)
    expect((errors[0] as Error).message).toBe('render failed')
  })

  it('挂载后 mounted 为 true', () => {
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

  it('按依赖顺序安装插件，并逆序清理', () => {
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

  it('注入项默认不可被静默覆盖', () => {
    const key = createInjectionKey<string>('test.value')
    const plugin: VobsPlugin = {
      name: 'context',
      install: context => {
        context.provide(key, 'first')
        expect(() => context.provide(key, 'second')).toThrow('已存在')
        context.provide(key, 'second', { override: true })
        expect(context.inject(key)).toBe('second')
      }
    }

    createVobs({ render: () => createText(''), plugins: [plugin] }).destroy()
  })

  it('插件可访问 app、注册销毁回调并声明可选依赖', () => {
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

  it('组件 provide/inject 按 Owner 层级查找，并可覆盖父级值', () => {
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

  it('组件外调用 provide 会给出作用域错误', () => {
    const key = createInjectionKey<string>('test.outside-context')
    expect(() => provide(key, 'value')).toThrow('Owner 作用域')
  })

  it('inject 支持默认值和必需注入校验', () => {
    const key = createInjectionKey<string>('test.optional')
    expect(inject(key, 'fallback')).toBe('fallback')
    expect(() => injectRequired(key, 'test.optional')).toThrow('必需注入项')
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

  it('插件可以观察启动错误，但不能吞掉原始错误', () => {
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

  it('组件错误保留编译器提供的源码位置', () => {
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

  it('组件 effect 错误也保留源码位置并继续向应用传播', () => {
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

  it('组件 Owner 销毁时自动移除事件监听器', () => {
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
 * 插件契约的三条「声明与实现之间」的缝。
 * 都先实测复现过才动手（探针见 .artifacts/probe-plugin.mjs）。
 */
describe('插件契约的诊断', () => {
  const mount = (plugins: VobsPlugin[]) =>
    createVobs({ renderer: createDOMRenderer(), render: () => createText(''), plugins })

  it('同名插件第二次传入不同对象时会警告（带版本），同一对象重复传则不吵', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const plugin = { name: '@x/a', version: '1.0.0', install: () => {} }

    // 同一个对象 use 两次：正常用法，不该有噪音
    mount([plugin, plugin])
    expect(warn).not.toHaveBeenCalled()

    // 名字相同但是另一个对象：原来静默跳过、毫无提示
    mount([plugin, { name: '@x/a', version: '2.0.0', install: () => {} }])
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('@x/a')
    expect(String(warn.mock.calls[0][0])).toContain('1.0.0')

    warn.mockRestore()
  })

  it('install 返回 Promise 会在安装期抛错，而不是拖到 destroy 才炸', () => {
    const app = createVobs({ renderer: createDOMRenderer(), render: () => createText('') })
    expect(() => app.use({ name: 'async', install: (async () => {}) as unknown as () => void }))
      .toThrow(/必须同步返回清理函数或不返回/)
    // 关键：错误发生在安装期，destroy 时不会再出问题
    expect(() => app.destroy()).not.toThrow()
  })

  it('install 返回非函数也拒绝', () => {
    const app = createVobs({ renderer: createDOMRenderer(), render: () => createText('') })
    expect(() => app.use({ name: 'bad', install: (() => 42) as unknown as () => void }))
      .toThrow(/必须同步返回清理函数或不返回/)
    app.destroy()
  })

  it('optional 仅声明：不安装其中的插件（既有语义，测试锁住）', () => {
    const calls: string[] = []
    const optional: VobsPlugin = { name: 'opt', install: () => { calls.push('opt') } }
    mount([{ name: 'main', optional: [optional], install: () => { calls.push('main') } }])
    expect(calls).toEqual(['main'])
  })
})
