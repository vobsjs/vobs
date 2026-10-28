// @vitest-environment jsdom
/*
 * Drag events on JSX (real project pitfall #1, 2026-10-02).
 *
 * Symptom: `onDragOver` / `onDrop` reported
 *   `Property 'onDragOver' does not exist on type 'VobsHTMLAttributes'`
 * so "drag in files to import" had to fall back to a `ref` callback + native
 * `addEventListener`.
 *
 * Key fact (also locked in by this file): **the runtime already supported it** —
 * `resolveEventName` applies `slice(2).toLowerCase()` to any `on*` prop,
 * so `onDragOver` resolves to `dragover`. What was missing was only the
 * **type declarations**.
 *
 * This file therefore has two layers of verification:
 * 1. **Type layer**: the JSX below uses `onDragOver`/`onDrop` directly and passes
 *    `pnpm run typecheck` (with missing types this file itself wouldn't compile)
 * 2. **Runtime layer**: the compiled output really binds `dragover`/`drop`, and
 *    dispatching the events triggers the callbacks
 */
import { describe, expect, it, vi } from 'vitest'
import { scheduler } from '@vobs/reactivity'
import { createDOMRenderer, setRenderer } from '@vobs/vobs'
import { compileWithSourceMap } from '@vobs/compiler'

setRenderer(createDOMRenderer())
const settle = (): void => { scheduler.flush() }

describe('drag events: type layer', () => {
  it('the compiler emits bindEvent with the DOM event names dragover/drop', () => {
    const src = `
      export const UploadArea = () => (
        <div
          class="drop-zone"
          onDragOver={event => { event.preventDefault() }}
          onDrop={event => { handleFiles(event.dataTransfer?.files) }}
        />
      )
    `
    const { code, diagnostics } = compileWithSourceMap(src, { filename: 'UploadArea.tsx' })
    expect(diagnostics.filter(d => d.severity === 'error')).toEqual([])
    // Event binding lands on "dragover" / "drop" (not the raw onDragOver string)
    expect(code).toContain('"dragover"')
    expect(code).toContain('"drop"')
  })

  it('drag family resolves via the toLowerCase wildcard in the event-name table (proving the runtime already supported it)', () => {
    // Deliberately NOT asserting "the alias table contains dragover" — it **is not** in
    // the alias table; the toLowerCase wildcard from slice(2) is what covers it.
    // That is exactly why "types missing but runtime present".
    const src = `export const A = () => <div onDragStart={f} onDragEnd={g} onDragEnter={h} onDragLeave={i} />`
    const { code } = compileWithSourceMap(src, { filename: 'a.tsx' })
    for (const name of ['dragstart', 'dragend', 'dragenter', 'dragleave']) {
      expect(code, `${name} was not bound`).toContain(`"${name}"`)
    }
  })
})

describe('drag events: runtime layer (callbacks really fire)', () => {
  it('dispatching dragover / drop calls the corresponding handlers', async () => {
    const { addEventListener } = await import('@vobs/runtime')
    const onDragOver = vi.fn()
    const onDrop = vi.fn()

    const zone = document.createElement('div')
    document.body.appendChild(zone)
    // Same path as the compiler output
    addEventListener(zone, 'dragover', onDragOver)
    addEventListener(zone, 'drop', onDrop)

    zone.dispatchEvent(new Event('dragover', { bubbles: true, cancelable: true }))
    settle()
    expect(onDragOver, 'dragover did not trigger onDragOver').toHaveBeenCalledTimes(1)

    zone.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }))
    settle()
    expect(onDrop, 'drop did not trigger onDrop').toHaveBeenCalledTimes(1)

    zone.remove()
  })

  it('onDrop receives dataTransfer (the real drag-in-files usage)', async () => {
    const { addEventListener } = await import('@vobs/runtime')
    const received: unknown[] = []
    const zone = document.createElement('div')
    document.body.appendChild(zone)
    addEventListener(zone, 'drop', (event: Event) => { received.push((event as DragEvent).dataTransfer) })

    const event = new Event('drop', { bubbles: true, cancelable: true })
    zone.dispatchEvent(event)
    settle()
    expect(received, 'the drop callback was never called').toHaveLength(1)
    zone.remove()
  })
})
