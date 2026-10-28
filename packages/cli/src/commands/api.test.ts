/*
 * `vobs api` — a queryable index of the framework's exports.
 *
 * ## Why it is needed
 *
 * The biggest share of LLM errors is **guessing API shapes wrong**. This round alone I
 * stumbled three times over "the capability existed but I didn't know" (nearly
 * re-implementing `inferStateDebugName`, nearly turning `LayoutChildren` into a breaking
 * change, not knowing `vobs check` scans everything) — and I have **source access**.
 * Rather than let the model guess, let it query.
 *
 * ## What is locked in
 *
 * 1. The index comes from the **built `dist/*.d.ts`** (shipped with the package → matches
 *    what users actually get, versions accurate)
 * 2. **Unpublished internal packages stay out of the index** (users cannot install them;
 *    listing them only misleads)
 * 3. Queryable both by name and by package
 * 4. Known limitations remain **visible** (some kinds unresolvable; see api.ts comments) —
 *    no pretending of support
 */
import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildApiIndex } from './api'

const root = process.cwd()
const hasDist = existsSync(`${root}/packages/runtime/dist`)

describe.skipIf(!hasDist)('vobs api index', () => {
  const index = buildApiIndex(root)

  it('the index is non-empty and covers multiple packages', () => {
    expect(index.length).toBeGreaterThan(200)
    expect(new Set(index.map(item => item.package)).size).toBeGreaterThan(10)
  })

  it('**every API landed this round is findable** (one miss means that capability stays undiscoverable)', () => {
    const names = new Set(index.map(item => item.name))
    for (const name of ['state', 'effect', 'untrack', 'on', 'Show', 'ClientOnly', 'onMount', 'onDestroy', 'applyClassList', 'parseNumber']) {
      expect(names.has(name), `${name} not found — the capability is still undiscoverable`).toBe(true)
    }
  })

  it('can find which package a specific symbol lives in (the most common wrong guess)', () => {
    const entry = index.find(item => item.name === 'applyClassList')
    expect(entry?.package).toBe('@vobs/runtime')
  })

  it('**unpublished internal packages stay out of the index** (listing them only misleads)', () => {
    for (const pkg of ['dsh-plugin-vobs', 'dsh-plugin-vobs-console']) {
      expect(index.some(item => item.package === pkg), `${pkg} is a Git-installed plugin package; it must not appear in the npm index`).toBe(false)
    }
  })

  it('one entry per package + name pair (deduplicated)', () => {
    const keys = index.map(item => `${item.package}|${item.name}`)
    expect(new Set(keys).size, 'duplicates found').toBe(keys.length)
  })

  it('**kind-resolution coverage must not regress** — it was once 1353/1355 all unknown', () => {
    /*
     * Evolution: single pass → 1353/1355 all unknown; two-pass → 196/1359 (14%);
     * adding **alias mapping** and **cross-package kind fallback** → 10/1359 (0.7%).
     *
     * The threshold is 0.9 (currently 0.993) — it guards "those two fixes still exist",
     * not the exact value. Regressing to two-pass (0.86) or single-pass (0.001) turns red
     * immediately.
     */
    const named = index.filter(item => item.kind !== 'unknown').length
    const ratio = named / index.length
    expect(ratio, `kind resolution rate is only ${Math.round(ratio * 100)}% — was the alias mapping or the cross-package fallback removed?`)
      .toBeGreaterThan(0.9)
  })

  it('**cross-package re-exported** names still get kinds — half of the 14% → 0.7% improvement', () => {
    /*
     * `@vobs/vobs` is one long re-export line (`export { AsyncBoundary, … }`), while those
     * names are declared in **sibling packages** (@vobs/dom / @vobs/kit) dists. A
     * per-package mapping cannot find them → must fall back to the global same-name map.
     */
    const entry = index.find(item => item.name === 'AsyncBoundary' && item.package === '@vobs/vobs')
    expect(entry, 'AsyncBoundary should be in the @vobs/vobs index').toBeDefined()
    expect(entry!.kind, 'a cross-package re-exported name must not be unknown').not.toBe('unknown')
  })

  it('**bundler-renamed** names (`index_X as X`) also get kinds', () => {
    /*
     * The bundler renames the declaration to `index_AlipaySdkConfig`, then
     * `export { index_… as AlipaySdkConfig }`. The export name differs from the declaration
     * name → the alias mapping must bridge the two hops.
     */
    const entry = index.find(item => item.name === 'AlipaySdkConfig' && item.package === '@vobs/payment')
    expect(entry, 'AlipaySdkConfig should be in the @vobs/payment index').toBeDefined()
    expect(entry!.kind, 'an alias-exported name must not be unknown').not.toBe('unknown')
  })

  it('known symbols have the correct kinds (not "resolved but wrong")', () => {
    const kinds = new Map(index.map(item => [item.name, item.kind]))
    expect(kinds.get('state'), 'state should be a function').toBe('function')
    expect(kinds.get('onMount'), 'onMount should be a function').toBe('function')
  })

  it('every entry has a package name and a name', () => {
    for (const item of index) {
      expect(item.package.startsWith('@vobs/')).toBe(true)
      expect(item.name).toMatch(/^[A-Za-z_$][\w$]*$/u)
    }
  })
})
