# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
