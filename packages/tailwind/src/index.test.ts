// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { vobsTailwind } from './index'

describe('@vobs/tailwind', () => {
  it('exposes the Tailwind Vite plugin array', () => {
    const plugins = vobsTailwind()

    expect(Array.isArray(plugins)).toBe(true)
    expect(plugins.length).toBeGreaterThan(0)
    expect(plugins.every(plugin => typeof plugin.name === 'string')).toBe(true)
  })

  it('passes through Tailwind Vite optimize options', () => {
    const plugins = vobsTailwind({ optimize: false })

    expect(plugins.length).toBeGreaterThan(0)
  })
})
