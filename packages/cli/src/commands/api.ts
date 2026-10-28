import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { logger } from '../utils/logger.js'

/**
 * `vobs api [query]` — a **queryable index** of the framework's exports.
 *
 * ## Why it is needed
 *
 * The biggest share of LLM errors is **guessing API shapes wrong**. This round alone I
 * stumbled three times over "the capability existed but I didn't know" (nearly
 * re-implementing `inferStateDebugName`, nearly turning `LayoutChildren` into a breaking
 * change, not knowing `vobs check` scans everything) — and I have **source access**. GLM's
 * guessing odds are even worse.
 *
 * Rather than let it guess, let it query. This beats any documentation: **the model can
 * look it up instead of guessing.**
 *
 * ## Data source: the **built `dist/*.d.ts`**
 *
 * It reads the type declarations **shipped with the package**, so:
 * - it matches what users actually get (not an approximation of the source)
 * - versions are accurate (after upgrading the framework the index follows automatically)
 *
 * ## Name index only (a deliberate scope)
 *
 * This version only answers "**which package exports which name**" — the most commonly
 * guessed-wrong link, extractable purely statically with zero false positives.
 * Signatures/parameters (heavier, needs type resolution) are left for later.
 *
 * ## Known limitations
 *
 * **About 0.7% of entries show no kind** (measured: 10 of 1359 are unknown).
 * Inspected one by one, they are **not parser defects but bundler de-confliction rename
 * residue**:
 *
 * ```
 * captcha/index.d.ts:2   export { C as Captcha, a as CaptchaAnswer, b as CaptchaChallenge, … }
 * payment/index.d.ts:1   export { i as alipay } from './index-B1aUR7Vt.js'
 * ```
 *
 * That is, names like `a`/`b`/`alipay` **do appear in the export list** (listing them is
 * accurate); the local declarations they point at (`i` and friends) just have no
 * recognizable declaration header.
 *
 * **Single-letter names are deliberately not filtered**: that would make the output
 * prettier but would turn into "I guess which exports don't count as API" — the value of
 * this index is exactly that "names and package names are accurate, nothing invented".
 *
 * **The unknown kind is hidden from text output** (a column saying "unresolved" would make
 * people think the tool is broken); `--json` still keeps the field for tooling.
 *
 * (Evolution: single pass → **1353/1355 all unknown**; two-pass → 196/1359 = 14%;
 * adding **alias mapping** (`index_X as X`) and **cross-package kind fallback** →
 * **10/1359 = 0.7%**. The rationale for both fixes is in the `exportAliases` and
 * `globalKinds` comments above.)
 *
 * **No workspace package is imported**: only node:fs / node:path. This round already had
 * two incidents of "imported a workspace package without declaring the dependency"
 * (explodes the moment cwd changes); this command avoids that by design.
 */
export interface ApiOptions {
  /** Query string (substring match, case-insensitive). Lists everything when omitted. */
  readonly query?: string
  /** Machine-readable output (for AI and tools). */
  readonly json?: boolean
  /** Repository root; defaults to the current working directory. */
  readonly dir?: string
}

export interface ApiEntry {
  /** Package name, e.g. `@vobs/runtime`. */
  readonly package: string
  /** Export name, e.g. `state`. */
  readonly name: string
  /** Export kind (function / type / const / class / unknown). */
  readonly kind: 'function' | 'type' | 'const' | 'class' | 'unknown'
}

/**
 * **First pass**: names that are **exported** on this line (whatever they are).
 *
 * Only "externally visible" matters — because built type declarations are mostly
 * **re-export barrels** (`export { a, b } from './x'`); the real declarations live in child
 * files, not on the same line.
 */
function exportedNames(line: string): string[] {
  const text = line.trim()
  if (text.startsWith('//') || text.startsWith('*') || text.startsWith('/*')) return []

  // export { a, b as c } / export type { T }
  const group = text.match(/^export\s+(?:type\s+)?\{([^}]*)\}/u)
  if (group) {
    return group[1]
      .split(',')
      .map(part => part.trim())
      .filter(Boolean)
      .map(part => {
        const asMatch = part.match(/\bas\s+([A-Za-z_$][\w$]*)$/u)
        return (asMatch ? asMatch[1] : part).replace(/^type\s+/u, '').trim()
      })
      .filter(name => /^[A-Za-z_$][\w$]*$/u.test(name))
  }

  const single = text.match(/^export\s+(?:declare\s+)?(?:function|class|interface|type|const|let|var)\s+([A-Za-z_$][\w$]*)/u)
  return single ? [single[1]] : []
}

/**
 * **Alias mapping**: `publicName → localName` from `export { localName as publicName }`.
 *
 * ## Why it is required (measured: one of the main causes of the 14% unknown rate)
 *
 * Bundlers **rename**. Measured in `@vobs/payment/dist/index-B1aUR7Vt.d.ts`:
 *
 * ```ts
 * import { AlipaySdkConfig } from 'alipay-sdk'
 * declare const index_AlipaySdkConfig: typeof AlipaySdkConfig     // ← declared as index_…
 * ```
 *
 * While the export list says `export { index_AlipaySdkConfig as AlipaySdkConfig }`.
 * `exportedNames` extracts the **public name** (`AlipaySdkConfig`);
 * `declarationKinds` records the **local name** (`index_AlipaySdkConfig`) — so they never
 * join → `unknown`.
 *
 * The fix: record aliases first, then join via `public name → local name → kind`, two hops.
 */
function exportAliases(line: string): Array<[publicName: string, localName: string]> {
  const text = line.trim()
  if (text.startsWith('//') || text.startsWith('*') || text.startsWith('/*')) return []
  const group = text.match(/^export\s+(?:type\s+)?\{([^}]*)\}/u)
  if (!group) return []
  const out: Array<[string, string]> = []
  for (const part of group[1].split(',')) {
    const asMatch = part.trim().match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/u)
    if (asMatch) out.push([asMatch[2], asMatch[1]])
  }
  return out
}

/**
 * **Second pass**: name → kind.
 *
 * No `export` prefix is **required** here — built declarations are often just
 * `declare function state(...)`, exported together by `export { state }` at the end of the
 * file.
 *
 * Previously there was only one pass, and it required `export declare …`; measured, **1353
 * of 1355 entries were `unknown`** (see the known limitations in the file header). The
 * two-pass approach brings that number down.
 */
function declarationKinds(text: string): Map<string, ApiEntry['kind']> {
  const kinds = new Map<string, ApiEntry['kind']>()
  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim()
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue
    const fn = trimmed.match(/^(?:export\s+)?(?:declare\s+)?function\s+([A-Za-z_$][\w$]*)/u)
    if (fn) { kinds.set(fn[1], 'function'); continue }
    const cls = trimmed.match(/^(?:export\s+)?(?:declare\s+)?class\s+([A-Za-z_$][\w$]*)/u)
    if (cls) { kinds.set(cls[1], 'class'); continue }
    const iface = trimmed.match(/^(?:export\s+)?(?:declare\s+)?(?:interface|type)\s+([A-Za-z_$][\w$]*)/u)
    if (iface) { kinds.set(iface[1], 'type'); continue }
    const constant = trimmed.match(/^(?:export\s+)?(?:declare\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/u)
    if (constant) { kinds.set(constant[1], 'const'); continue }
  }
  return kinds
}

/** Collect every .d.ts under a package's dist. */
function declarationFiles(distDir: string): string[] {
  const out: string[] = []
  const walk = (dir: string, depth: number): void => {
    if (depth > 4) return
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) { walk(full, depth + 1); continue }
      if (entry.name.endsWith('.d.ts')) out.push(full)
    }
  }
  walk(distDir, 0)
  return out
}

/** Build the index: read each package's package.json for the real name, then scan its dist type declarations. */
export function buildApiIndex(root: string): ApiEntry[] {
  const packagesDir = path.join(root, 'packages')
  if (!existsSync(packagesDir)) return []
  const index: ApiEntry[] = []
  /** Collected "package|name" keys (deduplication). */
  const exported = new Set<string>()
  /** "package|name" → kind (collected in the second pass, joined back into the index at the end). */
  const kinds = new Map<string, ApiEntry['kind']>()
  /** "package|public name" → local name (`export { local as public }`, see exportAliases note). */
  const aliases = new Map<string, string>()
  /**
   * **Cross-package** name → kind (no package name).
   *
   * Why it exists: `@vobs/vobs` is one long re-export line (`export { AsyncBoundary, … }`),
   * while the declarations of those names live in **sibling packages** (`@vobs/dom` /
   * `@vobs/kit`) dists. A per-package mapping can never find them → measured, `@vobs/vobs`
   * had 100 unknowns (half of all 196).
   *
   * Used only as a **fallback**: the per-package map is consulted first (more precise, can
   * tell same-named exports apart across packages); the global map only when that fails.
   */
  const globalKinds = new Map<string, ApiEntry['kind']>()
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const pkgDir = path.join(packagesDir, entry.name)
    let manifest: { name?: string; private?: boolean }
    try { manifest = JSON.parse(readFileSync(path.join(pkgDir, 'package.json'), 'utf8')) } catch { continue }
    // Internal/unpublished packages stay out of the index (users cannot install them)
    if (manifest.name === undefined || manifest.private === true) continue
    const distDir = path.join(pkgDir, 'dist')
    if (!existsSync(distDir)) continue
    for (const file of declarationFiles(distDir)) {
      let text: string
      try { text = readFileSync(file, 'utf8') } catch { continue }
      /*
       * **Two passes**:
       *  1. collect "what is this name" (declarations often lack an export prefix → all missed before)
       *  2. collect "which names are exported" (the export list and the declaration are not on the same line)
       *  3. finally join: export name → kind
       * Order does not matter (each writes its own map), but there **must be two passes** —
       * with one pass, 1353/1355 were unknown.
       */
      for (const [name, kind] of declarationKinds(text)) {
        kinds.set(`${manifest.name}|${name}`, kind)
        if (!globalKinds.has(name)) globalKinds.set(name, kind)
      }
      for (const line of text.split(/\r?\n/u)) {
        for (const [publicName, localName] of exportAliases(line)) {
          aliases.set(`${manifest.name}|${publicName}`, localName)
        }
        for (const name of exportedNames(line)) {
          const key = `${manifest.name}|${name}`
          if (exported.has(key)) continue
          exported.add(key)
          index.push({ package: manifest.name, name, kind: 'unknown' })
        }
      }
    }
  }
  /*
   * Join: export name → kind. Three-step fallback, each used only when the previous fails:
   *   ① same-named declaration in this package (most precise)
   *   ② this package's declaration after resolving the alias (bundler renames, e.g.
   *      `index_AlipaySdkConfig as AlipaySdkConfig`)
   *   ③ global same-named declaration (cross-package re-exports, e.g. vobs → dom/kit)
   * If none match, it stays unknown — **nothing invented**.
   */
  for (const item of index) {
    const direct = kinds.get(`${item.package}|${item.name}`)
    if (direct !== undefined) { (item as { kind: ApiEntry['kind'] }).kind = direct; continue }
    let localName = aliases.get(`${item.package}|${item.name}`)
    // Aliases can chain (a as b, b as c); a few rounds of resolution suffice, avoiding an infinite loop via cycles
    for (let hop = 0; hop < 4 && localName !== undefined; hop++) {
      const byAlias = kinds.get(`${item.package}|${localName}`)
      if (byAlias !== undefined) { (item as { kind: ApiEntry['kind'] }).kind = byAlias; break }
      localName = aliases.get(`${item.package}|${localName}`)
    }
    if ((item as { kind: ApiEntry['kind'] }).kind !== 'unknown') continue
    const fallback = globalKinds.get(item.name)
    if (fallback !== undefined) (item as { kind: ApiEntry['kind'] }).kind = fallback
  }
  return index.sort((a, b) => a.name.localeCompare(b.name) || a.package.localeCompare(b.package))
}

export async function apiCommand(options: ApiOptions = {}): Promise<void> {
  const root = path.resolve(options.dir ?? process.cwd())
  const index = buildApiIndex(root)
  if (index.length === 0) {
    logger.error('No index data found. Build first: pnpm run build:packages')
    process.exitCode = 1
    return
  }

  const query = options.query?.trim()
  const hits = query === undefined || query === ''
    ? index
    : index.filter(item =>
      item.name.toLowerCase().includes(query.toLowerCase())
      || item.package.toLowerCase().includes(query.toLowerCase()))

  if (options.json === true) {
    process.stdout.write(`${JSON.stringify({ query: query ?? null, total: index.length, hits }, null, 2)}\n`)
    return
  }

  if (hits.length === 0) {
    logger.error(`No exports match "${query}".`)
    console.log('(The index comes from built dist type declarations — if you just added an export, run pnpm run build:packages first.)')
    process.exitCode = 1
    return
  }

  console.log(query === undefined || query === ''
    ? `Framework export index (${index.length} entries, sorted by name):\n`
    : `Exports matching "${query}" (${hits.length}/${index.length}):\n`)
  for (const item of hits) {
    // When kind is unknown the column is hidden — it means "unresolved", not "this export has no kind"
    const kind = item.kind === 'unknown' ? '' : item.kind
    console.log(`  ${item.name.padEnd(34)} ${item.package.padEnd(22)} ${kind}`.trimEnd())
  }
  if (hits.length > 60) console.log(`\n(${hits.length - 60} more entries; use --json for the full list)`)
}
