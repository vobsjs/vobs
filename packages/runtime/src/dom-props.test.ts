import { describe, expect, it } from 'vitest'
import { domAttributeName, isPropertyName } from './dom-props'

describe('isPropertyName — which names must go through the property channel', () => {
  it('names whose attribute form is ineffective or mismatched go through property', () => {
    // innerHTML / textContent aren't HTML attributes at all; setAttribute is completely ineffective
    expect(isPropertyName('innerHTML')).toBe(true)
    expect(isPropertyName('innerText')).toBe(true)
    expect(isPropertyName('textContent')).toBe(true)
    // defaultValue's attribute form is called value — the name doesn't match
    expect(isPropertyName('defaultValue')).toBe(true)
    expect(isPropertyName('defaultChecked')).toBe(true)
    // These two have no corresponding attribute
    expect(isPropertyName('indeterminate')).toBe(true)
    expect(isPropertyName('currentTime')).toBe(true)
  })

  it('form state and common properties', () => {
    for (const name of ['value', 'checked', 'selected', 'disabled', 'multiple', 'readOnly', 'required', 'tabIndex', 'colSpan']) {
      expect(isPropertyName(name)).toBe(true)
    }
  })

  it('attributes and data-*/aria-* are unaffected', () => {
    for (const name of ['className', 'title', 'id', 'data-id', 'aria-label', 'strokeWidth', 'someProp']) {
      expect(isPropertyName(name)).toBe(false)
    }
  })
})

describe('domAttributeName — JSX prop name → DOM attribute name', () => {
  it('HTML aliases', () => {
    expect(domAttributeName('className')).toBe('class')
    expect(domAttributeName('htmlFor')).toBe('for')
    expect(domAttributeName('autoComplete')).toBe('autocomplete')
    expect(domAttributeName('spellCheck')).toBe('spellcheck')
  })

  it('SVG presentation attributes convert to kebab-case (camelCase would be silently ineffective)', () => {
    expect(domAttributeName('strokeWidth')).toBe('stroke-width')
    expect(domAttributeName('strokeLinecap')).toBe('stroke-linecap')
    expect(domAttributeName('fillOpacity')).toBe('fill-opacity')
    expect(domAttributeName('textAnchor')).toBe('text-anchor')
    expect(domAttributeName('stopColor')).toBe('stop-color')
    expect(domAttributeName('pointerEvents')).toBe('pointer-events')
    expect(domAttributeName('markerStart')).toBe('marker-start')
  })

  /*
   * Regression: SVG attribute naming is mixed — presentation attributes are kebab-case
   * while structural attributes really are camelCase. It was once implemented as
   * "camelCase always converts to kebab-case", which broke the names below
   * (viewBox → view-box etc.), and the breakage was completely silent: an attribute the
   * browser doesn't know, the shape still doesn't render, no error at all.
   */
  it('SVG structural attributes must stay camelCase', () => {
    for (const name of [
      'viewBox', 'preserveAspectRatio', 'pathLength', 'startOffset', 'textLength', 'lengthAdjust',
      'markerWidth', 'markerHeight', 'markerUnits', 'clipPathUnits', 'gradientUnits',
      'patternUnits', 'maskUnits', 'spreadMethod', 'zoomAndPan', 'baseFrequency', 'numOctaves',
      'attributeName', 'calcMode', 'keyTimes', 'repeatCount', 'refX', 'refY'
    ]) {
      expect(domAttributeName(name), name).toBe(name)
    }
  })

  it('unknown names pass through as-is', () => {
    expect(domAttributeName('data-id')).toBe('data-id')
    expect(domAttributeName('aria-label')).toBe('aria-label')
    expect(domAttributeName('someProp')).toBe('someProp')
  })
})
