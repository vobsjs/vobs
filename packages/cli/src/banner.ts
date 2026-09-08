/**
 * VOBS CLI Banner — Mathematical Bold Sans-Serif
 * 𝗩𝗢𝗕𝗦 𝗖𝗟𝗜 𝘃𝟭.𝟬
 * Signals First · Zero Re-renders · Ultra Lightweight
 *
 * The banner is left-aligned with a fixed indent rather than horizontally
 * centered. Centering depends on the terminal column width and per-glyph
 * render width, neither of which is reliably knowable, so it drifts as the
 * window resizes. Fixed indent is stable across any terminal size.
 */

const BANNER_LINE1 = '𝗩𝗢𝗕𝗦 𝗖𝗟𝗜 𝘃𝟭.𝟬'
const BANNER_TAGLINE = 'Signals First · Zero Re-renders · Ultra Lightweight'

/** Fixed left indent applied to every banner line (2 spaces). */
const INDENT = '  '
const DIM = '\x1b[2m'
const RESET = '\x1b[0m'

/** Show full banner (used for logo command, --help) */
export function showLogo(): void {
  console.log()
  console.log()
  console.log(`${INDENT}${BANNER_LINE1}`)
  console.log()
  console.log(`${INDENT}${DIM}${BANNER_TAGLINE}${RESET}`)
  console.log()
  console.log()
}

/** Show single-line version banner (used for --version) */
export function showBanner(): void {
  console.log(`${INDENT}${BANNER_LINE1}`)
}

/** Show the dev server start banner */
export function showDevBanner(): void {
  console.log()
  console.log(`${INDENT}${BANNER_LINE1}`)
  console.log()
}