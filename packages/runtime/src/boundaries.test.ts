// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { createDOMRenderer, createElement, createText, createVobs, insertErrorBoundary, Profiler, AsyncBoundary, setRuntimeDebugHooks, state } from '@vobs/vobs'

describe('AsyncBoundary and Profiler', () => {
  it('renders loading then resolved content', async () => {
    let resolve!: (value: string) => void
    const promise = new Promise<string>(done => { resolve = done })
    const host = document.createElement('div')
    const app = createVobs({ renderer: createDOMRenderer(), render: () => AsyncBoundary({
      promise,
      loading: createText('loading'),
      children: value => createText(value)
    }) })
    app.mount(host)
    expect(host.textContent).toBe('loading')
    resolve('ready')
    await promise
    await Promise.resolve()
    expect(host.textContent).toBe('ready')
    app.destroy()
  })

  it('ignores stale Promise results after a resetKey change', async () => {
    let resolveFirst!: (value: string) => void
    let resolveSecond!: (value: string) => void
    const first = new Promise<string>(done => { resolveFirst = done })
    const second = new Promise<string>(done => { resolveSecond = done })
    const key = state(0)
    const host = document.createElement('div')
    const app = createVobs({ renderer: createDOMRenderer(), render: () => AsyncBoundary({
      promise: () => key.value === 0 ? first : second,
      resetKey: () => key.value,
      children: value => createText(value)
    }) })
    app.mount(host)
    key.value = 1
    app.update()
    resolveFirst('stale')
    resolveSecond('fresh')
    await Promise.resolve()
    await Promise.resolve()
    expect(host.textContent).toBe('fresh')
    app.destroy()
  })

  it('reports mount and update phases', () => {
    const events: string[] = []
    const host = document.createElement('div')
    const app = createVobs({ renderer: createDOMRenderer(), render: () => Profiler({
      id: 'demo',
      onRender: info => events.push(info.phase),
      children: () => createText('content')
    }) })
    app.mount(host)
    expect(events).toEqual(['mount'])
    app.destroy()
    vi.restoreAllMocks()
  })
})

/*
 * 边界捕获错误之后，原来只调 invokeRuntimeDebug('error', …) ——
 * 没装 DevTools（也就没有 error 钩子）时控制台一个字都不输出：
 * 错误被替换成 fallback，现场再无痕迹。
 */
describe('边界错误不再静默', () => {
  const mountFailing = () => {
    const host = document.createElement('div')
    const app = createVobs({
      renderer: createDOMRenderer(),
      render: () => {
        const root = createElement('div')
        insertErrorBoundary(root, null, {
          children: () => { throw new Error('boom') },
          fallback: () => createText('failed')
        })
        return root
      }
    })
    app.mount(host)
    app.update()
    return { host, app }
  }

  it('没有 error 钩子时写进控制台', () => {
    setRuntimeDebugHooks(null)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { host, app } = mountFailing()

    expect(host.textContent).toBe('failed')
    expect(spy).toHaveBeenCalled()
    expect(String(spy.mock.calls[0][0])).toContain('boom')

    app.destroy()
    spy.mockRestore()
  })

  it('装了 error 钩子时交给钩子，不重复输出', () => {
    const events: unknown[] = []
    const restore = setRuntimeDebugHooks({ error: event => events.push(event) })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { host, app } = mountFailing()

    expect(host.textContent).toBe('failed')
    expect(events.length).toBeGreaterThan(0)
    expect(spy).not.toHaveBeenCalled()

    app.destroy()
    setRuntimeDebugHooks(restore)
    spy.mockRestore()
  })
})
