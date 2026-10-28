/**
 * vobs framework contract body — the source of `vobs agent-doc` output.
 *
 * Why a TS module instead of a .md file: reading a file relies on `import.meta.url`
 * to resolve a relative path, and **under a full vitest run modules get transformed**,
 * so `import.meta.url` points at a virtual path and
 * `new URL('../../src/templates/…')` cannot find the file (measured: the 8 cases pass
 * standalone and all 8 fail in a full run). Inlining the string is **immune to bundling
 * and transformation**, and also removes the need to copy templates at publish time.
 *
 * Content is generated from `packages/cli/src/templates/agent-contract.md` (the .md is kept
 * as the readable source); to change the contract, edit the .md and regenerate,
 * or edit the string here directly.
 */
export const AGENT_CONTRACT = `# vobs Framework Contract (read before writing code)

vobs is a **compiled / fine-grained / reactive** framework with a mental model that differs from React in several **fundamental** ways.
Every rule below comes from a real incident; **violations usually compile fine and only fail at runtime**.

> This document is generated from the framework version by \`vobs agent-doc\` — do not hand-edit the generated block.
> The parenthetical after each rule is the **diagnostic code the framework reports when the rule is violated**.

## 1. Component bodies execute exactly once (run-once)

**The component function body runs only once at creation time**; afterwards, only subscribed positions in JSX update.

- ❌ \`const filtered = list.value.filter(...)\` — a one-time snapshot that never updates afterwards
- ✅ Put derivations in JSX: \`<div>{list.value.filter(...).map(render)}</div>\`
- ❌ Taking a snapshot in the component body for a callback: \`const v = name.value; onClick={() => save(v)}\`
- ✅ Re-read inside the callback: \`onClick={() => save(name.value)}\`
- Pass dynamic props in getter form, never as already-evaluated values

## 2. Conditional rendering: **do not \`return\` branches from the component body** (\`VOBS_C107\` / \`VOBS_C104\`)

A \`return\` in the component body that reads a signal is frozen at mount time; **all three forms break identically**:

\`\`\`tsx
return cond.value ? <A/> : <B/>        // ❌ frozen
if (cond.value) return <A/>            // ❌ frozen
return cond.value ? <A/> : null        // ❌ frozen
\`\`\`

At the top-level \`return\` there is **no parent/anchor**, so even when both branches are JSX the branch never re-evaluates.

| Scenario | Use |
|---|---|
| **Route branching** | **\`<RouterView/>\`** (declarative; internally \`insertDynamic\` + \`resetKey\`) |
| Keep mounted, toggle visibility only | **\`<Show when={cond}>\`** (toggles \`hidden\` + \`inert\`; focus/scroll/internal state survive) |
| Class toggling only | \`class="base" classList={{ 'is-on': cond.value }}\` |
| Ordinary conditional rendering | Put it in a **JSX child position**: \`<div>{cond.value ? <A/> : <B/>}</div>\` |

## 3. Do not write signals you read inside an effect (\`VOBS_C210\` / \`VOBS_C211\`)

**Dependencies are collected automatically**: **any** signal read while the effect runs becomes a dependency.

- ❌ \`effect(() => { count.value++ })\` — read + write on the same signal = self-subscription loop
- ❌ \`effect(() => { if (session.value) void sync() })\` — **"just calling a function" does not mean "no dependencies"**:
  the callee's code **before its first \`await\`** runs **synchronously**, and the signals it reads are charged to the effect
- ✅ To declare dependencies only: **\`effect(on(deps, () => { … }))\`** — the callback runs in an untrack scope,
  so functions it calls never reverse-subscribe to any signal they touch
- ✅ Use \`memo\` for derived values; do not "read A, write B"
- \`untrack(() => { X.value = next })\` is the last-resort escape hatch

**Never call async functions inside an effect** (\`VOBS_C106\`): \`effect\` does not await it,
and everything before the first \`await\` is synchronous. Use **\`@vobs/resource\`** for async data fetching.

### The dependency graph is a **dynamic graph** shaped at runtime (AI criterion: is this edge visible in the text?)

The dependency set is **cleared and re-collected on every re-run** — "which signals appear in the code" ≠ "which edges are subscribed at this moment":

- **Reads inside conditional branches are conditional dependencies**: \`if (a.value) use(b.value)\` — on rounds where a is false,
  **b is not subscribed** (branch not taken, no dependency edge). Dynamic keys \`store[key.value]\` work the same way.
  Do not assume "every signal appearing in the text is an unconditional dependency", nor "once read, subscribed forever"
- **Pin** the dependency set: \`effect(on(deps, fn))\` — deps are **subscribed at declaration time** (whether or not fn uses them);
  **sever** an edge with \`untrack(fn)\`. These two primitives make dependency relations explicitly visible in the text
- ⚠️ **on's callback runs in an untrack scope**: signals read inside the callback are **not subscribed** —
  \`effect(on([a], () => { uses b.value }))\` will not fire when b changes (\`VOBS_C234\`).
  If it should fire, add it to deps; if you only want the latest value, deliberately skip subscribing and write \`untrack\` to state the intent

## 4. Client-side side effects and SSR

- Timers / listeners / \`matchMedia\` / \`localStorage\` → **start in \`onMount\`, clean up in \`onDestroy\`**
  (**do not hand-write \`typeof window\` guards**)
- When the **rendered output itself** depends on the browser (window size / \`localStorage\` backfill / \`Date.now\` / random values)
  → **\`<ClientOnly fallback={…}>\`** (both sides render the fallback on the first pass, so hydration matches)
- JSX at module top level is **forbidden** (\`VOBS_C105\`): import evaluation runs before the renderer is installed

### Async data: \`@vobs/resource\` (Query / Mutation in one)

- **\`resource(fetcher)\` returns three signals: data / error / loading** — async state lives right in
  the dependency graph; \`{res.data.value}\` and \`{res.loading.value}\` in JSX subscribe normally.
  **There is no second async mental model**; stop gluing async together with effect + a manual loading state
- **Key changes re-fetch automatically; stale requests are cancelled automatically** (AbortSignal):
  \`resource({ key: () => [userId.value], fetcher })\` — the key reads signals; when inputs change it invalidates and re-pulls automatically;
  **do not** watch + fetch inside an effect (the \`VOBS_C106\` trap)
- **data is \`T | null\`**: null until loaded; the type system forces null checks — \`!\` assertions are strictly forbidden
- **Writes**: mutate the cache directly with \`mutate(next)\`; optimistic updates with a request via \`optimistic(next, action)\`;
  cross-entry invalidation via \`client.invalidate(key)\`. In-flight stale results never overwrite newer data (revision guard)
- **Pair the render side with \`<AsyncBoundary resource={…}>\`** (\`VOBS_C002\`: a missing prop reports directly) —
  do not hand-assemble loading/error branches outside the boundary
- SSR: \`dehydrate()/hydrate()\` serialization; **call \`resetDefaultResourceClient()\` per request**
  (process-level cache; failing to reset = cross-request data leakage)

## 5. Lists and data

- **Array updates must swap the reference**: \`list.value = [...list.value, item]\`;
  in-place \`push\` / field mutation **does not trigger updates**
- A JSX **child position** accepts only four forms: component tag / element / two-branch ternary / \`.map()\`
- Data structures store **pure descriptions only** (strings/styles/structural fields); **never put node objects into data constants**
  (SSG serialization will blow up; when the output contains \`[object Xxx]\` the framework reports an error directly)

### Platform: prefer platform-native capabilities (the vobs renderer operates real DOM)

- **Platform-native elements are lowercase JSX tags** — the renderer creates real DOM directly: \`<dialog>\`,
  \`<details>\`, \`<template>\` and other Web platform primitives are used with their ordinary semantics.
  **Prefer platform capabilities; do not build equivalents by hand** (hand-written modals, hand-written disclosures)
- **Network requests go through \`@vobs/http\`**: AbortSignal cancellation, and \`debugContext\` wired into
  devtools network tracing — bare \`fetch\` gets neither request tracing nor cancel coordination
- **Async state goes through \`@vobs/resource\`** (see the section above) — hand-written \`loading\` signals + effect fetching
  is a double anti-pattern (\`VOBS_C106\`)
- **Styling goes through \`@vobs/tailwind\`** (official integration); component-level customization uses \`--vobs-*\` token hooks
  (see each component's docs); never hard-code color values in business code

## 6. Input

- **Numeric input goes through \`parseNumber\`** (built into \`<Field type="number">\`):
  empty / invalid / out-of-range input is **not committed**; the previous value is kept
  — \`Number('') === 0\` would wipe the input to 0 and cascade zeros into sibling dimensions
- Bind \`<select>\` value directly; **do not add a ref fallback** (timing fixed in 1.5.1+)

## 7. Icons and SVG

- **Write SVG directly in JSX** (\`<svg><path/></svg>\`; 1.7.4+ creates and hydrates per namespace)
- Icons must be **registered in the whitelist**; on a lookup miss \`@vobs/icon-core\` warns and names the icon (but you should still register it)

## 8. Self-test before committing

\`\`\`bash
pnpm run check:source            # = vobs check: static analysis + **compiler diagnostics**, whole repo in one listing
pnpm run check:source -- --no-compiler   # static analysis only (faster)
pnpm run check:runtime           # runs guardrails per route in a real browser (needs Chrome)
pnpm run check:runtime:interact  # additionally clicks every button and triggers every input
\`\`\`

> Before 1.8.8, \`vobs check\` **did not run the compiler**, so \`C104\`/\`C105\`/\`C106\`/\`C107\`/\`C108\`
> **never appeared there** (only \`vite build\` saw them). The rule sets on both sides are now merged; \`check:source\` is the real whole-repo entry point.

### Runtime self-verification (agents can call this themselves once the dev server is up)

- \`GET /__vobs/agent-state\` (HTTP endpoint on the vite dev server): returns a runtime snapshot for every open page —
  each effect's **current subscription set**, the last 20 update trigger chains, and guardrail verdicts.
  After generating code, an agent first runs \`check_source_snippet\` (static pre-write self-check) → writes → once the page loads,
  \`curl localhost:<port>/__vobs/agent-state\` to read the snapshot and verify that "dependency edges match expectations",
  without waiting for a human to run checks
- Reports are snapshot-based (100ms throttle, bucketed per page); \`vobs check:runtime --json\` is its
  batch form (guardrail verdicts for all routes)

---

## Forbidden list (scan before generating; each row is intercepted by its C code)

| Do not write | Caught by | Write instead |
|---|---|---|
| \`const x = signal.value\` in the component body, then used as \`{x}\` in JSX | \`C118\` | Read \`.value\` directly in JSX, or \`memo(() => ...)\` |
| \`const x = props.y\` in the component body, then used as \`{x}\` in JSX | \`C118\` | \`const x = () => props.y\`, used in JSX as \`{x()}\` |
| Top-level \`return cond.value ? <A/> : <B/>\` / \`if (cond.value) return null\` | \`C107\` | Put the condition inside a JSX child; routes use \`RouterView\` |
| \`const node = <X/>\` stored in a variable, then conditionally rendered | \`C108\` | A function returning the node: \`const r = () => <X/>\` |
| \`effect(async () => { ... })\` | \`C106\` | \`effect(on(deps, fn))\`; async data fetching via \`@vobs/resource\` |
| \`effect(() => { s.value = s.value ... })\` (read + write on the same signal) | \`C210\` | \`effect(on(s, fn))\`; escape hatch \`untrack\` |
| \`list.value.push(...)\` / \`X.value.field = v\` | \`C233\` | Swap the reference: \`list.value = [...list.value, item]\` |
| \`on([a], () => { b.value })\` (read but not subscribed) | \`C234\` | If it should fire, put it in deps: \`on([a, b], fn)\` |
| \`state(0)\` without a debug name | \`C120\` | \`state(0, 'count')\` (same name as the variable) |
| \`const M = <X/>\` at module top level | \`C105\` | A function returning the node: \`const m = () => <X/>\` |

## One-line cheat sheet

| Topic | One-liner |
|---|---|
| Component body | Runs once; put derivations in JSX |
| Callbacks | Re-read \`.value\` when fired |
| Conditional rendering | Routes use \`RouterView\`, visibility uses \`Show\`; never return branches from the component body |
| effect | Never write signals you read; use \`on(deps, fn)\` |
| async | Never stuff it into an effect; use \`@vobs/resource\` |
| Client side | \`onMount\`/\`onDestroy\`/\`ClientOnly\`; never hand-write \`typeof window\` |
| Lists | Swap the reference |
| Numbers | \`parseNumber\` |
| SVG | Write it directly |
| Self-test | \`check:source\` + \`check:runtime\` |
`
