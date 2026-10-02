/**
 * VOBS CLI Banner — Mathematical Bold Sans-Serif
 * 𝗩𝗢𝗕𝗦 𝗖𝗟𝗜
 * Signals First · Zero Re-renders · Ultra Lightweight
 *
 * The banner is left-aligned with a fixed indent rather than horizontally
 * centered. Centering depends on the terminal column width and per-glyph
 * render width, neither of which is reliably knowable, so it drifts as the
 * window resizes. Fixed indent is stable across any terminal size.
 *
 * ⚠️ 这里**只放品牌字形，不放版本号**。版本号曾以数学粗体常量 `𝘃𝟭.𝟬` 的形式写死在这里，
 * 而它就是 `--version` 的全部输出 —— 打印一个和 package.json 不符的版本比不打印更糟。
 * 真实版本统一由 `version.ts` 的 `cliVersion()` 提供。
 */

import { cliVersion } from './version.js'

const BANNER_LINE1 = '𝗩𝗢𝗕𝗦 𝗖𝗟𝗜'
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

/** Show single-line version banner (used for --version)：真实版本号，不是品牌字形。 */
export function showBanner(): void {
  console.log(`${INDENT}${BANNER_LINE1} v${cliVersion()}`)
}

/** Show the dev server start banner */
export function showDevBanner(): void {
  console.log()
  console.log(`${INDENT}${BANNER_LINE1} v${cliVersion()}`)
  console.log()
}