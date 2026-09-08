// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { vobsTailwind } from './index'

describe('@vobs/tailwind', () => {
  it('暴露 Tailwind Vite 插件数组', () => {
    const plugins = vobsTailwind()

    expect(Array.isArray(plugins)).toBe(true)
    expect(plugins.length).toBeGreaterThan(0)
    expect(plugins.every(plugin => typeof plugin.name === 'string')).toBe(true)
  })

  it('透传 Tailwind Vite 优化选项', () => {
    const plugins = vobsTailwind({ optimize: false })

    expect(plugins.length).toBeGreaterThan(0)
  })
})
