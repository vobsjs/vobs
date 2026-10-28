// @vitest-environment node

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { compile } from 'tailwindcss'

/*
 * This is **structural validation of the cascade precondition, not visual verification**.
 *
 * Mechanism (.artifacts/reports/tailwind.md blocker #2): per the CSS spec, **unlayered normal
 * declarations outrank any layered declaration** (regardless of specificity), so the
 * `* { box-sizing: border-box; margin: 0; padding: 0; }` in `ui/src/styles/base.css`, if left
 * unlayered, would override this entry's `layer(utilities)` `m-*` / `p-*`. The fix has two
 * halves: (1) the entry declares the layer order explicitly, (2) the reset goes into the
 * `base` layer as a whole.
 *
 * ⚠️ **What this file proves is "which layer a rule lands in" (structure), not "margin is
 * really 4px in the browser" (visuals)**: jsdom does not apply external stylesheets, let alone
 * perform cascade/layer-order computation; `tailwindcss`'s `compile()` only does compile-time
 * layering. Real visual results must be verified in a real browser (see the blocker #2 report).
 *
 * Another measured finding (this half of the construction plan must deviate from the original
 * text, with arguable reasons):
 * `@import "./theme.css" layer(base);` makes `compile()` **throw**
 * "`@custom-variant` cannot be nested" (the `@custom-variant dark (…)` in theme.css cannot be
 * nested inside any `@layer`). And theme.css's output would not stay outside layers anyway:
 * `@custom-variant` produces no CSS, `@theme inline` produces no declarations, and variables
 * produced by `@theme` (non-inline) are placed by Tailwind into `@layer theme` (measured).
 * So what really must be upheld is the **property** — "the entry output contains no unlayered
 * rule block" — not the exact syntax of some import. Item 3 below asserts this property against
 * the compiled output: adding a plain rule directly into theme.css / styles.css (e.g.
 * `* { margin: 0 }`) turns the test red (measured).
 */
const entriesDir = resolve(process.cwd(), 'packages/tailwind/src')
const requireFromTailwind = createRequire(resolve(process.cwd(), 'packages/tailwind/package.json'))
const LAYER_ORDER = '@layer theme, base, components, utilities;'

async function loadStylesheet(id: string, base: string): Promise<{ path: string; base: string; content: string }> {
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

/** Keep code only, strip comments — this file's own prose references `@import` / `@layer`, so assertions must look at code. */
function codeOnly(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** Brace balance (comments stripped first); returning 0 means all blocks in this CSS chunk are closed. */
function braceDepth(css: string): number {
  const stripped = codeOnly(css)
  let depth = 0
  for (const ch of stripped) {
    if (ch === '{') depth++
    else if (ch === '}') depth--
  }
  return depth
}

/** Strip all `@layer …;` statements and `@layer …{ … }` blocks; returns the remaining "unlayered" content. */
function stripLayersAndComments(css: string): string {
  const kept: string[] = []
  let i = 0
  while (i < css.length) {
    const open = css.indexOf('@layer', i)
    if (open === -1) {
      kept.push(css.slice(i))
      break
    }
    kept.push(css.slice(i, open))
    const semi = css.indexOf(';', open)
    const brace = css.indexOf('{', open)
    if (brace === -1 || (semi !== -1 && semi < brace)) {
      i = semi + 1 // `@layer a, b;` statement
      continue
    }
    let depth = 0
    let j = brace
    for (; j < css.length; j++) {
      if (css[j] === '{') depth++
      else if (css[j] === '}' && --depth === 0) {
        j++
        break
      }
    }
    i = j // the whole `@layer x { … }` block is dropped
  }
  return kept.join('').replace(/\/\*[\s\S]*?\*\//g, '').trim()
}

describe('@vobs/tailwind layer order (cascade precondition, not visual verification)', () => {
  it('entry declares the full layer order theme, base, components, utilities (base must rank below utilities)', () => {
    const source = codeOnly(readFileSync(resolve(entriesDir, 'styles.css'), 'utf8'))
    expect(source).toContain(LAYER_ORDER)
    // the @layer statement is the only rule allowed before @import; the reverse invalidates @import
    expect(source.indexOf(LAYER_ORDER)).toBeLessThan(source.indexOf('@import'))
    // utilities is the last item in the layer order = highest priority (this half is the root of blocker #2)
    expect(LAYER_ORDER.indexOf('base')).toBeLessThan(LAYER_ORDER.indexOf('utilities'))
  })

  it('every stylesheet without @import under ui/src/styles sits entirely inside @layer base', () => {
    /*
     * blocker #2 only named base.css, but the same mechanism covers every @vobs/ui stylesheet:
     * components/vui/toast/message are likewise **unlayered normal declarations** and likewise
     * outrank layer(utilities). Enumerate by file here (instead of only checking base.css) so
     * that adding a file or missing one turns red.
     *
     * `tokens.css` is excluded because **staying outside layers is correct for it**: it only
     * defines custom properties (`--*`), and custom property inheritance is layer-independent;
     * moreover it must remain independently consumable as `@vobs/ui/tokens.css`.
     * `styles.css` is the aggregation entry (only @imports); it cannot and should not be layered.
     */
    for (const file of ['base.css', 'components.css', 'vui.css', 'toast.css', 'message.css']) {
      const css = codeOnly(readFileSync(resolve(process.cwd(), 'packages/ui/src/styles', file), 'utf8'))
      const open = css.indexOf('@layer base {')
      expect(open, `${file} must sit entirely inside @layer base`).toBeGreaterThan(-1)
      // CSS forbids @import inside an @layer block — a whole file can only be layered if it has no @import
      expect(css, `${file} must not contain @import`).not.toContain('@import')
      // brace balance from `@layer base {` to end of file = the whole file is inside the layer (not just one section)
      expect(braceDepth(css.slice(open)), `${file}: the @layer base block does not extend to end of file`).toBe(0)
      // no second layer-order statement / nested layer block may appear inside, otherwise layer membership is no longer single-layer
      expect(css.slice(open).match(/@layer/g)?.length, `${file} should contain no further @layer inside`).toBe(1)
    }
    // this reset must be in the layer: an unlayered `* { margin: 0 }` would outrank layer(utilities)'s m-*/p-*
    const baseCss = codeOnly(readFileSync(resolve(process.cwd(), 'packages/ui/src/styles/base.css'), 'utf8'))
    expect(baseCss.slice(baseCss.indexOf('@layer base {'))).toContain('* { box-sizing: border-box; margin: 0; padding: 0; }')
  })

  it('compiled entry output has no unlayered rule blocks (the safety precondition for keeping theme.css unlayered)', async () => {
    const output = await buildEntry('styles.css', ['flex', 'p-4', 'm-4', 'text-brand', 'dark:flex'])
    // the layer-order statement must actually land in the output, not just live in a source comment
    expect(output).toContain(LAYER_ORDER)
    // utilities must land in the utilities layer (inside the layer block)
    expect(output).toContain('@layer utilities {')
    expect(output).toContain('.m-4')
    // theme.css is safe because "it produces no declarations": after stripping all layered blocks, nothing should remain
    expect(stripLayersAndComments(output)).toBe('')
  })
})
