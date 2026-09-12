# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
