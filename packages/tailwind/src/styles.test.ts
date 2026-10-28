// @vitest-environment node

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { compile } from 'tailwindcss'

/*
 * This test originally only asserted "the source string contains `prefix(vobs)`" — a **false
 * green**: it looked like it verified the prefix takes effect, while Tailwind **silently
 * ignores** a `prefix()` written in `utilities.css` (measured: `.flex` was still generated).
 * Stylesheet behavior cannot be proven with string assertions, so this file wires in the real
 * compiler (`tailwindcss` is a declared dependency of this package; v4 exposes `compile`).
 * Relative specifiers (`./theme.css`) are resolved against the base Tailwind provides.
 */
const requireFromTailwind = createRequire(resolve(process.cwd(), 'packages/tailwind/package.json'))
const entriesDir = resolve(process.cwd(), 'packages/tailwind/src')

async function loadStylesheet(id: string, base: string): Promise<{ path: string; base: string; content: string }> {
  // Bare `tailwindcss` maps to index.css via the exports field; createRequire would resolve
  // it to the JS entry, so rewrite it
  const path = id.startsWith('.')
    ? resolve(base, id)
    : requireFromTailwind.resolve(id === 'tailwindcss' ? 'tailwindcss/index.css' : id)
  return { path, base: dirname(path), content: readFileSync(path, 'utf8') }
}

async function buildEntry(entry: string, candidates: readonly string[]): Promise<string> {
  const compiler = await compile(readFileSync(resolve(entriesDir, entry), 'utf8'), {
    base: entriesDir,
    loadStylesheet
  })
  return compiler.build([...candidates])
}

function readEntry(entry: string): string {
  return readFileSync(resolve(entriesDir, entry), 'utf8')
}

describe('@vobs/tailwind CSS entries', () => {
  it('styles.css generates unprefixed utilities and does not pull in Tailwind Preflight', async () => {
    const output = await buildEntry('styles.css', ['flex', 'p-4'])
    expect(output).toContain('.flex')
    expect(output).toContain('.p-4')
    expect(output).not.toContain('.vobs\\:flex')

    const source = readEntry('styles.css')
    expect(source).toContain('tailwindcss/theme.css')
    expect(source).toContain('./theme.css')
    expect(source).not.toContain('tailwindcss/preflight.css')
  })

  it('styles-prefixed.css really produces vobs:-prefixed utilities (compiler-verified)', async () => {
    const output = await buildEntry('styles-prefixed.css', ['flex', 'vobs:flex', 'vobs:p-4'])
    expect(output).toContain('.vobs\\:flex')
    expect(output).toContain('.vobs\\:p-4')
    // When the prefix is active, unprefixed class names must not appear — that is exactly
    // what "isolating third-party class name conflicts" means
    expect(output).not.toContain('.flex {')
    expect(output).not.toContain('.p-4 {')
  })
})
