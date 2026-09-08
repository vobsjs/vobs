// @vitest-environment node

import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

async function readEntry(name: string): Promise<string> {
  return readFile(new URL(`./${name}`, import.meta.url), 'utf8')
}

describe('@vobs/tailwind CSS entries', () => {
  it('provides utilities without Tailwind Preflight', async () => {
    const source = await readEntry('styles.css')

    expect(source).toContain('tailwindcss/theme.css')
    expect(source).toContain('tailwindcss/utilities.css')
    expect(source).toContain('./theme.css')
    expect(source).not.toContain('tailwindcss/preflight.css')
  })

  it('provides an isolated prefixed utilities entry', async () => {
    const source = await readEntry('styles-prefixed.css')

    expect(source).toContain('tailwindcss/utilities.css" prefix(vobs)')
    expect(source).toContain('./theme.css')
    expect(source).not.toContain('tailwindcss/preflight.css')
  })
})
