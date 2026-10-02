# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.8.0] - 2026-10-02

本次发布的主体是**把实战踩坑里"靠人肉纪律"的条目变成框架能力**，外加一批静默缺陷的修复。
少数版本号规则上算 minor，但内容量按 patch 看待是不对的 —— 有 6 个新 API。

### Added

- **生命周期与客户端守卫三件套**（`@vobs/vobs`）——此前 D 条踩坑靠手写 `typeof window` 绕过：
  - `onMount(fn)` —— 挂载**之后**跑一次（微任务），此时 DOM 已在文档中，可量尺寸 / `focus` / 读 `matchMedia`。组件在此之前被卸载则**不执行**；服务端没有 `document` 时**不执行**。返回撤销函数。
  - `onDestroy(fn)` —— 与 `onMount` 成对的清理位置。**与既有的 `onDispose` 是同一操作**（后者是底层原语，前者是面向生命周期的名字）。与 `onDispose` 的差异：不在任何 Owner 下调用时**抛出**（清理注册落空 = 泄漏，而"清理没跑"最难查）。
  - `ClientOnly({ children, fallback })` —— **渲染输出本身**在服务端算不出来的子树（窗口尺寸 / `localStorage` 回填 / `Date.now` / 随机值）。两阶段：首轮服务端与客户端**都**渲染 `fallback`（水合对得上），挂载后才换入 `children`。用 `createFragment` 拿父节点，**不插包裹层**。
- **`Show` 与 `classList`**（`@vobs/vobs` / `@vobs/runtime`）—— 把 C 条的对策（「固定渲染 + 响应式 class 显隐」）从人肉纪律变成一行：
  - `<Show when={…}>` —— **保留挂载**，只切 `hidden` + `inert`（移出焦点顺序与无障碍树）。输入控件的焦点、滚动位置、内部状态不再因条件翻转而丢失。`children` 必须是单个元素（否则**抛出并说明替代写法**，不静默退化成卸载）。
  - `classList={{ 'is-open': open.value }}` —— 支持对象 / 数组 / 字符串；**只贡献自己那部分**，作者的 `class` 不受影响；按元素记账，反复切换**不叠加**。静态、展开、`bindAttribute` 三条通道都生效。
- **数字输入解析契约**（`@vobs/forms`）—— `Number('') === 0` 会在用户清空输入框时把值写成 `0`，沿「比例锁定」链路把兄弟维度一并清零。新增 `parseNumber(text, options)`：空串 / 非法 / 超界一律**不提交**（保持最后一次有效值）；刻意不用 `Number()` 的宽松解析（`Number('0x10') === 16`）。`Field` 在 `type="number"`（或给了 `min`/`max`/`step`）时走该通道并提交 **`number` 类型**，失败通过 `onNumberInvalid(reason, text)` 通知。其它类型行为不变。
- **两条编译期诊断**（`@vobs/compiler`）：
  - `VOBS_C104` —— 组件顶层**裸条件 `return`**（`return cond ? <X/> : null`、`return cond && <X/>`）。组件 run-once，这个 `return` 只求值一次，界面永远不会切换；而它与 JSX 子节点位置的条件写法极像。
  - `VOBS_C105` —— **模块顶层 JSX**。模块 import 求值早于渲染器初始化，运行时必炸且堆栈指向 import 它的地方。**刻意为 warning 而非 error**：error 会让 `compile()` 抛错，打断所有"拿代码片段当输入"的工具（实测 46 条编译器测试变红）。
- **运行时护栏检查**（仓库脚本）—— `pnpm run check:runtime` / `check:runtime:interact`。起一个把收集器注入页面的 dev server，用真实 Chrome 逐路由（交互模式还会点所有按钮、触发所有输入）取回护栏报错，以退出码表达结论。**静态分析抓不到"读或写跨过函数边界"的自订阅**——本仓库真实修过的 4 个自订阅里静态只抓到 1 个。
- **`@vobs/forms` 的 `parseNumber` / `@vobs/icon-core` 的缺失图标警告** —— 后者让「查表 miss 静默空白」在控制台点名（按名字去重），grep 产物的三步法不再是唯一防线。
- **发版脚本**：`pnpm run release:version <版本>` 一次统一根 + 全部可发布包（只替换顶层 `version`，diff 恰好一行）。`pnpm run check:release` 不带标签时进入**一致性模式**——校验包之间与**根版本**是否同步（此前它在本地必然失败，且完全不检查根版本，实测漂移：37 个包在 1.7.8、根还在 1.7.7）。

### Fixed

- **`createComponent`：组件返回 `null` / `undefined` / `false` 直接崩溃**（`Invalid value used as weak map key`）。渲染结果被当作 `nodeOwners` 这个 WeakMap 的 key，而空值不是合法 key —— App 挂载即崩、**没有任何 JS 崩溃日志**、splash 兜底失效。这是 Labelune 2026-09-30 发版黑屏的根因。现统一归一化成**空注释节点**（渲染为空的既有原语），视觉与返回 `null` 一致而下游不需要各自特判。
- **`@vobs/resource`：响应式 key 的 effect 自订阅** —— 同一 effect 内既 `sync()` 读 `entry.data/error/loading`、又 `request()` 写同一信号。护栏在每个用到响应式 key 的页面都报 `VOBS_C210`。现拆成两条 effect（key effect 只追踪 key；entry 的同步走独立作用域，换 entry 时整条重建）。
- **`@vobs/runtime`**：
  - `ref` 清理：坏的回调 ref（收到 `null` 时抛错）会**中断整个 dispose 级联**，同一 Owner 后续所有 cleanup 全部不执行。清理路径现已逐个隔离；新增 `Owner.removeCleanup`，同一 ref 重绑不再累积陈旧注册。
  - `removeEventListener` 忽略传入的 handler，只要 `(node,event)` 有绑定就一律摘除 —— 用另一个 handler 调用会**误摘别人的监听**。现按 handler 身份比对（DOM 语义）。
  - `<select>` 值重放在插入 option 时同步读信号，把依赖算进外层 effect → 隐藏订阅。现走 `untrack`。
- **`@vobs/ssr`**：
  - `id` / `style` / `title` 在产物里**直接消失**（白名单过窄），首屏 CSS 选择器与 `getElementById` 拿不到。现走属性通道。
  - 把对象当文本时**直接报错**，不再静默产出 `[object Xxx]`。判据覆盖整族并要求类型名首字母大写 —— 只认 `[object Object]` 会漏掉最常踩的形态 `[object HTMLDivElement]`（JSX 节点作 props / 存数据常量）。
- **`@vobs/theme`**：scoped `setBrand` 漏 `untrack`（effect 内调用即自订阅，runs 撞 100 轮）；`ThemeBoundary` 的 `provide` 缺 `override` —— **在 `themePlugin` 子树内直接使用就崩**。
- **`@vobs/table`**：带 `rowKey` 时 `column.render(row, index)` / `onRowClick` 收到的 `index` 冻结在创建位置（重排后渲染出 `Lin#1 / Ada#0`）。`data-row-key` 仍用创建时的值（行身份不该跟着位置漂）。
- **`@vobs/http`**：重试不认 `Retry-After`（服务端 429/503 下 4ms 内打完 3 次请求，是放大器）；去重键不含 `responseType`/`credentials`/`cache`（同 URL 并发要 `json` 与 `blob` 会串台）。
- **`@vobs/i18n`**：`I18nBoundary` 不传 `locale` 时不跟随父级 `setLocale`（`locale` 只在创建时读一次，而 `messages` 早有同步 effect）。
- **`@vobs/ui`**：focus trap 把不可见元素算作可聚焦 —— `hidden` / `display:none` / `visibility:hidden` / `tabindex="-1"` / `inert` / 祖先隐藏全部进入列表，于是 `last` 端点算错，Tab 把焦点送进不可见区域。
- **`@vobs/layout`**：移动抽屉关闭后侧栏链接**仍可 Tab**（只切 CSS 定位，没有 `inert`）；侧栏可见性完全不看 `mobileOpen`。
- **`@vobs/queue`**：已结束任务**永不移出列表** —— 同一个 id 用完不能再复用（`idFactory` 按业务键生成的应用第一个任务结束就再也提交不了）；长会话无界增长。`completed`/`failed` 改为累计计数，`total` 与其余四个计数自洽。
- **`@vobs/forms`**：`Field` 吞掉 `type="password"` → 密码框渲染成**明文**。
- **`@vobs/vite-plugin`**：`resolveId` 返回反斜杠而 `load` 用正斜杠 → **Windows 上 HTML 组件整功能失效**。
- **`@vobs/cli`**：`vobs check <无效路径>` 报"检查通过"且 exit 0（CI 永久绿灯）；未知命令静默 exit 0；版本号硬编码；`--json --write` 污染 stdout。
- **`@vobs/payment`**：`notify.validate` 省略 `expected` 即 `valid: true`（失败开放，微信 + 支付宝）；现为必填并失败关闭。
- **`@vobs/compiler`**：静态 `htmlFor="x"` 落成 `htmlfor`（label 与控件静默断开）；`autoFocus={false}` 反而真的聚焦（布尔属性只看存在与否，且 JSX 名与 IDL 名 `autofocus` 不一致）。
- **`reactivity`**：`Effect` 改用 class 原型字段（唤醒路径 **−18%**，同进程 A/B 7 轮、区间不重叠）。

### Notes

- **`Retry-After` / 去重键 / `removeEventListener` 身份**这些改动在少数边界上收紧了行为（例如去重不再合并 `responseType` 不同的请求）。若你的代码依赖旧行为，请核对 `@vobs/http` 的 README。
- **`Field` 的数字通道是新语义**：`type="number"` 时清空输入框**不再**产生 `0`（保持原值）。需要"清空即写 0"的场合请在 `onNumberInvalid` 里显式处理。
- **`Show` 要求单个元素子节点**（它需要宿主元素挂 `hidden`/`inert`，框架不插包裹层）。需要真正卸载请继续用 JSX 条件表达式。
- **`onDestroy` 与 `onDispose` 做的是同一件事**，两者都可用。新增的差异只有"无 Owner 时抛出"。
- `VOBS_C105` 是 **warning**；想强拦可在 CI 里把 warning 当失败。
- 契约速查里标记为 C 类的 7 条（显隐助手 / 守卫原语 / 白名单警告 / 顶层 JSX / 编译期检测 / 循环警告 / 数字输入）本次已落地 7 条中的 7 条 —— 相应条目可从"手搓契约"降级为"推荐用新 API"。

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
