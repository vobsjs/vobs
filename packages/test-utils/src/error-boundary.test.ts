import { describe, expect, it } from 'vitest'
import { createElement, createText, createVobs, effect, ErrorBoundary, insertErrorBoundary, state } from '@vobs/vobs'

describe('insertErrorBoundary', () => {
  it('catches errors from child render branches and can retry', () => {
    const broken = state(true)
    let retry!: () => void
    const app = createVobs({
      render: () => {
        const root = createElement('div')
        insertErrorBoundary(root, null, {
          children: () => {
            if (broken.value) throw new Error('broken')
            return createText('ready')
          },
          fallback: (error, nextRetry) => {
            retry = nextRetry
            return createText(`error: ${error.message}`)
          }
        })
        return root
      }
    })
    const container = document.createElement('div')
    app.mount(container)
    app.update()
    expect(container.textContent).toBe('error: broken')

    broken.value = false
    retry()
    app.update()
    expect(container.textContent).toBe('ready')
    app.destroy()
  })

  it('catches errors from effects created inside the child branch', () => {
    const broken = state(false)
    let cleanups = 0
    const app = createVobs({
      render: () => {
        const root = createElement('div')
        insertErrorBoundary(root, null, {
          children: () => {
            const text = createText('ready')
            effect(() => {
              if (broken.value) throw new Error('effect failure')
              return () => { cleanups++ }
            })
            return text
          },
          fallback: error => createText(`error: ${error.message}`)
        })
        return root
      }
    })
    const container = document.createElement('div')
    app.mount(container)
    broken.value = true
    app.update()
    expect(container.textContent).toBe('error: effect failure')
    expect(cleanups).toBe(1)
    app.destroy()
  })

  it('the component form reuses the same boundary protocol and recovers the subtree when the route key changes', () => {
    const broken = state(true)
    let retry!: () => void
    const app = createVobs({
      render: () => ErrorBoundary({
        children: () => {
          if (broken.value) throw new Error('broken')
          return createText('ready')
        },
        fallback: (error, nextRetry) => {
          retry = nextRetry
          return createText(`error: ${error.message}`)
        }
      })
    })
    const container = document.createElement('div')
    app.mount(container)
    app.update()
    expect(container.textContent).toBe('error: broken')

    broken.value = false
    retry()
    app.update()
    expect(container.textContent).toBe('ready')
    app.destroy()
  })
})
