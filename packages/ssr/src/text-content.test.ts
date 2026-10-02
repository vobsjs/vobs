import { describe, expect, it } from 'vitest'
import { setProperty } from '@vobs/dom'
import { createElement, insertBefore } from '@vobs/vobs'
import { hydrate, renderToString, createSSRRenderer } from './index'

/**
 * `setProperty(node, 'textContent' | 'innerText', text)` 是**文本通道**，不是属性通道。
 *
 * `propertyAttribute` 的声明式白名单只覆盖 value/tabIndex/className/布尔属性 —— 文本不在里面，
 * 所以它此前被**静默丢弃**（无警告、无占位符），客户端水合随即以 `extra-node` 失败：
 * 服务端产物 `<option value="a"></option>`，而客户端 `Reflect.set(option,'textContent',…)`
 * 造出一个未认领的文本节点。
 *
 * 这不是假想用法：`packages/table/src/data-table.ts:472`
 * （`setProperty(option, 'textContent', String(optionValue))`）与
 * `packages/table/src/column-settings.ts:184` 都直接这么调，且不在 effect 里 —— SSR 下必然命中。
 *
 * 修法是把文本当**子节点**序列化（经 `serializeChildren`），从而继承转义与
 * 「相邻文本插 `<!---->` 分隔符」这两条既有保证；而不是把它当属性拼进标签。
 */
describe('SSR 的 textContent 通道', () => {
  // 与 packages/table 的真实用法同形：元素在 render 函数内创建，文本走 setProperty
  const optionTree = () => {
    const select = createElement('select')
    const option = createElement('option')
    setProperty(option, 'value', 'a')
    setProperty(option, 'textContent', '标签文字')
    insertBefore(select, option, null)
    return select
  }

  it('服务端产物保留文本（不再静默丢失）', () => {
    const html = renderToString(optionTree)
    expect(html).toBe('<select><option value="a">标签文字</option></select>')
  })

  it('文本被转义，与 createText 走同一条通道', () => {
    const html = renderToString(() => {
      const div = createElement('div')
      setProperty(div, 'textContent', 'a & <b>')
      return div
    })
    expect(html).toBe('<div>a &amp; &lt;b&gt;</div>')
  })

  it('空文本不产出子节点', () => {
    const html = renderToString(() => {
      const div = createElement('div')
      setProperty(div, 'textContent', '')
      return div
    })
    expect(html).toBe('<div></div>')
  })

  it('innerText 与 textContent 等价', () => {
    const html = renderToString(() => {
      const div = createElement('div')
      setProperty(div, 'innerText', '你好')
      return div
    })
    expect(html).toBe('<div>你好</div>')
  })

  it('textContent 不会变成 HTML 属性', () => {
    const html = renderToString(optionTree)
    expect(html).not.toContain('textcontent=')
    expect(html).not.toContain('textContent=')
  })

  it('严格水合不再抛 extra-node（修复前的失败形态）', () => {
    const html = renderToString(optionTree)
    document.body.innerHTML = html
    // 修复前这里会抛 HydrationMismatchError [extra-node]：客户端
    // Reflect.set(option,'textContent') 造出的文本节点不在服务端产物里。
    const app = hydrate(optionTree, document.body)
    expect(document.body.querySelector('option')?.textContent).toBe('标签文字')
    app.destroy()
    document.body.innerHTML = ''
  })

  it('SSR 渲染器直接调用：文本进 children，不进属性', () => {
    const ssr = createSSRRenderer()
    const div = ssr.renderer.createElement('div')
    ssr.renderer.setProperty(div, 'textContent', '纯文本')
    expect(ssr.toHTML(div)).toBe('<div>纯文本</div>')
  })
})
