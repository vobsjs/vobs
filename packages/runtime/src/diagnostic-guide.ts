/**
 * Queryable explanations for diagnostic codes (the data source of `vobs explain`).
 *
 * ## Why this exists
 *
 * In that round I only learned the C104–C108 rules by **reading the source**; an AI
 * sees nothing but the single error-message line. Rust's `rustc --explain E0382` is
 * the same kind of facility, widely regarded as "unfriendly to humans but AI-friendly"
 * — because the rules **can be looked up instead of guessed**.
 *
 * ## Why it lives in `@vobs/runtime`
 *
 * Both `@vobs/compiler` (static rules) and `@vobs/vobs` (runtime guards) **depend on it**,
 * and diagnostic explanations must describe codes from both sides. Placing it here lets
 * both packages and the CLI read **the same copy**.
 *
 * ## Coverage (honestly labeled)
 *
 * Currently covers the codes that can be stated precisely from framework semantics.
 * For codes without an entry, `vobs explain` **says so explicitly** instead of inventing
 * a plausible-sounding explanation — guessed docs are worse than none (`VOBS_C102`/`C103`
 * and other builder-internal errors are not yet covered).
 *
 * Each entry must answer four questions (miss one and it degrades into "just an error
 * line"): **what it is** / **why it's a trap** / **the correct way** / **the counter-example**.
 */
export interface DiagnosticGuideRewrite {
  /** Minimal form that triggers the code (a before that machines can diff-and-replace directly). */
  readonly wrong: string
  /** Form rewritten per the fix (after) — guide-verification guarantees zero diagnostics. */
  readonly correct: string
}

export interface DiagnosticGuide {
  readonly code: string
  /** Default severity (static rule and runtime may differ; this is the typical human-facing value). */
  readonly severity: 'error' | 'warning'
  /** One sentence: what this code is about. */
  readonly title: string
  /** Why it happens and why it is a trap. */
  readonly why: string
  /** The correct way to write it. */
  readonly correct: string
  /** Counter-example (the form that triggers it). */
  readonly wrong: string
  /**
   * Directly executable rewrite pairs (before/after). **These fixtures are the verification
   * target of guide-verification.test.ts** (rewriting per `correct` must yield zero
   * diagnostics) — the metadata is the source of truth, tests consume it, so the two cannot
   * drift. `vobs explain --json` and `diagnostics.md` pass them through verbatim to AI.
   */
  readonly rewrites?: readonly DiagnosticGuideRewrite[]
}

export const DIAGNOSTIC_GUIDES: readonly DiagnosticGuide[] = [
  {
    code: 'VOBS_C104',
    severity: 'warning',
    title: 'Conditional return in the component body is evaluated only once (run-once freeze)',
    why: 'The component body executes only once, so this return is frozen at mount time and later signal changes never switch it again. '
      + 'It is only a problem when "the return value gets rendered", which is why the rule only flags forms containing JSX.',
    correct: 'Put the condition in a JSX child position (`<div>{cond ? <A/> : <B/>}</div>`) — the compiler generates a reactive conditional factory; '
      + 'use `<Show when={cond}>` for visibility-only toggling; use `<RouterView/>` for routing.',
    wrong: '`return cond.value ? <A/> : null`',
    rewrites: [
      {
        wrong: 'export function P(){ return open.value ? <div>a</div> : null }',
        correct: 'export function P(){ return <div>{open.value ? <div>a</div> : null}</div> }'
      }
    ]
  },
  {
    code: 'VOBS_C105',
    severity: 'warning',
    title: 'JSX written at module top level',
    why: 'Module top-level expressions run at import-evaluation time, **before** `createVobs()` has installed the renderer, '
      + 'so it crashes at runtime with "renderer not initialized" — and the stack points at the importing site, far away from the real cause.',
    correct: 'Move the JSX into a component body; for constants that need "data + nodes", use a **function returning nodes** instead '
      + '(`const menu = () => [<Item/>]`).',
    wrong: '`const MENU = <KitMenuItem />` (at module top level)',
    rewrites: [
      {
        wrong: 'export const MENU = <div>顶层</div>',
        correct: 'export const menu = () => <div>顶层</div>'
      }
    ]
  },
  {
    code: 'VOBS_C106',
    severity: 'warning',
    title: 'An async function was passed to effect / lifecycle',
    why: 'Code in an async function **before the first await** executes synchronously, and those reads/writes land inside the effect\'s tracking scope — '
      + '"the effect merely calls a function" does not mean it has no dependencies. And effect does not await the returned Promise, so the cleanup contract does not line up either.',
    correct: 'To declare dependencies only, use `effect(on(deps, () => { … }))`; for a one-off side effect use `onMount`; '
      + 'for async data fetching use `@vobs/resource`; if you must keep it, wrap explicitly in `untrack(() => { void fn() })`.',
    wrong: '`effect(async () => { if (!s.value.on) return; s.value = { on: true } })`',
    rewrites: [
      {
        wrong: 'export function P(){ effect(async () => { await load() }) }',
        correct: 'export function P(){ effect(on(deps, () => { void load() })) }'
      }
    ]
  },
  {
    code: 'VOBS_C107',
    severity: 'warning',
    title: 'The component body\'s return reads a signal (run-once freeze)',
    why: 'The top-level `return` of a component has **no parent/anchor**, while reactive conditional rendering needs a position where content can be swapped — '
      + 'so `return cond.value ? <A/> : <B/>` **freezes even when both branches are JSX** (verified: the compiled output contains no insertDynamic).',
    correct: 'Use `<RouterView/>` for routing branches; `<Show when={cond}>` to keep mounted and toggle visibility only; '
      + 'put ordinary conditional rendering in a JSX child position.',
    wrong: '`return router.currentRoute.value.path === "/login" ? <Login/> : <Shell/>`',
    rewrites: [
      {
        wrong: 'export function P(){ return cond.value ? <div>a</div> : <div>b</div> }',
        correct: 'export function P(){ return <div>{cond.value ? <div>a</div> : <div>b</div>}</div> }'
      },
      {
        wrong: 'export function P(){\n  if (loading.value) return null\n  return <div>done</div>\n}',
        correct: 'export function P(){\n  return <div>{loading.value ? null : "done"}</div>\n}'
      }
    ]
  },
  {
    code: 'VOBS_C108',
    severity: 'warning',
    title: 'JSX stored in a variable (node created eagerly)',
    why: '`const node = <X/>` instantiates the component and runs its body **on that very line** (`<X/>` is `createComponent(...)`, '
      + 'not a React-style description object). Any condition evaluated afterwards happens after creation, so the component may render with empty values and crash.',
    correct: '① Write it in a JSX child position; ② at the component\'s top-level return **do not switch to a ternary** (it hits C107), use `Show`/`RouterView`; '
      + '③ to reuse, use a **function returning nodes** (lazy evaluation); ④ never store nodes in data constants (they would enter SSG serialization); '
      + '⑤ when internal state must survive, keep it permanently mounted + pass a state object + null-check inside.',
    wrong: '`const node = <Picker el={p.value} />; return open.value ? node : null`',
    rewrites: [
      {
        wrong: 'export function P(){ const node = <div>x</div>; return open.value ? node : null }',
        correct: 'export function P(){ const render = () => <div>x</div>; return open.value ? render() : null }'
      }
    ]
  },
  {
    code: 'VOBS_C118',
    severity: 'warning',
    title: 'Signal read into a constant in the component body',
    why: 'The component body executes only once, so the constant is a **snapshot from creation time** and never updates when the signal changes later — '
      + 'the UI looks "stuck", with no error at all.',
    correct: 'Move the read into JSX (`<div>{count.value}</div>`) or inside a callback body; use `memo` for derived values.',
    wrong: '`const snapshot = count.value; return <div>{snapshot}</div>`',
    rewrites: [
      {
        wrong: 'export function Page() {\n  const count = state(0)\n  const snapshot = count.value\n  return <div>{snapshot}</div>\n}',
        correct: 'export function Page() {\n  const count = state(0, \'count\')\n  return <div>{count.value}</div>\n}'
      }
    ]
  },
  {
    code: 'VOBS_C210',
    severity: 'warning',
    title: 'effect writes to a signal it itself depends on (self-subscription)',
    why: 'Dependencies are **auto-collected**: any signal read while the effect runs becomes a dependency, and writing to it re-schedules the effect → loop. '
      + 'Moreover, **code in a called function before its first await also runs synchronously**, so "just calling a function" does not mean no dependencies.',
    correct: 'Prefer `effect(on(deps, () => { … }))` (the callback runs in an untrack scope, structurally unable to self-subscribe); '
      + 'second choice is a derived value / `memo`; the last resort is `untrack(() => { x.value = next })`. '
      + 'The static rule matches by variable name and can false-positive (same-name local shadowing), hence warning; '
      + 'the runtime guard judges by the real dependency set and is an error.',
    wrong: '`effect(() => { count.value = count.value + 1 })`',
    rewrites: [
      {
        wrong: 'export function P() {\n  const count = state(0)\n  effect(() => { count.value = count.value + 1 })\n  return <div>{count.value}</div>\n}',
        correct: 'export function P() {\n  const count = state(0, \'count\')\n  effect(on(count, () => { count.value = count.value + 1 }))\n  return <div>{count.value}</div>\n}'
      }
    ]
  },
  {
    code: 'VOBS_C211',
    severity: 'error',
    title: 'The same effect runs many times within a short period',
    why: 'Most likely self-subscription, or two effects triggering each other. Broader than C210 — mutually triggering loops need not have a single self-subscription point.',
    correct: 'Inspect these effects\' writes to signals: prefer `effect(on(deps, fn))`; use `memo` for values derived from other signals; '
      + 'the last resort is `untrack`. Note that code in a called function before its first await also runs synchronously.',
    wrong: 'Two effects each read a signal the other writes'
  },
  {
    code: 'VOBS_C232',
    severity: 'warning',
    title: 'A list written inside a ternary / && branch',
    why: 'When a ternary contains both a node and a list, the list branch **does not compile to `insertList`** — it goes through polymorphic insertion '
      + 'and loses keyed reuse (reordering rebuilds the whole segment instead of moving nodes). '
      + 'There is an even more easily missed cost: **a change of the branch condition itself also rebuilds the entire list** — '
      + 'the compiled output is `insertDynamicValue(el, null, () => cond.value ? items.map(…) : null)`, and that getter reads `cond`. '
      + 'A direct child expression compiles to `insertList(el, null, () => items, renderItem)`, which subscribes only to the list source. '
      + 'How much it matters depends on **item count and whether items hold state**: a few stateless buttons is negligible; '
      + 'dozens of items, or items holding focus/input/scroll state, must be fixed.',
    correct: 'Hoist the list into a **direct** child expression: write the conditional branch first, then `{items.map(...)}` separately.',
    wrong: '`{cond ? items.value.map(i => <li key={i}/>) : <b/>}`',
    rewrites: [
      {
        wrong: 'export function P(){ return <div>{open.value ? items.value.map(i => <li key={i}/>) : <b/>}</div> }',
        correct: 'export function P(){ return <div>{open.value ? <b/> : null}{items.value.map(i => <li key={i}/>)}</div> }'
      }
    ]
  },
  {
    code: 'VOBS_C233',
    severity: 'warning',
    title: 'Array signal mutated in place via mutators (push/sort/splice…)',
    why: 'These methods mutate **the same array reference** — a signal uses reference equality to decide whether to notify, '
      + 'so subscribed JSX never updates and the UI stays on stale data with no error at all.',
    correct: 'Array updates must **swap the reference**: for push use `list.value = [...list.value, item]`; '
      + 'for sort/truncate, copy first then mutate: `list.value = [...list.value].sort(...)`.',
    wrong: '`list.value.push(item)` (with `list` bound to `state([...])`)',
    rewrites: [
      {
        wrong: 'export function P() {\n  const list = state([1, 2])\n  const add = () => { list.value.push(3) }\n  return <button onClick={add}>{list.value.length}</button>\n}',
        correct: 'export function P() {\n  const list = state([1, 2], \'list\')\n  const add = () => { list.value = [...list.value, 3] }\n  return <button onClick={add}>{list.value.length}</button>\n}'
      },
      {
        wrong: 'export function P() {\n  const user = state({ name: \'a\' })\n  const rename = () => { user.value.name = \'b\' }\n  return <button onClick={rename}>{user.value.name}</button>\n}',
        correct: 'export function P() {\n  const user = state({ name: \'a\' }, \'user\')\n  const rename = () => { user.value = { ...user.value, name: \'b\' } }\n  return <button onClick={rename}>{user.value.name}</button>\n}'
      }
    ]
  },

  {
    code: 'VOBS_C120',
    severity: 'warning',
    title: 'state() called without a debug name',
    why: 'Runtime diagnostics (e.g. C210 self-subscription, C211 loops) will display this signal as **"(unnamed signal)"** — '
      + 'with several signals on a page, you cannot tell from the error which one it is. All debugging cost is deferred to the moment of failure.',
    correct: 'Pass a debug name matching the variable as the second argument at creation: `const count = state(0, \'count\')`.',
    wrong: '`const count = state(0)`',
    rewrites: [
      {
        wrong: 'export function P() {\n  const count = state(0)\n  return <div>{count.value}</div>\n}',
        correct: 'export function P() {\n  const count = state(0, \'count\')\n  return <div>{count.value}</div>\n}'
      }
    ]
  },

  {
    code: 'VOBS_C234',
    severity: 'warning',
    title: 'The on callback reads a signal outside deps (untrack severs the edge)',
    why: 'The `on` callback runs in an **untrack scope** — signals read inside it **establish no subscription**. '
      + 'If you expected that signal to trigger this effect as well, updates are silently lost: the code runs and values are fresh, '
      + 'it is just that nobody is notified when it changes.',
    correct: 'Want it to trigger too → add it to deps: `on([a, b], fn)` (declaring is subscribing). '
      + 'If you only want the latest value, refreshed by deps (deliberately not subscribed) → you may ignore this, '
      + 'or make the intent explicit with `untrack(() => b.value)`.',
    wrong: '`effect(on([a], () => { use(b.value) }))` (changes of b will not trigger)',
    rewrites: [
      {
        wrong: 'export function P() {\n  const a = state(1, \'a\')\n  const b = state(2, \'b\')\n  effect(on([a], () => { console.log(a.value, b.value) }))\n  return <div>{b.value}</div>\n}',
        correct: 'export function P() {\n  const a = state(1, \'a\')\n  const b = state(2, \'b\')\n  effect(on([a, b], () => { console.log(a.value, b.value) }))\n  return <div>{b.value}</div>\n}'
      }
    ]
  },

  /* ---------- Builder / config layer (fills the gaps reported by --missing) ---------- */
  {
    code: 'VOBS_C002',
    severity: 'error',
    title: 'Boundary component missing a required prop',
    why: '`ResourceBoundary` / `ErrorBoundary` / `AsyncBoundary` each work through their respective prop: '
      + '`resource` decides which resource to subscribe, `fallback` what to render on error, `promise` which Promise to await. '
      + 'Without it, the compiler does not know what to mount and the runtime cannot establish the boundary — '
      + 'and the symptom is "the boundary **silently does not work**" (errors still bubble up, the resource is never subscribed), not a clear error message.',
    correct: '`<ResourceBoundary resource={userResource}>…</ResourceBoundary>`; '
      + '`<ErrorBoundary fallback={(e) => <Err error={e}/>}>…</ErrorBoundary>`; '
      + '`<AsyncBoundary promise={pending}>…</AsyncBoundary>`.',
    wrong: '`<ErrorBoundary>…</ErrorBoundary>` (missing `fallback`)'
  },
  {
    code: 'VOBS_C007',
    severity: 'error',
    title: 'Compiler plugin missing a name, or duplicate names',
    why: 'Plugins are deduplicated and ordered by `name`, and **order decides who transforms the AST first**. '
      + 'Without a name, or with two plugins sharing one, the output order of `transformPluginNodes` is nondeterministic — '
      + 'meaning "the same source compiles to different results on two runs". This kind of build nondeterminism is harder to debug '
      + 'than a crash, so this **throws directly** (`VobsError`) instead of issuing a warning.',
    correct: 'Give every plugin a unique, stable `name`: `{ name: "vobs-plugin-i18n", transform(...) {…} }`.',
    wrong: 'Two plugins both declare `{ name: "i18n" }`, or omit `name` entirely'
  },
  {
    code: 'VOBS_C101',
    severity: 'error',
    title: 'Unsupported JSX tag form',
    why: 'React accepts `<svg:rect>` (JSX namespace tags) and `<Foo.Bar>` (member expressions). '
      + 'vobs does not parse either form: they have no clear "component or DOM element" classification, '
      + 'and vobs distinguishes the two precisely by **casing** — guessing wrong sends the whole subtree down the wrong compilation path.',
    correct: 'Components use capitalized identifiers `<MyComponent/>`; DOM elements use lowercase tag names `<rect/>`; '
      + 'Fragments use `<Fragment>` or `<>…</>`.',
    wrong: '`<svg:rect/>`, `<Svg.Rect/>`'
  },
  {
    code: 'VOBS_C102',
    severity: 'warning',
    title: 'An on* prop bound to a nonexistent / non-canonical event name',
    why: 'Three cases, **graded separately**: '
      + '① the event parsed from `onFoo` neither follows the `on` + capital convention nor is a known DOM event '
      + '→ **the callback never fires, silently** (error); '
      + '② lowercase `onclick` only "happens to match" — rename it and it silently stops working (warning); '
      + '③ `onFoo` is an unknown event — it may be a custom event (ignorable) or a typo (warning). '
      + '**Error only when it "cannot possibly be right"**: this rule exists not to block anyone, '
      + 'but to surface "bound to a nonexistent event, callback never fires, and not a single hint".',
    correct: 'Write event handlers as `on` + a capitalized letter: `onClick` / `onDoubleClick` / `onPointerDown`. '
      + 'Rename props that were never event handlers; if you truly need a manual listener, use `addEventListener` inside an effect.',
    wrong: '`onclick={…}` (lowercase), `onClik={…}` (typo), `onFooBar={…}` (non-standard event)'
  },
  {
    code: 'VOBS_C103',
    severity: 'warning',
    title: 'map callback body fails "a single JSX expression" or "exactly one return"',
    why: 'The compiler relies on this shape to compile lists into **keyed reuse** (`insertList`: reconcile by key, move existing nodes). '
      + 'Once the callback body has multiple statements, or returns a Fragment, it can no longer be recognized → degrades to **polymorphic insertion**: '
      + 'every round **rebuilds every item**, `key` and keyed reuse are fully defeated (node identity lost on reorder, per-item state reset).',
    correct: 'Hoist computation out of `map` (or pre-derive with `memo`) so the callback body stays a "single JSX expression"; '
      + 'make each list item **one element** instead of wrapping it in a Fragment.',
    wrong: '`{items.map(i => { const t = f(i); return <li key={i}>{t}</li> })}` '
      + '`{items.map(i => <><li key={i}/></>)}`'
  }
]

/** Look up a guide by code; returns `undefined` when there is no entry (callers must handle that explicitly — do not invent one). */
export function findDiagnosticGuide(code: string): DiagnosticGuide | undefined {
  return DIAGNOSTIC_GUIDES.find(item => item.code === code)
}
