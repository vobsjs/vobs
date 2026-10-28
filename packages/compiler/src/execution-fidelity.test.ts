// @vitest-environment jsdom
/*
 * I4 · compile-time/runtime consistency / output semantic fidelity
 *
 * The existing `packages/compiler` tests hold 185 `toContain` string assertions — **the output was never executed**.
 * This file adds the missing step: compile the JSX into real output, write it into a temp module, import it,
 * mount it on jsdom, then **assert only the DOM result** (never the output's literal shape).
 *
 * This way any "compile-time/runtime judgment divergence" or "output semantic bug" shows a visible symptom.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { createDOMRenderer } from '@vobs/dom'
import { createVobs, setRenderer } from '@vobs/vobs'
import { compile } from './index'

setRenderer(createDOMRenderer())

const tempDir = mkdtempSync(path.join(tmpdir(), 'vobs-compiler-exec-'))
afterAll(() => { rmSync(tempDir, { recursive: true, force: true }) })

let seq = 0
let mounted: Array<{ destroy(): void }> = []
afterEach(() => { for (const app of mounted) { try { app.destroy() } catch { /* already destroyed */ } } mounted = [] })

/**
 * Compile a component source → write a temp .mjs → dynamic import → mount → return the root element.
 * The temp module sits in this package's directory so `@vobs/vobs` resolution matches real-world usage.
 */
async function renderComponent(source: string): Promise<{ root: Element; mod: Record<string, unknown> }> {
  const out = compile(source, { filename: `Comp${seq}.tsx` })
  const file = path.join(import.meta.dirname, `__exec-${seq}.mjs`)
  seq += 1
  writeFileSync(file, out, 'utf8')
  try {
    const mod = await import(/* @vite-ignore */ pathToFileURL(file).href) as Record<string, unknown>
    const container = document.createElement('div')
    document.body.appendChild(container)
    const Component = mod.App as () => unknown
    const app = createVobs({ render: () => Component() as never })
    app.mount(container)
    mounted.push(app)
    return { root: container, mod }
  } finally {
    rmSync(file, { force: true })
  }
}

describe('I4 · semantic fidelity of text content (compile output vs HTML semantics)', () => {
  it('plain text lands in the DOM verbatim', async () => {
    const { root } = await renderComponent('export const App = () => <div>hello world</div>')
    expect(root.querySelector('div')?.textContent).toBe('hello world')
  })

  it('bare & and < come through as literal characters', async () => {
    const { root } = await renderComponent('export const App = () => <div>a & b</div>')
    expect(root.querySelector('div')?.textContent).toBe('a & b')
  })

  it('angle brackets and quotes as text must not be treated as markup', async () => {
    const { root } = await renderComponent('export const App = () => <div>{"<b>bold</b>"}</div>')
    expect(root.querySelector('div')?.textContent).toBe('<b>bold</b>')
    expect(root.querySelector('b')).toBeNull()
  })

  it('comparison expressions inside braces produce the correct text', async () => {
    const { root } = await renderComponent(
      'export const App = () => { const n = 2; return <div>{n > 1 ? "yes" : "no"}</div> }'
    )
    expect(root.querySelector('div')?.textContent).toBe('yes')
  })
})

describe('I4 · attribute channel: the compile output must use the same table as runtime', () => {
  it('className lands as class', async () => {
    const { root } = await renderComponent('export const App = () => <div className="a b" />')
    expect(root.querySelector('div')?.getAttribute('class')).toBe('a b')
  })

  it('htmlFor lands as for (the label association must hold)', async () => {
    const { root } = await renderComponent(
      'export const App = () => <label htmlFor="name">N</label>'
    )
    expect(root.querySelector('label')?.getAttribute('for')).toBe('name')
    expect(root.querySelector('label')?.htmlFor).toBe('name')
  })

  it('tabIndex lands as tabindex', async () => {
    const { root } = await renderComponent('export const App = () => <div tabIndex={3} />')
    expect(root.querySelector('div')?.getAttribute('tabindex')).toBe('3')
  })

  it('colSpan / rowSpan land as colspan / rowspan', async () => {
    const { root } = await renderComponent(
      'export const App = () => <table><tbody><tr><td colSpan={2} rowSpan={3}>x</td></tr></tbody></table>'
    )
    const td = root.querySelector('td')
    expect(td?.getAttribute('colspan')).toBe('2')
    expect(td?.getAttribute('rowspan')).toBe('3')
  })

  it('boolean attributes: true present, false not set', async () => {
    const on = await renderComponent('export const App = () => <input disabled />')
    expect((on.root.querySelector('input') as HTMLInputElement)?.disabled).toBe(true)
    const off = await renderComponent('export const App = () => <input disabled={false} />')
    expect((off.root.querySelector('input') as HTMLInputElement)?.disabled).toBe(false)
    expect(off.root.querySelector('input')?.hasAttribute('disabled')).toBe(false)
  })

  it('autoFocus={false} must not leave an autofocus attribute (attribute presence means focus)', async () => {
    const { root } = await renderComponent('export const App = () => <input autoFocus={false} />')
    expect(root.querySelector('input')?.hasAttribute('autofocus')).toBe(false)
  })

  it('a controlled value lands on the property', async () => {
    const { root } = await renderComponent('export const App = () => <input value="v1" />')
    expect((root.querySelector('input') as HTMLInputElement).value).toBe('v1')
  })
})

describe('I4 · event names: compile time and runtime must derive the same event name', () => {
  it('onDoubleClick binds to dblclick', async () => {
    const { root, mod } = await renderComponent(
      'export const App = () => <button onDoubleClick={() => { globalThis.__dbl = (globalThis.__dbl ?? 0) + 1 }}>x</button>'
    )
    const btn = root.querySelector('button')!
    ;(globalThis as Record<string, unknown>).__dbl = 0
    btn.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    expect((globalThis as Record<string, unknown>).__dbl).toBe(1)
    // The nonexistent doubleclick must not be bound
    btn.dispatchEvent(new Event('doubleclick', { bubbles: true }))
    expect((globalThis as Record<string, unknown>).__dbl).toBe(1)
    void mod
  })

  it('onClick binds to click', async () => {
    const { root } = await renderComponent(
      'export const App = () => <button onClick={() => { globalThis.__clk = (globalThis.__clk ?? 0) + 1 }}>x</button>'
    )
    ;(globalThis as Record<string, unknown>).__clk = 0
    root.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect((globalThis as Record<string, unknown>).__clk).toBe(1)
  })
})
