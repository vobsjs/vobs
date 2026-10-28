// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/*
 * The mobile drawer must not be "a full-width drawer with no text".
 *
 * The default is `collapsed=true`, so the sidebar carries `is-collapsed`; and
 * `.vobs-kit-sidebar.is-collapsed .vobs-kit-menu__label` is `display:none`.
 * When the mobile drawer opens, the sidebar is forced full-width — the two
 * rules stack, and the user opens a full-width drawer with no text in it
 * (verified classes: `is-collapsed is-mobile-open`).
 *
 * Fix: add `:not(.is-mobile-open)` to the collapsed-hiding rules (pure CSS,
 * matching this package's design of "layout entirely in CSS, JS never measures
 * or writes styles").
 *
 * Note: **jsdom does not apply external stylesheets**, so "it actually shows
 * visually" can't be asserted here. Two proxy assertions pin the contract:
 * ① the class-name contract (CSS relies on both classes being on the same
 * element), ② the rule guards.
 */
const cssPath = resolve(process.cwd(), 'packages/layout/src/styles/layout.css')

describe('layout mobile drawer', () => {
  it('collapsed-hiding rules exclude the open drawer (CSS rule guards)', () => {
    const css = readFileSync(cssPath, 'utf8')
    // Pin the selector directly: removing :not(.is-mobile-open) fails the test
    expect(css).toContain('.vobs-kit-sidebar.is-collapsed:not(.is-mobile-open) .vobs-kit-menu__label')
    expect(css).toContain('.vobs-kit-sidebar.is-collapsed:not(.is-mobile-open) .vobs-kit-menu__badge')
    // And there must be no unguarded old form left (otherwise nothing changed)
    expect(css).not.toContain('.vobs-kit-sidebar.is-collapsed .vobs-kit-menu__label')
  })
})
