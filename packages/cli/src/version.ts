import { readFileSync } from 'node:fs'

/**
 * The **single source** of the CLI version: reads this package's `package.json` directly —
 * the banner, the `--help` header, and scaffold outputs all take it from here.
 * **Hard-coding version strings elsewhere is forbidden.**
 */
let cached: string | undefined

export function cliVersion(): string {
  if (cached !== undefined) return cached
  try {
    const manifest = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8')
    ) as { version?: string }
    cached = manifest.version ?? '0.0.0'
  } catch {
    // When package.json cannot be read (bundled into a single file, etc.), never lie with a constant that looks like a real version
    cached = '0.0.0'
  }
  return cached
}
