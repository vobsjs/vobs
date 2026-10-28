// @vitest-environment jsdom
// JSX compiled output + runtime integration regressions: reproduces two scenarios
// reported from the Labelune side
// ③ dynamic style expression inside a list (brand color palette: dynamic style failed to
//    render → fully transparent)
// ④ "node ↔ null" condition inside list items (signal was set but the node didn't
//    appear/didn't get removed)
import { describe, expect, it } from 'vitest'
import { compile } from '@vobs/compiler'
import { createDOMRenderer } from '@vobs/vobs'
import {
  createElement,
  createText,
  createTemplate,
  cloneTemplate,
  insertBefore,
  insertDynamic,
  insertList,
  insertDynamicValue,
  bindAttribute,
  bindText,
  bindProperty,
  setStaticProps,
  setProperty,
  setAttribute, addEventListener, spreadProps, setRef,
  setRenderer
} from '@vobs/runtime'
import { state } from '@vobs/reactivity'

/** Compile JSX source and execute it: helpers are injected as the runtime implementations (equivalent to the vite-plugin compile path) */
function runJsx(source: string): unknown {
  const compiled = compile(source, { filename: 'integration.tsx' }) as unknown as string
  const imports = compiled.match(/import \{([^}]+)\} from "@vobs\/vobs";/)
  if (!imports) throw new Error('compiled output is missing the runtime import')
  const code = compiled.replace(imports[0], '')
  const names = imports[1]!.split(',').map(name => name.trim()).filter(Boolean)
  const impls: Record<string, unknown> = {
    createElement, createText, createTemplate, cloneTemplate,
    insertBefore, insertDynamic, insertList, insertDynamicValue,
    bindAttribute, bindText, bindProperty, setStaticProps, setProperty,
    setAttribute, addEventListener, spreadProps, setRef
  }
  const args = names.map(name => {
    if (!(name in impls)) throw new Error(`runtime helper not injected: ${name}`)
    return impls[name]
  })
  return new Function(...names, `"use strict";\n${code}; return el;`)(...args)
}

describe('JSX compile × runtime integration regressions', () => {
  it('③ dynamic style expression inside a list colors correctly (brand palette scenario)', () => {
    setRenderer(createDOMRenderer())
    const el = runJsx(`
      const colors = [{ hex: '#10b981', label: '绿' }, { hex: '#f97316', label: '橙' }]
      const el = <div>{colors.map(c => (
        <button type="button" class="dot" style={\`background: \${c.hex}\`} key={c.hex}>{c.label}</button>
      ))}</div>
    `) as HTMLElement
    const dots = el.querySelectorAll('button')
    expect(dots.length).toBe(2)
    expect((dots[0] as HTMLElement).style.background).toContain('rgb(16, 185, 129)')
    expect((dots[0] as HTMLElement).style.background).not.toBe('')
  })

  it('④ "node ↔ null" condition inside list items responds to external signals', async () => {
    setRenderer(createDOMRenderer())
    const el = runJsx(`
      const active = { value: 'a' }
      const items = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]
      const el = <div>{items.map(item => (
        <div class="row" key={item.id}>
          {active.value === item.id ? <span class="dot-on">on</span> : null}
          <span>{item.label}</span>
        </div>
      ))}</div>
    `) as HTMLElement
    // Note: the source's active is captured by the compiled output as a plain object;
    // driving by an external signal needs a signal subscribed by the in-row effect.
    // Here we just verify the first render with both initial conditional shapes.
    expect(el.querySelectorAll('.dot-on').length).toBe(1)
  })

  it('④b "node ↔ null" condition inside list items flips with a real signal', async () => {
    setRenderer(createDOMRenderer())
    const active = state('a')
    const el = runJsxWith(`
      const items = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]
      const el = <div>{items.map(item => (
        <div class="row" key={item.id}>
          {active.value === item.id ? <span class="dot-on">on</span> : null}
          <span>{item.label}</span>
        </div>
      ))}</div>
    `, { active }) as HTMLElement
    expect(el.querySelectorAll('.dot-on').length).toBe(1)
    active.value = 'b'
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(el.querySelectorAll('.dot-on').length).toBe(1)
    expect((el.querySelectorAll('.row')[1] as HTMLElement).querySelector('.dot-on')).not.toBeNull()
    expect((el.querySelectorAll('.row')[0] as HTMLElement).querySelector('.dot-on')).toBeNull()
  })

  it('④c "node ↔ null" condition inside list items flips with a list item object property (item signal driven)', async () => {
    setRenderer(createDOMRenderer())
    const items = state([
      { id: 'a', label: 'A', on: true },
      { id: 'b', label: 'B', on: false }
    ])
    const el = runJsxWith(`
      const el = <div>{items.value.map(item => (
        <div class="row" key={item.id}>
          {item.on ? <span class="dot-on">on</span> : null}
          <span>{item.label}</span>
        </div>
      ))}</div>
    `, { items }) as HTMLElement
    expect(el.querySelectorAll('.dot-on').length).toBe(1)
    items.value = [
      { id: 'a', label: 'A', on: false },
      { id: 'b', label: 'B', on: true }
    ]
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(el.querySelectorAll('.dot-on').length).toBe(1)
    expect((el.querySelectorAll('.row')[1] as HTMLElement).querySelector('.dot-on')).not.toBeNull()
    expect((el.querySelectorAll('.row')[0] as HTMLElement).querySelector('.dot-on')).toBeNull()
  })

  it('② pointer events compile to pointerdown listeners and can be triggered', () => {
    setRenderer(createDOMRenderer())
    const el = runJsx(`
      const el = <div onPointerDown={() => { window.__downs = (window.__downs ?? 0) + 1 }} />
    `) as HTMLElement
    el.dispatchEvent(new PointerEvent('pointerdown'))
    expect((window as unknown as { __downs?: number }).__downs).toBe(1)
  })

  it('⑤ role/spellCheck/autoComplete props land on the DOM correctly', () => {
    setRenderer(createDOMRenderer())
    const el = runJsx(`
      const el = <div>
        <div role="dialog" />
        <input spellCheck={false} autoComplete="off" />
        <td colSpan={2} />
      </div>
    `) as HTMLElement
    expect(el.querySelector('[role="dialog"]')).not.toBeNull()
    const input = el.querySelector('input') as HTMLInputElement
    expect(input.getAttribute('autocomplete')).toBe('off')
    expect(input.getAttribute('spellcheck')).toBe('false')
    expect((el.querySelector('td') as HTMLTableCellElement).colSpan).toBe(2)
  })

  it('⑥ select value binding auto-resyncs when options arrive asynchronously (no ref fallback needed)', async () => {
    setRenderer(createDOMRenderer())
    const items = state<string[]>([])
    const el = runJsxWith(`
      const current = { value: 'b' }
      const el = <select value={current.value}>{items.value.map(o => <option value={o}>{o}</option>)}</select>
    `, { items }) as HTMLSelectElement
    expect(el.value).toBe('')
    items.value = ['a', 'b', 'c']
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(el.value).toBe('b')
  })

  it('⑥b select options inserted via optgroup resync the same way', async () => {
    setRenderer(createDOMRenderer())
    interface Group { readonly label: string; readonly options: readonly string[] }
    const groups = state<readonly Group[]>([])
    const el = runJsxWith(`
      const current = { value: 'b' }
      const el = <select value={current.value}>{groups.value.map(group => (
        <optgroup label={group.label}>{group.options.map(o => <option value={o}>{o}</option>)}</optgroup>
      ))}</select>
    `, { groups }) as HTMLSelectElement
    expect(el.value).toBe('')
    groups.value = [{ label: 'G', options: ['a', 'b'] }]
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(el.value).toBe('b')
  })
})

/** runJsx variant: injects extra external dependencies (real signals etc.) for the compiled output's closure to reference */
function runJsxWith(source: string, deps: Record<string, unknown> = {}): unknown {
  const compiled = compile(source, { filename: 'integration-deps.tsx' }) as unknown as string
  const imports = compiled.match(/import \{([^}]+)\} from "@vobs\/vobs";/)
  if (!imports) throw new Error('compiled output is missing the runtime import')
  const code = compiled.replace(imports[0], '')
  const names = imports[1]!.split(',').map(name => name.trim()).filter(Boolean)
  const impls: Record<string, unknown> = {
    createElement, createText, createTemplate, cloneTemplate,
    insertBefore, insertDynamic, insertList, insertDynamicValue,
    bindAttribute, bindText, bindProperty, setStaticProps, setProperty,
    setAttribute, addEventListener, spreadProps, setRef
  }
  const argNames = [...names, ...Object.keys(deps)]
  const args = [...names.map(name => {
    if (!(name in impls)) throw new Error(`runtime helper not injected: ${name}`)
    return impls[name]
  }), ...Object.values(deps)]
  return new Function(...argNames, `"use strict";\n${code}; return el;`)(...args)
}
