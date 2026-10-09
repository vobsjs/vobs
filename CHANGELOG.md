# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.8.9] - 2026-10-09

### Added

- **`vobs explain [code]` — every diagnostic code is now queryable.** The rules behind
  `VOBS_C104`–`VOBS_C108` were previously only discoverable by reading the compiler's source; an
  error message told you *that* something was wrong, not *why* it was a trap or what to write
  instead. Each entry answers four questions — what it means, why it bites, the correct form, and a
  counter-example — and a code with no entry says so explicitly rather than inventing prose
  (**guessed documentation is worse than none**). `--json` for tools, `--missing` to list codes that
  exist in the source but have no entry. All 14 codes are covered; `--missing` now reports 0.
- **`vobs api [query]` — a queryable index of the framework's exports.** Reads the **built**
  `dist/*.d.ts` files, so the index matches what consumers actually install and tracks the version
  automatically. It answers "which package exports this name", which is the most commonly guessed
  wrong. Unpublished internal packages and the three Git-installed `dsh-plugin-*` packages are
  excluded. `--json` for tools.
- **`pnpm run checks` — a generated index of this repository's own capability surface.** This is the
  one gap neither of the above closes: both index *exported symbols*, while the repeated failure in
  this cycle was re-implementing an existing *script*. `docs/checks.md` is rendered from
  `package.json` plus each script's header comment, and `pnpm run checks -- --check` fails when the
  file drifts from the repository — **an index that drifts is worse than no index, because it makes
  people believe they checked.**
- **`AGENTS.md` for this repository.** `vobs agent-doc` generates guidance for *applications using*
  vobs; this repository had none for people and agents *working on* vobs. Every item is a real
  regression from this cycle, with the cost attached.
- **`docs/silent-failures.md` and an `ai-mistakes` corpus with measured coverage.** The corpus lists
  React-shaped mistakes, and each entry declares either the code that catches it or that it is
  currently silent — so the gaps are visible instead of remembered. Coverage is printed (10/12) and
  deliberately **not** asserted against a threshold, because a threshold invites writing easy
  entries.
- **`guide-verification` tests: every `fix` suggestion must work.** For each code, the counter-
  example must report it and the *rewritten* form must produce **zero** diagnostics. Diagnostic
  advice is code, and two pieces of it were wrong in this cycle: `VOBS_C108`'s first version moved
  users from a crash to a silently frozen view, and `VOBS_C104`'s recommended a CSS pattern real
  projects do not have.
- **Channel-reachability tests.** A declarative matrix asserting each code is visible on the
  channels it claims (`vobs check` / vite) and invisible on the ones it does not. The same defect —
  *a diagnostic that exists but is unreachable on a channel* — appeared three times in this cycle,
  each time found by hand.

### Fixed

- **`vobs api`'s `kind` resolution: 0.1% → 86% → 99%.** The first version scanned for
  `export declare …`, but bundled declarations are written `declare function x(...)` and exported
  from a separate list at the end of the file, so 1353 of 1355 entries had no kind. Two passes fixed
  the bulk; an alias map (`export { index_AlipaySdkConfig as AlipaySdkConfig }`) and a cross-package
  fallback (names re-exported by `@vobs/vobs` but declared in `@vobs/dom`/`@vobs/kit`) took it to
  10 of 1359. The remaining ten are bundler deconfliction artifacts (`export { C as Captcha, a as
  CaptchaAnswer, … }`); they are real entries in the export lists and are deliberately **not**
  filtered, because filtering them would mean guessing which exports are not real API.
- **The two `VOBS_C210` implementations gave different advice.** The static rule and the runtime
  guard each carried their own copy of the fix text; 1.8.5 improved only the runtime copy, so a user
  seeing the warning in `vite dev` was taught the older, patch-first remedy. Both now read one
  shared source in `@vobs/runtime`, which structurally prevents divergence.
- **Static `VOBS_C210` false-positived on same-name shadowing** — a local object declared in the
  effect body, or in the enclosing component body, was matched by name and reported as a
  self-subscription. Seven adversarial shapes measured one false positive; the rule now skips names
  whose binding is clearly not a signal (**an initializer that is not a call**), while deliberately
  keeping bindings produced by calls so imported signals and custom store factories are not lost.
  With the false positive gone the rule returned to `error`, since a real self-subscription is worth
  failing CI over.
- **`VOBS_C118` false-positived twice on shapes that re-evaluate.** An immediately-invoked arrow
  function in JSX child position re-runs whenever its dependencies change, so `const x = s.value`
  inside it is not a run-once snapshot; the same holds for a render helper called from a JSX
  expression. The rule now skips both. The discriminator deliberately matches only **callees**:
  `component={Card}` is a reference, not a call, so `Card` is still checked.
- **Analyzer diagnostics were invisible to vite, and compiler diagnostics were invisible to
  `vobs check`.** Both directions of the same defect. `analyzeSource` and its rules moved from
  `@vobs/cli` to `@vobs/compiler` so the plugin and the CLI share one implementation, and the vite
  plugin now emits analyzer findings through `this.warn` (analyzer *errors* go through the warning
  channel too, so a finding can never block a build).
- **`VOBS_C210` now explains why a signal has no name.** Measured cause: the compiler infers a debug
  name only for `state` imported **directly** from `@vobs/reactivity` / `@vobs/vobs`; a barrel
  re-export defeats it (the file extension is irrelevant). Resolving barrels needs cross-file module
  resolution, which a per-file transform cannot do — so the message states the cause and the
  one-line fix (`import` directly, or pass a name explicitly).
- **`VOBS_C232`'s advice now carries the measured cost.** Compiling both forms showed the branch
  version emits `insertDynamicValue(el, null, () => cond.value ? items.map(…) : null)`: every node is
  recreated, **and the branch condition itself rebuilds the whole list** because the getter reads it.
  The direct form emits `insertList(...)`, which reuses and moves entries. The message also states
  when it is worth acting on — a handful of stateless buttons is negligible; dozens of items, or
  items holding focus, input, or scroll state, are not.
- **`@vobs/layout` imported `@vobs/runtime` without declaring it.** A phantom dependency: it
  resolves from the monorepo root but not from a consumer's install. This one was introduced during
  this cycle, and the repository already had a check that catches it (`check:imports`, using a
  TypeScript AST rather than text matching) — which was written because another attempt to solve the
  same problem by text matching produced a false positive and then three wrong "fixes".
- **`check:scripts`** — `.mjs` files in `scripts/` must not contain TypeScript type annotations.
  A `.mjs` with `const x: string[] = []` fails at parse time, so a generated edit script silently
  changes nothing. Wired into `ci.yml` and the local gate.

## [1.8.8] - 2026-10-09

### Fixed

- **`vobs check` now runs the compiler diagnostics, not just the CLI's own rules.** The batch
  entrypoint only ran `analyzeSource` (C118/C210/C232), so the compiler's five rules
  (`VOBS_C104`–`VOBS_C108`) were invisible there — a file with module-level JSX (which should
  report `VOBS_C105`) printed "✔ 检查通过 —— 1 个文件，没有发现问题". This is the third instance of
  the same channel defect that 1.8.2 fixed for `warn`-level output: **a diagnostic that is not
  visible on a given channel does not exist.** `check.ts` now merges `compileWithSourceMap`
  diagnostics, deduplicating against `analyzeSource` by `code|file|line|column`, and a single file
  that makes the compiler throw no longer aborts the whole run (that is a tool failure, not a
  source problem). Added `--no-compiler` for the faster analysis-only pass. `@vobs/cli` gained a
  `@vobs/compiler` dependency; without it the CLI subprocess crashed at import time.
  - The first real whole-repository run (270 files) reported `{ VOBS_C118: 3, VOBS_C108: 2 }`, both
    `C108` hits genuine and in the documented forbidden zones: JSX stored in a data constant
    (`KitLayout` menu array) and JSX stored in `state`. Both are fixed in the playground.
  - Corrected two of my own claims in the 1.8.6 contract text: `check:source` did **not** list all
    diagnostics (it never ran the compiler), so the earlier "C108 has zero false positives" check
    was empty. The contract now describes `check:source` accurately, and the inline TypeScript
    module was updated to match.

## [1.8.7] - 2026-10-02

### Added

- **`VOBS_C108`**: JSX stored in a variable, which creates the node eagerly. Real-project crash
  (2026-10-02): `const node = <ElementVarPicker el={pickerElement.value} />; return open.value ?
  node : null` — the component is instantiated at the assignment, while `pickerElement.value` can
  already be `null`, so its body reads `.content` on a null and throws.
  - Measurement corrected an assumption: the attribute expression is **not** hoisted by the
    compiler. `<div>{open.value ? <Picker el={picker.value}/> : null}</div>` is safe —
    `createComponent` sits inside the conditional and the prop is a getter, so the component is
    never created when the condition is false. The difference is where the JSX was written.
  - This fills two documented "forbidden zones" that had **no diagnostic at all** (measured: all
    silent): a node derived in a run-once component body, and JSX stored in a data constant (which
    reaches SSG serialisation and emits `[object Xxx]`). Silent failures are the worst class for an
    agent-written codebase, because this shape is completely legal in React.
  - Reports only inside a function body, and walking stops at any nested function:
    `const render = () => <Picker/>` is the recommended form and is not reported. Module top level
    belongs to `VOBS_C105`, so there is no double report. Severity is warning — a node used exactly
    once does work; the conditional shape is the one that crashes.
  - False-positive check: zero hits across the repository, including test files.
  - Its fix text is **position-aware**, after measurement showed the first version was only half
    right: inlining at a JSX child position compiles to a reactive conditional factory, but inlining
    into a component's **top-level `return`** freezes instead — that position has no parent or
    anchor, so even two JSX branches never re-branch (it trips `VOBS_C104` and `VOBS_C107`).
    Following the earlier advice would have traded a crash for a screen that never switches, which is
    the more deceptive failure. The text now branches on position, names `VOBS_C107` explicitly, and
    adds a fifth option: when the component has internal state worth keeping (input contents, scroll
    position, canvas state), mount it permanently, pass the state object in and null-check inside —
    which avoids both the crash and the subtree rebuild that option ① causes.

## [1.8.6] - 2026-10-02

### Added

- **`vobs agent-doc`** — generates the framework contract into a project as `AGENTS.md` plus a
  one-line `CLAUDE.md` (`@AGENTS.md`), so any coding agent reads the current rules instead of a
  stale hand-written copy. The contract ships inside `@vobs/cli`, so it is pinned to the framework
  version: upgrade, regenerate, stay in sync. Flags: `--write` (default prints to stdout),
  `--check` (exit 1 when the project copy differs from this framework version, usable in CI),
  `--body` (contract only), `--dir`.
  - The generated text lives between `<!-- vobs:begin -->` and `<!-- vobs:end -->`; everything
    outside is the project's own rules and is preserved on regeneration. An existing hand-written
    `AGENTS.md` with no markers is **not overwritten** — the block is appended after it, because
    discarding someone's rules is worse than not generating at all.
  - The content is tool-neutral (it never names a specific model) and stays within one screen: hard
    constraints with counter-examples, each tagged with the diagnostic that fires when violated.
  - `CLAUDE.md` is a pointer rather than a copy, so there is only ever one copy to keep current.

### Notes

- The contract is deliberately a complement to the diagnostics, not a substitute. An agent always
  reads build and test output but may not read a document, which is why 1.8.5 moved the structural
  fix into the `VOBS_C210` / `VOBS_C211` messages themselves.

## [1.8.5] - 2026-10-02

### Changed

- **`VOBS_C210` and `VOBS_C211` now teach the structural fix before the patch.** Both messages
  previously offered only `untrack`, which suppresses this one write without answering why the
  effect subscribed to that signal in the first place. They now lead with `effect(on(deps, fn))`
  (added in 1.8.3, where the callback runs untracked so reads inside functions it calls cannot
  subscribe) and with deriving the value via `memo`; `untrack` is the fallback. The `C210` example
  shows the `on()` form. `C211` also notes that an async function runs synchronously up to its
  first `await`, so calling one from an effect still subscribes — the compile-time `VOBS_C106`
  warns about the direct form of that.

## [1.8.4] - 2026-10-02

### Added

- **`VOBS_C107`**: a reactive read in a `return` inside a component body, which the run-once
  contract freezes. Component bodies execute once, so a `return` that reads a signal is evaluated
  at mount and never re-branches. Measured against the compiled output, all three shapes behave
  identically — `return cond.value ? <A/> : <B/>`, `if (cond.value) return <A/>; return <B/>` and
  `return cond.value ? <A/> : null` all compile without `insertDynamic` or `createBlock`, because
  a component's top-level `return` has no parent or anchor to swap content in. `VOBS_C104` only
  covered the third shape, which implicitly blessed the first two. The rule reports a `.value` read
  that is **outside any JSX subtree** of the returned expression: `return <div>{cond.value ? …}</div>`
  is the correct form and is not reported.

### Changed

- **`VOBS_C104` fix text no longer suggests moving the ternary to a component's top-level return.**
  Measurement shows that does not help: with no parent or anchor there, both-JSX branches freeze
  exactly like an empty branch. The text now points at `RouterView` for routing and `Show` for
  visibility, and states explicitly that a top-level return does not work.

### Notes

- Known gap: `if (cond.value) return null; return <B/>` is reported by neither rule (C104 needs a
  conditional expression, C107 needs a JSX-returning branch). Detecting it would require knowing
  whether the enclosing function is a component, which widens false positives on data guards.
- Routing belongs in `<RouterView>`, which handles the branch declaratively with
  `insertDynamic` plus `resetKey`. `Show` keeps a subtree mounted and toggles `hidden`/`inert`, so it
  is the wrong tool for swapping route trees.

## [1.8.3] - 2026-10-02

### Added

- **`on(deps, fn, options?)`** (`@vobs/reactivity`, re-exported from `@vobs/vobs`) — declare an
  effect's dependencies explicitly. Dependency collection in an effect is automatic, so any
  signal read inside the callback becomes a dependency; the callback passed to `on` runs inside
  `untrack`, so signals touched by functions it calls no longer subscribe. The typical failure it
  removes: `effect(() => { if (session.value) void sync() })` where `sync` reads and writes the
  same signal before its first `await` — that reads as a self-subscription and loops. Signature
  follows SolidJS: accepts a signal, an array of signals or a getter, passes `(value, previous)`
  to the callback, and supports `{ defer: true }`. It is not a replacement for `untrack`:
  declared dependencies are still tracked.
- **`VOBS_C106`** (`@vobs/compiler`) — an `async` callback passed to `effect`, `renderEffect`,
  `memo`, `on` or `onMount`. The code before the first `await` runs synchronously inside the
  tracking scope, so it subscribes the effect to whatever it reads, and the effect does not await
  the returned promise. Only direct async callbacks are reported, because they are visible in the
  syntax tree; the indirect form (`effect(() => { void someAsyncFn() })`) would need a type
  checker, which the per-file Vite transform cannot use. That form is covered by the runtime
  guards `VOBS_C210` and `VOBS_C211`. Reported as a warning, surfaced in `vite build` since 1.8.2.

### Changed

- **A component may now return `null`, `undefined` or `false` without a type error.** The runtime
  has normalised empty results to an empty comment node since 1.8.0, but `VobsComponent` still
  declared `=> VobsNode`, so `return cond ? <div/> : null` failed to type-check while working at
  runtime. Every comparable framework allows empties in a component's return type (`ReactNode`,
  Preact's `ComponentChild`, Solid's `JSX.Element`, Vue's `VNodeChild`). `VobsNode` itself is
  unchanged: it still means a real node, so passing `null` to `insertBefore` remains an error.

### Fixed

- **HMR refresh crashed when the new version of a component returned an empty value.**
  `createComponent` normalises empties on the first render but not on the refresh path used by
  `hmr.ts`, so `nodeOwners.set(null, owner)` threw `Invalid value used as weak map key` — the same
  error as the 1.8.0 mount crash. `hmr.ts` catches refresh failures, so instead of a visible crash
  the update silently did not apply and the screen kept the old version, which reads as "my change
  had no effect". Development-time only.

## [1.8.2] - 2026-10-02

### Added

- **Drag, clipboard, animation, transition, media and composition event types** on
  `VobsHTMLAttributes`. `onDragOver` and `onDrop` previously failed to type-check
  (`Property 'onDragOver' does not exist on type 'VobsHTMLAttributes'`), so drag-and-drop
  imports had to fall back to a `ref` callback with a native `addEventListener`. The runtime
  already supported these events (`resolveEventName` lower-cases any `on*` attribute, so
  `onDragOver` resolved to `dragover`); only the declarations were missing. The event
  attribute list grows from 28 to 77.

### Fixed

- **`@vobs/vite-plugin` silently dropped compiler warnings.** `describeDiagnostics` filters to
  `severity === 'error'` and returns `null` when there are none, and the plugin only did
  `if (summary) throw`. As a result `VOBS_C105` (module-level JSX) and `VOBS_C104` (top-level
  conditional `return`, a warning since 1.8.1) were invisible in `vite build` and `vite dev` —
  only `vobs check` reported them. Warnings now go through Vite's own warning channel
  (`this.warn`), falling back to `console.warn` when no plugin context is available.
  Deduplicated by code, location and message. They are still not errors, because the rules
  behind them are heuristic.

## [1.8.1] - 2026-10-02

### Fixed

- **`VOBS_C104` narrowed and downgraded from error to warning.** The rule fired on any
  `return cond && value` and on `return x ? x : null` without checking whether the returned
  value is a render node. In a real-project upgrade roughly 16 of 18 reports were pure data
  functions (`T | null` modelling), and because the rule was an `error` it blocked the build.
  It now fires only when at least one branch is a JSX node. The downgrade is deliberate: the
  rule assumes the function is a component, which static analysis cannot decide.
- **`VOBS_C104` fix text no longer depends on a global utility class.** It recommended
  `class={cond ? 'is-on' : 'is-off'}`, which requires a project-wide `.is-off`; real projects
  often only have compound selectors. It now points at `Show` and `classList`.

## [1.8.0] - 2026-10-02

### Added

- **Client-guard primitives** (`@vobs/vobs`). `onMount(fn)` runs once after mount, skipped on
  the server and when the component is already unmounted. `onDestroy(fn)` is the paired cleanup
  slot (the same operation as `onDispose`; it throws when there is no owner, because a lost
  cleanup registration is a leak). `ClientOnly({ children, fallback })` renders `fallback` on
  the first pass on both sides so hydration matches, then swaps in `children` after mount; it
  uses `createFragment` for the parent, so no wrapper element is inserted.
- **`Show` and `classList`** (`@vobs/vobs`, `@vobs/runtime`). `<Show when={...}>` keeps the
  subtree mounted and toggles `hidden` + `inert`, so focus, scroll position and internal state
  survive a condition flip; it requires a single element child and throws with guidance
  otherwise. `classList={{ 'is-open': open.value }}` accepts objects, arrays and strings and
  contributes only its own classes, so the author's `class` is untouched and repeated toggles
  do not accumulate.
- **`parseNumber(text, options)`** (`@vobs/forms`). Empty, invalid and out-of-range input does
  not commit, so the signal keeps its last valid value; `Number('') === 0` used to write a zero
  that cascaded through ratio and lock-step calculations. Deliberately does not use `Number()`,
  whose parsing is too permissive. `Field` routes `type="number"` (or any field given
  `min`/`max`/`step`) through it, commits a `number`, and reports failures via `onNumberInvalid`.
- **Compiler diagnostics** (`@vobs/compiler`). `VOBS_C104` flags a top-level conditional
  `return` that produces a render node, because a component body runs once and that `return`
  never re-evaluates. `VOBS_C105` flags module-level JSX, which is evaluated before `createVobs`
  installs the renderer; it is a warning rather than an error because an error makes `compile()`
  throw and breaks every tool that compiles code snippets.
- **Runtime guard check**: `pnpm run check:runtime` and `check:runtime:interact`. A dev server
  injects a collector, real Chrome drives each route, and guard violations are reported through
  the exit code; the interactive mode also clicks every button and fires every input. Static
  analysis caught only one of the four real self-subscription defects fixed here.
- **`@vobs/icon-core` warns on a missing icon definition**, deduplicated by name, so a lookup
  miss in an icon whitelist is no longer silently blank.
- **Release tooling**: `pnpm run release:version <version>` sets the version across the root and
  all publishable packages in one pass; `pnpm run check:release` without a tag runs a consistency
  check across the packages and the root.

### Fixed

- **`createComponent` crashed when a component returned `null`, `undefined` or `false`**
  (`Invalid value used as weak map key`). The render result was used as a `WeakMap` key and an
  empty value is not a valid one, so the app crashed on mount with no JS error logged and the
  splash fallback never ran. Empty results are now normalised to an empty comment node.
- **`@vobs/resource` self-subscribed on a reactive key.** A single effect both read and wrote
  the same signals, tripping `VOBS_C210` on every route that used a reactive key. Split into two
  effects.
- **`@vobs/runtime`**: a throwing ref callback aborted the whole dispose cascade, skipping every
  later cleanup of the same owner; `removeEventListener` ignored the handler identity and removed
  bindings belonging to other handlers; `<select>` value replay read a signal while inserting
  options, hiding a subscription.
- **`@vobs/ssr`**: `id`, `style` and `title` disappeared from server output because the
  reflected-property allowlist was too narrow; rendering an object as text now throws instead of
  silently emitting `[object Xxx]`, and the check covers the whole family (matching only
  `[object Object]` missed `[object HTMLDivElement]`).
- **`@vobs/theme`**: scoped `setBrand` missed `untrack` and self-subscribed inside an effect;
  `ThemeBoundary`'s `provide` lacked `override`, so using the boundary inside a `themePlugin`
  subtree threw.
- **`@vobs/table`**: with `rowKey`, the `index` passed to `column.render` and `onRowClick` was
  frozen at creation, so reordered rows rendered stale indices.
- **`@vobs/http`**: retries ignored `Retry-After`, so a server asking for a pause was hit again
  immediately; the dedupe key omitted `responseType`, `credentials` and `cache`, so concurrent
  requests for the same URL could collide.
- **`@vobs/i18n`**: `I18nBoundary` did not follow a parent `setLocale` when no `locale` prop was
  given.
- **`@vobs/ui`**: the focus trap counted invisible elements as focusable (`hidden`,
  `display:none`, `visibility:hidden`, `tabindex="-1"`, `inert` and hidden ancestors), so it
  computed the wrong endpoints and could move focus into invisible regions.
- **`@vobs/layout`**: links inside a closed mobile drawer remained tabbable, and sidebar
  visibility ignored `mobileOpen`.
- **`@vobs/queue`**: settled tasks were never removed, so a task id could not be reused and long
  sessions grew without bound; `completed` and `failed` are now accumulators and `total` stays
  consistent with the other counters.
- **`@vobs/forms`**: `Field` swallowed `type="password"`, rendering password inputs as plain text.
- **`@vobs/vite-plugin`**: `resolveId` returned backslashes while `load` used forward slashes,
  breaking HTML component imports entirely on Windows.
- **`@vobs/cli`**: `vobs check <invalid path>` reported success with exit 0, unknown commands
  exited 0 silently, the version was hardcoded, and `--json --write` polluted stdout.
- **`@vobs/compiler`**: static `htmlFor="x"` emitted `htmlfor`, silently disconnecting labels;
  `autoFocus={false}` focused the element anyway.
- **`reactivity`**: `Effect` now uses class prototype fields, making the wake path about 18%
  faster (seven same-process A/B rounds, non-overlapping ranges).

## [1.7.7] - 2026-09-30

### Added

- **`@vobs/dsh`** — a new public package for building DeepSeek Harness client plugins with vobs. It ships three things: (1) a **runtime adapter** — `defineDshPlugin`, `defineDshOverlay` and `defineDshPanel` register a vobs render function into a DSH slot, and `createVobsSlotHost` encapsulates the whole React-host-plus-shadow-root dance so a plugin author never writes React; (2) a **typed DSH client contract** (`DshClientContext`, `DshSlotsService`, `DshSlotRegistration`, …) reverse-engineered from the installed DSH client bundles, with every DSH-specific field optional and unknown fields passed through verbatim; (3) **`@vobs/dsh/vite`** — `dshBundle()`, a Vite plugin that wraps the CJS output into DSH's `window.__ModuleLoader__.load({ id, factory })` protocol, injects the `module`/`exports` shim and the platform `react` bootstrap, derives the output directory and file name from `exports["./client"]`, and **fails the build** on the three ways a plugin bundle can be silently invalid: more than one chunk, a standalone asset, or a non-CJS format. `react` (and anything in `platformModules`) is always external — bundling it would give the plugin a second React instance.
- **`@vobs/dsh/preview`** — a dependency-free browser runtime that renders a plugin outside DSH. It installs a `window.__ModuleLoader__` shim, substitutes a minimal React implementation (`createElement` / `useRef` / `useEffect` — the only three APIs the adapter's host component uses), builds a mock DSH shell (rail / sidebar / main / right bar / overlay) and mounts each registered slot entry into its matching region, surfacing thrown errors in the page instead of a blank screen. `?static=1` disables the hot-reload stream for headless screenshots and CI assertions.
- **`@vobs/cli`** gains the `vobs dsh` command group: `init` (scaffolds a standalone plugin project from a new `dsh-plugin` template — manifest, cordis patch, Vite config, and a `.gitignore` that deliberately does **not** ignore `lib/`, because DSH never builds your package), `dev` (build + watch + the preview runtime), `build` (builds **both** halves — the Vite config only covers the client), `check` (pre-install conformance: manifest fields, patch `insert`, install-time lifecycle hooks, `workspace:` protocol, artifact shape and purity, `require` targets), and `install` (assembles the install spec and shells out to `dsh plugin add`).

### Fixed

- **Compiler: conditional branches that are not node factories were silently dropped.** `convertDynamicNodeExpression` committed to a conditional expression tree as soon as *one* branch produced a node, writing `null` for every other branch — and the `insertDynamicValue` fallback only triggered when *no* branch produced a node. So `{cond ? <A/> : items.map(i => <B key={i}/>)}` compiled to `cond ? <A/> : null` and the entire list disappeared with no error, and `{cond ? <Icon/> : label.value}` lost the text branch the same way. A new `isDynamicNodeBranch()` pre-check now requires *every* branch to be a guaranteed node factory (JSX, explicit `null`/`false`, or a nested conditional/`&&` where every level holds); otherwise the whole conditional falls back to the polymorphic `insertDynamicValue`, which renders nodes, fragments, arrays and primitives alike. Correctness over the fast path: that position loses `insertList` keyed reconciliation, but it no longer loses content. Lists written as a direct child expression (`{items.map(…)}`) and conditionals whose branches are all nodes (`{cond ? <A/> : <B/>}`) are unaffected.

### Notes

- This release also contains two DSH plugin packages that are **not** published to npm — `dsh-plugin-vobs` (the minimal reference plugin, migrated onto `@vobs/dsh`, with its client entry reduced from 87 to 25 lines) and `dsh-plugin-vobs-console` (Vobs Console). Both are distributed through Git tags and installed with `github:vobsjs/vobs#<tag>&path:/packages/<name>`; each ships committed prebuilt `lib/` artifacts and its own jsdom conformance script (54 and 62 assertions respectively). Their manifests share the repository-wide lockstep version.

## [1.7.5] - 2026-09-30

### Added

- Layout: `KitMenuItem` gains `pin?: 'top' | 'bottom'`. Items with `pin: 'bottom'` are split into a dedicated bottom menu region pinned to the sidebar's lower edge (fixed render order: normal menu → pinned menu → footer slot). Pinned items share the same `activeKey`/`onSelect`/`collapsed` machinery as normal items — identical hover, active (brand accent bar) and collapsed styles; only the position differs. `'top'` is a reserved enum value with default behavior for now.
- Layout: `KitMenuItem` gains `badgePill?: number | string | (() => number | string)` — a floating badge pill anchored to the top-right corner of the item icon, visible in both expanded and collapsed states (the regular `badge` is CSS-hidden when collapsed). `0`, `''`, `null` and `undefined` render nothing; the function form is evaluated inside the menu render scope, so signal changes rebuild the menu tree (same mechanism as the `items` getter). Requires `icon` to be configured.

## [1.7.4] - 2026-09-29

### Added

- Runtime: SVG namespace support. `createElement` now dispatches SVG tags (the full `SVGElementTagNameMap` key set) to a new optional `VobsRenderer.createSvgElement(tag)` — the DOM renderer creates via `createElementNS`, so JSX `<svg><rect/></svg>` produces real, renderable, queryable SVG elements. Previously `createElement('rect')` yielded an `HTMLUnknownElement` and the whole SVG subtree silently failed to render (no error) — the framework's own icon system had to work around it with `innerHTML` injection. Hydration claims SVG nodes by namespace + tag name; SSR serialization is unchanged (nodes are data). Renderers that don't implement `createSvgElement` keep the previous behavior via fallback. Deliberately excludes tags that share names with HTML elements (`a`, `script`, `style`, `title`) — those keep HTML creation, matching the JSX typings. Known limitation: HTML children inside `foreignObject` are still created with the SVG namespace.

## [1.7.3] - 2026-09-29

### Changed

- Compiler: JSX child expressions are no longer classified by a static heuristic. Every non-static child (function calls, member accesses, identifiers, literals) now compiles to the polymorphic `insertDynamicValue` — the compiler no longer guesses whether a call returns text or a node. Returning a `VobsNode`/Fragment from a helper called in JSX position (`{renderSections(doc)}`) renders correctly; previously the call fell into the `bindText` path and was stringified to `[object Object]` (regression found in Labelune's legal document pages).
- Runtime: `insertDynamicValue` is now the single polymorphic child inserter (Solid-style runtime dispatch). Primitive values (string/number) hit an in-place text fast path — the mounted text node is reused and its content mutated, matching the previous `bindText` performance (zero node churn on high-frequency text). Nodes/Fragments/arrays keep the scope-isolated mount/unmount semantics (inner component owners are disposed when the subtree is swapped). `null`/`undefined`/`boolean` clear the mounted child. Mixed-type values (`cond ? <A/> : 'plain text'`) now work across type changes.

## [1.7.2] - 2026-09-28

### Added

- Notification: `messagePlugin` / `useMessage` — MessageHost top-center toast queue (independent queue, 3s auto-close, max 3 stacked, key dedup); single messages can override icon behavior via a three-mode switch (text-only / mapped by type / fixed icon name).
- UI: `MessageHost` pill-style message renderer used by the notification package.

## [1.7.1] - 2026-09-20

### Added

- Vobs: `VobsHTMLAttributes` gains `draggable`, `inputMode`, `onError` (ErrorEvent) and `onLoad` (Event) — completes the attribute whitelist for native drag control, virtual-keyboard hints, and image load/error handlers (`<img onError>` fallback swaps, `draggable={false}` on logo images).

## [1.7.0] - 2026-09-20

### Added

- Vobs: `VobsHTMLAttributes` gains native image loading hints `loading?: 'lazy' | 'eager'` and `decoding?: 'sync' | 'async' | 'auto'` — JSX `<img loading="lazy">` now typechecks for image-heavy pages.
- Captcha: `SliderCaptcha` ships a built-in refresh icon (span + CSS mask data URI, tinted by `currentColor`) used when `retryIcon` is not provided. The icon avoids `@vobs/ui` and SVG-namespace elements, so it renders under the DOM renderer, SSG serialization, and hydration claiming alike. Explicit `retryIcon` props still win.

### Fixed

- Captcha: the slider retry button is now anchored to the top-right corner of the challenge image (`top/right: 8px`) instead of a hard-coded `top: 176px` offset that assumed a 260px-tall visual and landed off-image for any other challenge size.

## [1.6.4] - 2026-09-18

### Added

- SSR: static site generation (SSG). `prerenderRoutes` renders each route at build time through a boot-path memory-history router (so `/` guards and loaders execute fully), `renderPage` assembles the complete HTML document (charset, viewport, custom template hook for CSS links and `lang`), and the head utilities `serializeHeadTags` / `applyHead` / `createHeadSync` cover server injection and client-side `<head>` sync. Output is pure static HTML — deploy to any static host.
- Router: `createHashHistory` (single `hashchange` listener + `pushState`-written hash, state round-trips through `history.state`).
- Compiler: `hoistTemplates` option (default `true`, behavior unchanged). The vite plugin auto-disables it for SSR builds because `createTemplate`/`cloneTemplate` depend on `document`.
- Vobs: full JSX element coverage. `IntrinsicElements` now derives from `HTMLElementTagNameMap` / `SVGElementTagNameMap` mapped types (no hand-maintained tag list; new elements arrive with TS lib updates), plus an exported `VobsSVGAttributes` interface. `VobsHTMLAttributes` gains `href`, `target`, `rel`, `download`, `hrefLang`. The attribute interfaces are re-exported from the package entry so the global JSX augmentation ships with npm installs — tsup drops triple-slash references, which previously left monorepo-external projects without `JSX.IntrinsicElements`.
- Website demo playground (`playground/website`) exercising the SSG pipeline end-to-end (client build + SSR build + prerender to `dist/*.html`).

### Fixed

- SSR/hydration (silent post-hydration event failures): adjacent text nodes are serialized with `<!-- -->` separators — the HTML parser previously merged them into one node, so strict per-node claiming failed mid-hydration and event listeners never bound. Empty dynamic text serializes to an `<!---->` placeholder; hydration claims the placeholder in place and swaps it for a real text node (position-exact, never stealing sibling text), falling back to any unclaimed text when the server rendered a non-empty value.
- SSR/hydration (array children): claiming falls back through ancestors up to the container (scanning direct children only) so "create all siblings first, insert later" patterns — array maps through `insertDynamicValue`/`insertList` — hydrate correctly; server-extra nodes remain precisely reported by `assertAllNodesClaimed`.
- SSR/hydration (post-hydration re-renders): after hydration completes the renderer degrades to real DOM creation, so state-driven branch swaps that create fresh nodes no longer fail.
- Router: the built-in route error fallback is renderer-neutral (`setAttribute`/`insertBefore` instead of DOM-only `style`/`append`/`addEventListener`), so a render error during prerender serializes instead of crashing Node and masking the original error.
- Vite plugin: `transform` return type annotation fixed (`map: unknown` → `VobsSourceMap`) — this failed the dts build; the plugin now reads Vite's SSR transform option to disable template hoisting automatically.

### Changed

- All 36 packages version in lockstep; the 1.6.1–1.6.4 patch line only touches `@vobs/ssr`.

### Tests

- SSR: empty dynamic text placeholder round-trip (SSR serialization + hydration in-place replacement without stealing adjacent text) and a RouterView SSG full-tree hydration test reproducing the website demo. Full suite green across the line (535 tests).

## [1.5.1] - 2026-09-17

### Changed

- Theme: the built-in brand color system is now preset-driven. Ten brand presets are defined as tokens (`--brand-neon` `#00DD00`, `--brand-orange` `#FD742D`, `--brand-blue` `#0F64B5`, `--brand-jasmine` `#DA2357`, `--brand-tangerine` `#FF6047`, `--brand-purple` `#690DAD`, `--brand-pine` `#027C74`, `--brand-deep-purple` `#821E8F`, `--brand-crimson` `#9D1F2F`, `--brand-pink` `#E0538C`); the previous neon-green scale (`--brand-green-100…1000`) was removed. All active brand tokens (`--bg-brand`, `--text-brand`, `--icon-brand`, `--border-brand` and their hover/disabled/popup variants) now derive from a single `--brand` alias (default: `--brand-neon`) with variants generated via `color-mix`. Switching the active brand is a one-line override: `--brand: var(--brand-blue)`. Dark presets need an `--text-onbrand` override (kept dark for bright presets).

### Fixed

- Runtime: `<select>` elements with a bound `value` now automatically re-apply the current value whenever an `<option>` (directly or through an `<optgroup>`) is inserted into them. Previously, options that arrived after the value binding — e.g. asynchronously loaded lists — left the select showing a blank selection, which forced apps to keep `ref + queueMicrotask` value-sync workarounds. `bindProperty` registers the value reader for selects; `insertBefore` re-applies it on option/optgroup insertion (walking up from an inserted option to the owning select). Regression tests cover async options and optgroup-nested options.

### Added

- UI: `Combobox` — searchable dropdown component (filter-as-you-type, keyboard navigation with ArrowUp/ArrowDown/Enter/Escape, outside-click close, empty-text hint). Accepts a controlled `value`, a two-way `bind` signal, or an `onChange(value)` callback; options may be provided reactively. Styled via `vui-combobox` classes using theme tokens.
- Types: JSX event handler types now cover pointer (`onPointerDown/Up/Move/Enter/Leave`), mouse (`onMouseDown/Up/Move/Enter/Leave`), touch (`onTouchStart/Move/End`), wheel and scroll events. The runtime event channel was already generic — these were type-level restrictions only.

### Changed

- Types/Compiler: `VobsHTMLAttributes` now includes `role`, `spellCheck`, `autoComplete`, `colSpan` and `rowSpan`. The compiler and runtime map camelCase aliases (`htmlFor` → `for`, `autoComplete` → `autocomplete`, `spellCheck` → `spellcheck`) onto real HTML attribute names; `colSpan`/`rowSpan` go through the property channel.

### Tests

- Runtime: new `jsx-integration.test.ts` compiles JSX through the real compiler and executes it against the runtime. It locks down two long-reported downstream issues — dynamic `style` expressions inside lists and node↔null conditionals inside list items — both of which work correctly on the current 1.4.x pipeline (the failures dated back to 1.3.x-era transforms and are now guarded against regressions).

## [1.4.2] - 2026-09-14

### Fixed

- Compiler: residual JSX (JSX left untouched by the main transform in early returns or nested branches) is now transformed before runtime imports and template declarations are generated. The fallback pass registers new helper aliases (e.g. `insertDynamicValue`) and `_tpl` template declarations; when it ran last, generated references pointed at identifiers that were never imported or declared, producing a runtime `ReferenceError`.
- Tests: regression coverage for residual JSX in early-return and nested-branch positions (compiler `compile.test.ts`).

## [1.4.1] - 2026-09-13

### Fixed

- Router: `RouterView` no longer renders a silently blank page when a route render/effect error is captured by its boundary and no `error` fallback prop was provided. A built-in fallback (`.vobs-route-error`: error title, message, and a Retry button) is now rendered instead; apps that pass `error` keep full control of the fallback output (including an explicit `null`). This was the root cause of "the whole page disappears after closing a dialog" reported by downstream apps: a signal write that both closes a dialog and invalidates inner text bindings runs the deeper (child) effects first — an unguarded nullable read (e.g. `req.value.message`) throws before the structural teardown disposes the branch, the error is captured by the route boundary, and the old default fallback rendered `null`.
- Tests: regression coverage for the dialog teardown pattern (runtime `dialog-teardown.test.ts`: conditional dialog children coexisting with sibling content, user-component children passthrough, `insertDynamic` disposal of replaced subtrees) and for the router fallback behavior (router `index.test.ts`: built-in fallback rendered on render/effect errors, explicit `null` fallback respected, retry recovery, and an end-to-end reproduction of the dialog-unmount error race).

## [1.4.0] - 2026-09-12

### Changed

- Reactivity: `state()` signals are no longer disposed automatically when their owning `Owner` scope is disposed. Signal lifetime is now reachability — a signal stays writable for as long as it is referenced, and only explicit `dispose()` retires it. The subscription graph is still cleaned up on scope disposal (owned effects are disposed and unsubscribe themselves), so component-scoped reactive state remains leak-free. Rationale: `addEventListener` wraps compiled event handlers in `owner.run`, so signals created inside event handlers (store data, domain objects) previously inherited the triggering UI scope — a dynamic scope teardown (e.g. a dropdown menu closing) silently disposed them, freezing all downstream writes (`set()` became a no-op) while UI effects stayed alive. Code that intentionally relied on `set()` becoming a no-op after scope disposal (rare and almost always accidental) must switch to explicit `dispose()`. Memo signals keep owner-linked disposal: they are computations whose dependency links must be released with their scope.

### Added

- Reactivity: writing to a signal that was explicitly `dispose()`d now emits a one-time `console.warn` (including the signal's debug name, if any). A write after explicit disposal is always a programming error; the write itself is still ignored and the value stays frozen.
- Tests locking the new semantics: a `state()` created inside an event handler bound under an owner stays writable and subscribable after that owner is disposed (runtime `events.test.ts`), and a signal created in a disposed scope can still be written and subscribed (reactivity `signal.test.ts`).

## [1.3.7] - 2026-09-11

### Fixed

- HMR refresh of a component now disposes the previous render scope (body effects, `onDispose` cleanups such as portal unmount, and nested component owners) before re-rendering. Previously every hot update leaked the old component instances — portals kept stacking in `document.body`, body-level effects kept subscribing to signals, and old event listeners stayed registered.
- HMR refresh now replaces the DOM when a component's root is a fragment (or switches between fragment and element). Previously fragment-rooted components silently kept the old DOM after a hot update.
- Each hot update now renders every component exactly once: `updateHmrModule` refreshes instances in ancestor-first registration order (descendants whose render scope was already disposed by their ancestor are skipped), and instances created during the refresh pass are not refreshed again.
- `updateHmrModule` only touches the module it was called for. It previously refreshed every registered module whose export names happened to collide, breaking HMR across unrelated modules with same-named exports.
- Reactivity: `Owner` gains `mark()` / `disposeSince()` to dispose only the cleanups and child owners registered after a mark, keeping the owner itself (and its HMR registration) alive.

### Added

- HMR state preservation (enabled by default in dev): module-level `state()` declarations are compiled to `hmrStateRef(...)`, reusing existing signal instances when a module is re-executed during hot updates. This eliminates the "two module instances, two copies of state" problem that caused edits not to take effect or half the page to stop working. `.ts` modules (store-style) that declare module-level state are also brought into HMR handling. A new option `vobsPlugin({ hmrState: false })` can disable it; the compiler side has a corresponding `hmrModuleId` option.
- `@vobs/vobs` adds a `./jsx` export: global JSX type declarations (including property attributes such as `checked` and a complete HTML tag table) are shipped with dist. Consumers can add `"types": ["@vobs/vobs/jsx"]` to their tsconfig to get JSX types, with no need to maintain a local jsx.d.ts by hand.

### Fixed

- `@vobs/vobs` JSX type declarations now include the `accept` and `alt` attributes.
- Compiler: JSX in arbitrary positions no longer leaks into Vite's esbuild fallback path.
- Compiler: nested ternaries (`a ? <A/> : b ? <B/> : <C/>`) and all branches of `&&`-nested dynamic nodes are now compiled completely; previously only the first branch was preserved.
- Runtime: the issue where `<select value>` did not take effect when assigned before option child nodes were ready is fixed by the runtime replaying it in a microtask, so consumers no longer need the `ref + queueMicrotask` workaround.
- Runtime: component rendering untrack. Signal reads inside a component body are no longer collected as dependencies of ancestor effects (insertDynamic/route mounting)—previously an unrelated edit would trigger destruction and reconstruction of the entire subtree (input fields replaced, focus lost, event listeners invalidated along with the old tree), which was the root cause of "edits not responding" in dynamic forms.
- Runtime: event listeners on an already-destroyed Owner are ignored directly, no longer throwing "destroyed Owner" error noise.
- `@vobs/ui`: the `VuiChildren` type now includes `null`/`undefined`/`boolean` members, so conditional JSX children (`{cond ? <A/> : null}`) pass type checking directly.
- `@vobs/router`: `RouterViewProps.loading` accepts both node and factory forms, consistent with the getter semantics of compiled output.
- Build script: standalone `.d.ts` files (such as jsx.d.ts) are correctly copied into dist.

## [1.2.1~1.3.5] - 2026-09-10

### Fixed

- Published dist bundles no longer inline shared internals. Cross-package `@vobs/*` imports, third-party dependencies (`typescript`, `parse5`, …), and Node builtins are now externalized, so all packages share one instance of reactivity/runtime/context at runtime. Previously every dist bundled its own copy, which broke cross-package singletons when consumed from npm — `useRouter` injection failed ("not found Router"), `@vobs/ui` threw "Renderer not initialized", and effects created across package boundaries escaped the owner tree.

### Changed

- `scripts/build-packages.mjs`: removed the tsup `treeshake` and `skipNodeModulesBundle` options that silently dropped the `external` list (workspace symlinks made `skipNodeModulesBundle` skip only real node_modules packages while still inlining workspace sources). The external list now derives from each package's `dependencies`/`peerDependencies` plus `@vobs/*` and `node:*` patterns.
- Test and benchmark infrastructure upgraded to vitest 5: the benchmark DSL moved from a top-level `bench` export to a test-context fixture (`test(({ bench }) => ... bench(...).run())`), and the four benchmark files were rewritten accordingly. All tests pass unchanged on the new runner.

### Added

- Public dual-track package artifacts for all 36 `@vobs/*` packages, including `@vobs/cli` and `@vobs/payment`.
- ESM, CJS, declaration, and `/source` entry points are now included in the automated package verification and release workflow.
- Real statement-level source maps for compiled TSX, with structured compiler diagnostics (`VOBS_Cxxx`) including source locations, code frames, and fix hints. Unsupported JSX shapes (member-expression and namespaced tags) now fail explicitly.
- Collision-safe runtime helper injection: compiler-provided helpers no longer conflict with user imports or local bindings of the same names.
- Resource client revision guard on every settle path, so late in-flight responses can no longer overwrite newer data or resurface stale errors after `mutate`/`optimistic`.
- Router guard against stale navigation commits: a navigation superseded during loader execution can no longer push history or overwrite the current route.
- Router navigation state: pass per-entry state via `RouteLocationRaw.state`, read it back as `RouteLocation.state` (persisted through history adapters and restored on `back`/popstate).
- `@vobs/payment`: gateway responses are now checked for business errors (`code !== '10000'` throws `AlipayApiError` with `sub_code`/`sub_msg`) instead of silently mapping undefined fields; notification `validate()` accepts expected `outTradeNo`/`totalAmount` from the merchant's order store; `verify()` supports raw-mode signature checking.
- Static template hoisting: fully static JSX subtrees are serialized to module-level HTML templates (`createTemplate`) and mounted with a single `cloneTemplate` call at runtime; dynamic roots hoist contiguous static child blocks, shrinking output and mount cost.
- `sourceLocation` compile option (default `true`): set `false` to omit per-component `{ file, line, column }` payloads from generated code. The Vite plugin strips them automatically for `vite build` (errors still carry component names; positions resolve via source maps); an explicit `compiler.sourceLocation` overrides the default.

## [1.2.0] - 2026-09-9

### Fixed

- Compiler reentrancy: per-compile state replaces module-level variables, so plugins that compile fragments during a compilation — and concurrent compilations — no longer leak identifiers, helper aliases, or diagnostics across compilations.
- Primitive list items now update when their value changes; object items still update in place through per-row proxies.
- Dynamic children (arrays and swapped nodes) now dispose their entire previous scope, preventing ghost effects from writing to detached DOM and fixing memory leaks in swapped arrays.
- `spreadProps`/`setStaticProps` apply `false` for property keys (e.g. `disabled={false}` clears the property) while attribute keys keep HTML semantics.
- Resource client view owner leak when the index of a list entry changes.
