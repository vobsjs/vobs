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
 * After a boundary captures an error, it used to only call invokeRuntimeDebug('error', …) —
 * without DevTools installed (and thus no error hook) the console printed nothing at all:
 * the error was replaced by the fallback, leaving no trace of the scene.
 */
describe('boundary errors are no longer silent', () => {
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

  it('writes to the console when there is no error hook', () => {
    setRuntimeDebugHooks(null)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { host, app } = mountFailing()

    expect(host.textContent).toBe('failed')
    expect(spy).toHaveBeenCalled()
    expect(String(spy.mock.calls[0][0])).toContain('boom')

    app.destroy()
    spy.mockRestore()
  })

  it('delegates to the hook when installed, without duplicate output', () => {
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
