# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.0] - 2026-09-11

### Added

- HMR 状态保鲜（dev 默认开启）：模块顶层的 `state()` 声明编译为 `hmrStateRef(...)`，热更新重执行模块时复用既有信号实例，消除"新旧两份模块实例、两份状态"导致的编辑不生效/页面半边失灵。声明了模块级 state 的 `.ts`（store 类）模块也纳入 HMR 处理。新选项 `vobsPlugin({ hmrState: false })` 可关闭；编译器侧对应 `hmrModuleId` 选项。
- `@vobs/vobs` 新增 `./jsx` 导出：全局 JSX 类型声明（含 `checked` 等 property 属性与完整的 HTML 标签表）随 dist 发布，消费方在 tsconfig 中添加 `"types": ["@vobs/vobs/jsx"]` 即可获得 JSX 类型，不再需要本地手工维护 jsx.d.ts。

### Fixed

- 编译器：任意位置的 JSX 不再泄漏到 Vite 的 esbuild 降级路径（此前 `if` 块内的 `return <JSX/>`、嵌套函数/初始化器中的 JSX 会编译成 `React.createElement`，无 React 环境运行即崩）。
- 编译器：嵌套三元（`a ? <A/> : b ? <B/> : <C/>`）与 `&&` 嵌套动态节点的所有分支完整编译，此前只有第一个分支被保留。
- 运行时：`<select value>` 在 option 子节点就绪前赋值不生效的问题由运行时在微任务中重放修复，消费方不再需要 `ref + queueMicrotask` 规避。
- 运行时：组件渲染 untrack。组件体内的信号读取不再被收集为祖先 effect（insertDynamic/路由挂载）的依赖——此前一次无关编辑会触发整棵子树销毁重建（输入框被换掉、焦点丢失、事件监听随旧树失效），这是动态表单"编辑无响应"问题的根因。
- 运行时：已销毁 Owner 上的事件监听直接忽略，不再抛"已销毁的 Owner"错误噪音。
- `@vobs/ui`：`VuiChildren` 类型补齐 `null`/`undefined`/`boolean` 成员，条件 JSX 子节点（`{cond ? <A/> : null}`）可直接通过类型检查。
- `@vobs/router`：`RouterViewProps.loading` 接受节点或工厂双形态，与编译产物的 getter 语义一致。
- 构建脚本：独立的 `.d.ts`（如 jsx.d.ts）正确复制进 dist。

## [1.2.2] - 2026-09-10

### Fixed

- Published dist bundles no longer inline shared internals. Cross-package `@vobs/*` imports, third-party dependencies (`typescript`, `parse5`, …), and Node builtins are now externalized, so all packages share one instance of reactivity/runtime/context at runtime. Previously every dist bundled its own copy, which broke cross-package singletons when consumed from npm — `useRouter` injection failed ("找不到 Router"), `@vobs/ui` threw 渲染器未初始化, and effects created across package boundaries escaped the owner tree.

### Changed

- `scripts/build-packages.mjs`: removed the tsup `treeshake` and `skipNodeModulesBundle` options that silently dropped the `external` list (workspace symlinks made `skipNodeModulesBundle` skip only real node_modules packages while still inlining workspace sources). The external list now derives from each package's `dependencies`/`peerDependencies` plus `@vobs/*` and `node:*` patterns.

## [1.2.1] - 2026-09-10

### Changed

- Test and benchmark infrastructure upgraded to vitest 5: the benchmark DSL moved from a top-level `bench` export to a test-context fixture (`test(({ bench }) => ... bench(...).run())`), and the four benchmark files were rewritten accordingly. All tests pass unchanged on the new runner.

## [1.2.0] - 2026-09-10

### Added

- Public dual-track package artifacts for all 36 `@vobs/*` packages, including `@vobs/cli` and `@vobs/payment`.
- ESM, CJS, declaration, and `/source` entry points are now included in the automated package verification and release workflow.

## [1.1.0] - 2026-09-09

### Added

- Real statement-level source maps for compiled TSX, with structured compiler diagnostics (`VOBS_Cxxx`) including source locations, code frames, and fix hints. Unsupported JSX shapes (member-expression and namespaced tags) now fail explicitly.
- Collision-safe runtime helper injection: compiler-provided helpers no longer conflict with user imports or local bindings of the same names.
- Resource client revision guard on every settle path, so late in-flight responses can no longer overwrite newer data or resurface stale errors after `mutate`/`optimistic`.
- Router guard against stale navigation commits: a navigation superseded during loader execution can no longer push history or overwrite the current route.
- Router navigation state: pass per-entry state via `RouteLocationRaw.state`, read it back as `RouteLocation.state` (persisted through history adapters and restored on `back`/popstate).
- `@vobs/payment`: gateway responses are now checked for business errors (`code !== '10000'` throws `AlipayApiError` with `sub_code`/`sub_msg`) instead of silently mapping undefined fields; notification `validate()` accepts expected `outTradeNo`/`totalAmount` from the merchant's order store; `verify()` supports raw-mode signature checking.
- Static template hoisting: fully static JSX subtrees are serialized to module-level HTML templates (`createTemplate`) and mounted with a single `cloneTemplate` call at runtime; dynamic roots hoist contiguous static child blocks, shrinking output and mount cost.
- `sourceLocation` compile option (default `true`): set `false` to omit per-component `{ file, line, column }` payloads from generated code. The Vite plugin strips them automatically for `vite build` (errors still carry component names; positions resolve via source maps); an explicit `compiler.sourceLocation` overrides the default.

### Changed

- `insertList` keyed reconciliation computes minimal DOM movement via LIS (strict longest increasing subsequence) and checks disposal with a Set, so update cost is proportional to the number of moved rows: swapping two rows of a 1000-row list went from slower than a full reversal (34.2 ms) to 0.45 ms; first mount takes an append-only fast path.
- Reactivity scheduler flush reuses its buffer arrays and sorts normal/low groups without per-flush `Set` lookups: a batch write to 100 signals with 100 dirty effects flushes ~14% faster.
- Debug hook invocations are guarded by `hasDebugHooks()`, eliminating rest-argument array allocations on every signal read/write and effect run when no debug hooks are attached (production default).

### Fixed

- Compiler reentrancy: per-compile state replaces module-level variables, so plugins that compile fragments during a compilation — and concurrent compilations — no longer leak identifiers, helper aliases, or diagnostics across compilations.
- Primitive list items now update when their value changes; object items still update in place through per-row proxies.
- Dynamic children (arrays and swapped nodes) now dispose their entire previous scope, preventing ghost effects from writing to detached DOM and fixing memory leaks in swapped arrays.
- `spreadProps`/`setStaticProps` apply `false` for property keys (e.g. `disabled={false}` clears the property) while attribute keys keep HTML semantics.
- Resource client view owner leak when the index of a list entry changes.
