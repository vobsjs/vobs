/*
 * **Corpus of common AI mistakes + coverage measurement** (P4 and P2 merged).
 *
 * ## Why they were merged into one thing
 *
 * - **P4 (evaluation)** wants "how many typical AI shapes the compile stage can intercept"
 * - **P2 (silent-failure hunting)** wants "which 'legal at compile time, wrong at runtime' shapes are still uncovered"
 *
 * They are two views of the same data: **each corpus entry declares which rule should intercept it,
 * or that it is "currently silent"**. The tests assert the **status quo**, so:
 * - covered entries = the evaluation's denominator and numerator
 * - entries with `silent: true` = **P2's work list** (visible, not memory-dependent)
 *
 * ## Why the corpus is "React-shaped"
 *
 * Most AI errors come from React priors. And vobs differs from React in a few **fundamental** ways
 * (the component body runs once, no deps arrays, JSX is an instance not a description object). So the corpus picks shapes
 * **perfectly correct in React, wrong in vobs** — that is the most expensive class.
 *
 * ## The two uses of this file
 *
 * 1. **Regression**: if a covered shape ever goes silent again, the test turns red
 * 2. **Improvement direction**: `silent: true` entries are the next diagnostics to add (see docs/silent-failures.md)
 */
import { describe, expect, it } from 'vitest'
import { compileWithSourceMap } from './index'
import { analyzeSource } from './analyze'

interface Mistake {
  /** Why this is a common AI mistake (one sentence). */
  readonly why: string
  /** The typical mistaken source code. */
  readonly source: string
  /** Which code is expected to intercept it; `null` means **currently silent** (P2's work list). */
  readonly caughtBy: string | null
  /**
   * Explanation for "silent" entries: **why it is deliberately not done yet**.
   * Every silent entry must state its reason — otherwise it looks like an oversight.
   */
  readonly silentNote?: string
}

const CORPUS: readonly Mistake[] = [
  {
    why: 'In React, `const node = <X/>; return cond ? node : null` is perfectly legal (description objects are rebuilt at will); in vobs the node is created eagerly.',
    source: 'export function P(){ const node = <Picker el={p.value} />; return open.value ? node : null }',
    caughtBy: 'VOBS_C108'
  },
  {
    why: 'In React, `return cond ? <A/> : null` re-evaluates on every render; in vobs the component body runs once, and the top-level return has no parent/anchor either.',
    source: 'export function P(){ return cond.value ? <div>a</div> : null }',
    caughtBy: 'VOBS_C104'
  },
  {
    why: 'In React, `cond ? <A/> : <B/>` is the most common conditional render; in vobs, at the top-level return, both branches being JSX **freezes all the same**.',
    source: 'export function P(){ return cond.value ? <div>a</div> : <div>b</div> }',
    caughtBy: 'VOBS_C107'
  },
  {
    why: 'In React, pulling a derived value into a variable is natural (recomputed every render); in vobs the component body runs once — that is a snapshot.',
    source: [
      "import { state } from '@vobs/vobs'",
      'export function Page() {',
      '  const count = state(0)',
      '  const doubled = count.value * 2',
      '  return <div>{doubled}</div>',
      '}'
    ].join('\n'),
    caughtBy: 'VOBS_C118'
  },
  {
    why: 'The React `useEffect(fn, [deps])` declares dependencies explicitly, and writing state inside an effect is routine; in vobs dependencies are auto-collected, and writing a signal you read is a loop.',
    source: [
      "import { effect, state } from '@vobs/vobs'",
      'export function P() {',
      '  const count = state(0)',
      '  effect(() => { count.value = count.value + 1 })',
      '  return <div>{count.value}</div>',
      '}'
    ].join('\n'),
    caughtBy: 'VOBS_C210'
  },
  {
    why: 'A React effect may be async (awaiting the Promise just goes unawaited, but the deps array keeps it safe); in vobs dependencies are auto-collected + the Promise is never awaited, and everything before the first await is synchronous.',
    source: 'export function P(){ effect(async () => { await load() }) }',
    caughtBy: 'VOBS_C106'
  },
  {
    why: 'In React, JSX constants at module top level are common (`const MENU = <Item/>`) because there is no "renderer not initialized" phase.',
    source: 'export const MENU = <div>顶层</div>',
    caughtBy: 'VOBS_C105'
  },
  {
    /*
     * Since 2026-10-28, the **simple shapes** `cond && list` / `cond ? list : null` are auto-routed by the compiler
     * to insertShow (a conditional container + keyed insertList inside it) and no longer warn —
     * the corpus keeps the **still-warning** mixed shape (node and list branches; the compiler cannot safely rewrite it).
     */
    why: 'In React, `{cond ? <Empty/> : list.map(...)}` (an empty state mixed with a list) is common; in vobs the list branch will not go through insertList (the compiler only auto-routes insertShow for the simple "list branch + null/false branch" shapes; mixed shapes need a manual split: the empty state on its own line {empty.value ? <Empty/> : null}, the list hoisted into a direct child expression).',
    source: 'export function P(){ return <div>{open.value ? <b>empty</b> : items.value.map(i => <li key={i}/>)}</div> }',
    caughtBy: 'VOBS_C232'
  },

  {
    /*
     * The diagnostic was added 2026-10-28 (VOBS_C233): it delivers exactly the **binding analysis** silentNote originally demanded —
     * only receivers whose name is verifiably bound to `state(...)` are reported; a plain array's push is never reported.
     * It used to sit on silent-failures.md's silent list; it is now the 6th item to go "from silent to diagnosed".
     */
    why: 'In React, an in-place array push takes effect via re-rendering; in vobs the reference is unchanged and the signal never notifies.',
    source: 'export function P(){ const list = state([1]); list.value.push(2); return <div>{list.value.length}</div> }',
    caughtBy: 'VOBS_C233'
  },

  /*
   * 2026-10-28: what was once the only silence (an early return-null guard in the component body) has been absorbed by C107 Case 3 —
   * test = empty-guard return + a JSX return in the host function (a render function) + the isJsxOnlyCaller
   * exemption for named helpers; empty guards in pure data functions (`T | null` modeling) are not reported. Repo-wide measured false positives: 0.
   * **The silent list is now zero.**
   */
  {
    /*
     * This one is **partially** covered: reading a lookup result into a const is caught by C118
     * (the component body runs once → it is a snapshot). But the "whitelist lookup miss → silent blank" half
     * **cannot be caught statically** (the whitelist lives in the application) and is mitigated at runtime: `@vobs/icon-core`
     * emits a **name-deduplicated warning** (66350b9) when the definition is empty, naming the icon in the console.
     */
    why: 'In React, looking up a component table by name is common; in vobs, a lookup result stored into a const is a snapshot (caught by C118), '
      + 'while a lookup miss leaving a silent blank can only be named by the runtime.',
    source: 'export function P(){ const icon = ICONS[name.value]; return <div>{icon}</div> }',
    caughtBy: 'VOBS_C118'
  },
  {
    why: 'The React `setState(newValue)` does not depend on a read; in vobs `.set()` is synonymous with `.value =`, so writing what you read is still a loop.',
    source: [
      "import { effect, state } from '@vobs/vobs'",
      'export function P() {',
      '  const count = state(0)',
      '  effect(() => { count.set(count.value + 1) })',
      '  return <div>{count.value}</div>',
      '}'
    ].join('\n'),
    caughtBy: 'VOBS_C210'
  },
  {
    /*
     * Finora deadly sin §1-3 (confirmed twice): when C210 reports "(unnamed signal)" there is no way to tell which signal —
     * since 2026-10-28 a static rule warns right at the **creation site** (VOBS_C120).
     */
    why: 'In React DevTools the component name is the label; vobs runtime diagnostics rely on debug names, and when `state(0)` without a name errors it only shows "(unnamed signal)".',
    source: [
      "import { effect, state } from '@vobs/vobs'",
      'export function P() {',
      '  const count = state(0)',
      '  effect(() => { count.value = count.value + 1 })',
      '  return <div>{count.value}</div>',
      '}'
    ].join('\n'),
    caughtBy: 'VOBS_C120'
  }
]

/** The codes this source raises on the static channel (compiler + analyzer, matching vobs check). */
function codesOf(source: string): string[] {
  const compiled = compileWithSourceMap(source, { filename: 'a.tsx' }).diagnostics.map(item => item.code)
  const analyzed = analyzeSource(source, 'a.tsx').map(item => item.code)
  return [...new Set([...compiled, ...analyzed])]
}

const caught = CORPUS.filter(item => item.caughtBy !== null)
const silent = CORPUS.filter(item => item.caughtBy === null)

describe('AI mistake corpus: shapes already intercepted at compile time (regression)', () => {
  for (const item of caught) {
    it(`${item.caughtBy} ← ${item.why.slice(0, 40)}…`, () => {
      expect(codesOf(item.source), `this should have been intercepted by ${item.caughtBy}, but nothing was reported`).toContain(item.caughtBy)
    })
  }
})

describe('AI mistake corpus: the silent list (zeroed since 2026-10-28)', () => {
  it('**the silent count must stay at zero** — a new silent entry must go through the full "deliberately not doing it" process', () => {
    /*
     * Historically there were two silences here (in-place array mutation, an early return-null guard in the component body),
     * both absorbed (C233 / C107 Case 3). If a `caughtBy: null` ever appears in the corpus again,
     * this assertion turns red — reminding to run the full process: write the silentNote explaining why not,
     * record it in silent-failures.md, and let the coverage figure fall accordingly.
     */
    expect(silent, 'a new silent entry appeared — add a silentNote and sync docs/silent-failures.md')
      .toHaveLength(0)
  })
})

describe("coverage (P4's measurement surface)", () => {
  it('tallies and prints the coverage — the numerator/denominator of "how many AI mistakes the compile stage can intercept"', () => {
    const total = CORPUS.length
    const hit = caught.length
    const ratio = Math.round((hit / total) * 100)
    console.log(`  AI mistake corpus coverage: ${hit}/${total} (${ratio}%)`)
    console.log(`  currently silent (P2 work list): ${silent.length}`)
    for (const item of silent) console.log(`    - ${item.why.slice(0, 60)}`)
    expect(total).toBeGreaterThan(0)
    // Coverage is recorded only; no threshold is set — a threshold would tempt people to write "easy-to-pass corpus entries"
  })
})
