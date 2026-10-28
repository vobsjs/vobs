// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { defaultDarkTheme, defaultLightTheme } from './index'

/*
 * A theme token's key = the CSS variable name written out, and it must be **identical** to the CSS
 * consumer's name.
 *
 * The JS side used to write `colorScheme` (flattening to `--vobs-colorScheme`), while the repo's
 * only consumer, `packages/ui/src/styles/base.css`
 * (`:root { color-scheme: var(--vobs-color-scheme, dark) }`), reads the hyphenated spelling —
 * the two spellings never met, so that rule **always hit its fallback** and native controls /
 * scrollbars / the body background never followed the theme.
 *
 * This test ties both sides together: the variable names provided by the JS default tokens must
 * genuinely appear in base.css's references.
 */
const baseCss = readFileSync(resolve(process.cwd(), 'packages/ui/src/styles/base.css'), 'utf8')
const tokensCss = readFileSync(resolve(process.cwd(), 'packages/ui/src/styles/tokens.css'), 'utf8')

describe('theme ↔ CSS variable name contract', () => {
  it('the default themes no longer use camelCase spelling (which missed the CSS consumer)', () => {
    expect(Object.keys(defaultLightTheme)).not.toContain('colorScheme')
    expect(Object.keys(defaultDarkTheme)).not.toContain('colorScheme')
    expect(Object.keys(defaultLightTheme)).toContain('--vobs-color-scheme')
    expect(defaultLightTheme['--vobs-color-scheme']).toBe('light')
    expect(defaultDarkTheme['--vobs-color-scheme']).toBe('dark')
  })

  it('the CSS side really consumes this variable name (the two sides cannot drift apart again)', () => {
    expect(baseCss).toContain('var(--vobs-color-scheme')
    expect(tokensCss).toContain('--vobs-color-scheme:')
  })
})
