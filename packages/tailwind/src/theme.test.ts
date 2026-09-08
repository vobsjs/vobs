// @vitest-environment node

import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('@vobs/tailwind theme bridge', () => {
  it('does not depend on @vobs/ui token names', async () => {
    const source = await readFile(new URL('./theme.css', import.meta.url), 'utf8')

    expect(source).not.toMatch(/var\(--(?:bg|text|border|status|radius)-/u)
    expect(source).toContain('--color-brand: var(--vobs-brand-primary')
    expect(source).toContain('--color-foreground: var(--vobs-neutral-foreground')
    expect(source).toContain('--color-surface: var(--vobs-neutral-surface, var(--vobs-neutral-background')
    expect(source).toContain('--spacing-vobs-md: var(--vobs-spacing-md')
  })

  it('uses the Vobs theme boundary for dark variants', async () => {
    const source = await readFile(new URL('./theme.css', import.meta.url), 'utf8')

    expect(source).toContain('@custom-variant dark')
    expect(source).toContain('[data-vobs-mode="dark"]')
  })
})
