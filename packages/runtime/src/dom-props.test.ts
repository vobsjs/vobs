import { describe, expect, it } from 'vitest'
import { domAttributeName, isPropertyName } from './dom-props'

describe('isPropertyName —— 哪些名字必须走 property 通道', () => {
  it('attribute 形式无效或名字对不上的，走 property', () => {
    // innerHTML / textContent 根本不是 HTML 属性，setAttribute 完全无效
    expect(isPropertyName('innerHTML')).toBe(true)
    expect(isPropertyName('innerText')).toBe(true)
    expect(isPropertyName('textContent')).toBe(true)
    // defaultValue 的 attribute 形式叫 value，名字对不上
    expect(isPropertyName('defaultValue')).toBe(true)
    expect(isPropertyName('defaultChecked')).toBe(true)
    // 这两个没有对应 attribute
    expect(isPropertyName('indeterminate')).toBe(true)
    expect(isPropertyName('currentTime')).toBe(true)
  })

  it('表单状态与常见 property', () => {
    for (const name of ['value', 'checked', 'selected', 'disabled', 'multiple', 'readOnly', 'required', 'tabIndex', 'colSpan']) {
      expect(isPropertyName(name)).toBe(true)
    }
  })

  it('attribute 与 data-*/aria-* 不受影响', () => {
    for (const name of ['className', 'title', 'id', 'data-id', 'aria-label', 'strokeWidth', 'someProp']) {
      expect(isPropertyName(name)).toBe(false)
    }
  })
})

describe('domAttributeName —— JSX 属性名 → DOM attribute 名', () => {
  it('HTML 别名', () => {
    expect(domAttributeName('className')).toBe('class')
    expect(domAttributeName('htmlFor')).toBe('for')
    expect(domAttributeName('autoComplete')).toBe('autocomplete')
    expect(domAttributeName('spellCheck')).toBe('spellcheck')
  })

  it('SVG 表现属性转短横线（写驼峰会静默无效）', () => {
    expect(domAttributeName('strokeWidth')).toBe('stroke-width')
    expect(domAttributeName('strokeLinecap')).toBe('stroke-linecap')
    expect(domAttributeName('fillOpacity')).toBe('fill-opacity')
    expect(domAttributeName('textAnchor')).toBe('text-anchor')
    expect(domAttributeName('stopColor')).toBe('stop-color')
    expect(domAttributeName('pointerEvents')).toBe('pointer-events')
    expect(domAttributeName('markerStart')).toBe('marker-start')
  })

  /*
   * 回归：SVG 的属性命名是混合的 —— 表现属性是短横线，结构属性却真是驼峰。
   * 曾经按「驼峰一律转短横线」实现过，会把下面这些改坏（viewBox → view-box 等），
   * 而改坏之后是完全静默的：浏览器不认识的属性，图形照旧不渲染，没有任何报错。
   */
  it('SVG 结构属性必须保持驼峰', () => {
    for (const name of [
      'viewBox', 'preserveAspectRatio', 'pathLength', 'startOffset', 'textLength', 'lengthAdjust',
      'markerWidth', 'markerHeight', 'markerUnits', 'clipPathUnits', 'gradientUnits',
      'patternUnits', 'maskUnits', 'spreadMethod', 'zoomAndPan', 'baseFrequency', 'numOctaves',
      'attributeName', 'calcMode', 'keyTimes', 'repeatCount', 'refX', 'refY'
    ]) {
      expect(domAttributeName(name), name).toBe(name)
    }
  })

  it('不认识的名字原样透传', () => {
    expect(domAttributeName('data-id')).toBe('data-id')
    expect(domAttributeName('aria-label')).toBe('aria-label')
    expect(domAttributeName('someProp')).toBe('someProp')
  })
})
