import { describe, expect, it } from 'vitest'
import { setProperty } from '@vobs/dom'
import { createElement, insertBefore } from '@vobs/vobs'
import { hydrate, renderToString, createSSRRenderer } from './index'

/**
 * `setProperty(node, 'textContent' | 'innerText', text)` is a **text channel**, not an
 * attribute channel.
 *
 * `propertyAttribute`'s declarative whitelist only covers value/tabIndex/className/boolean
 * attributes — text was not among them, so it used to be **silently dropped** (no warning,
 * no placeholder) and client hydration immediately failed with `extra-node`: the server
 * output was `<option value="a"></option>` while the client
 * `Reflect.set(option,'textContent',…)` created an unclaimed text node.
 *
 * This is not a hypothetical usage: `packages/table/src/data-table.ts:472`
 * (`setProperty(option, 'textContent', String(optionValue))`) and
 * `packages/table/src/column-settings.ts:184` both call it directly, outside any effect —
 * SSR would inevitably hit it.
 *
 * The fix serializes the text as a **child node** (through `serializeChildren`), inheriting
 * the two existing guarantees — escaping and the `<!---->` separator between adjacent
 * texts — instead of concatenating it into the tag as an attribute.
 */
describe('the textContent channel in SSR', () => {
  // Same shape as real usage in packages/table: elements created inside the render
  // function, text via setProperty
  const optionTree = () => {
    const select = createElement('select')
    const option = createElement('option')
    setProperty(option, 'value', 'a')
    setProperty(option, 'textContent', '标签文字')
    insertBefore(select, option, null)
    return select
  }

  it('server output preserves the text (no longer silently lost)', () => {
    const html = renderToString(optionTree)
    expect(html).toBe('<select><option value="a">标签文字</option></select>')
  })

  it('text is escaped, sharing the same channel as createText', () => {
    const html = renderToString(() => {
      const div = createElement('div')
      setProperty(div, 'textContent', 'a & <b>')
      return div
    })
    expect(html).toBe('<div>a &amp; &lt;b&gt;</div>')
  })

  it('empty text produces no child node', () => {
    const html = renderToString(() => {
      const div = createElement('div')
      setProperty(div, 'textContent', '')
      return div
    })
    expect(html).toBe('<div></div>')
  })

  it('innerText is equivalent to textContent', () => {
    const html = renderToString(() => {
      const div = createElement('div')
      setProperty(div, 'innerText', '你好')
      return div
    })
    expect(html).toBe('<div>你好</div>')
  })

  it('textContent does not become an HTML attribute', () => {
    const html = renderToString(optionTree)
    expect(html).not.toContain('textcontent=')
    expect(html).not.toContain('textContent=')
  })

  it('strict hydration no longer throws extra-node (the pre-fix failure shape)', () => {
    const html = renderToString(optionTree)
    document.body.innerHTML = html
    // Before the fix this threw HydrationMismatchError [extra-node]: the text node created
    // by client Reflect.set(option,'textContent') was absent from the server output.
    const app = hydrate(optionTree, document.body)
    expect(document.body.querySelector('option')?.textContent).toBe('标签文字')
    app.destroy()
    document.body.innerHTML = ''
  })

  it('direct SSR renderer call: text goes into children, not attributes', () => {
    const ssr = createSSRRenderer()
    const div = ssr.renderer.createElement('div')
    ssr.renderer.setProperty(div, 'textContent', '纯文本')
    expect(ssr.toHTML(div)).toBe('<div>纯文本</div>')
  })
})
