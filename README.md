# vobs

Signals First · Zero Re-renders · Ultra Lightweight

> v1.0 — released on npm. Published packages under `@vobs/*` scope.

## Core model

- **Signals** — fine-grained reactivity (`state` / `memo` / `effect`). Pull-based evaluation with push-invalidation, dirty deduplication, and microtask-batched flushes with cycle detection.
- **Compiler** — JSX is compiled at build time into targeted DOM bindings (`bindText`, `bindAttribute`, `bindProperty`), control flow into `insertDynamic`, and lists into `insertList` (keyed or indexed reconciliation). Attributes compile into independent effects, so updating one prop never touches the others.
- **Run-once components** — a component function executes exactly once. There is no re-render. Dynamic parts are signals and effects; the `Owner` tree tracks every component instance and disposes signals, effects, and listeners when it leaves the tree.

## Quick start

```bash
npm install @vobs/vobs @vobs/vite-plugin
```

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import { vobsPlugin } from '@vobs/vite-plugin'

export default defineConfig({
  plugins: [vobsPlugin()]
})
```

```tsx
// counter.tsx
import { state } from '@vobs/vobs'

export function Counter() {
  const count = state(0)
  return <button onClick={() => count.value++}>Count: {count.value}</button>
}
```

```ts
// main.ts
import { createVobs } from '@vobs/vobs'
import { Counter } from './counter'

const app = createVobs({ render: () => <Counter /> })
app.mount(document.getElementById('app')!)
```

The compiler emits plain DOM operations — a component's initial render is a straight-line function, and updates are signal-driven effects scoped to individual DOM bindings.

## Packages

| Package | Description |
| --- | --- |
| [`@vobs/vobs`](packages/vobs) | Umbrella entry: reactivity + runtime + DOM renderer, `createVobs`, context, JSX runtime |
| [`@vobs/reactivity`](packages/reactivity) | Signals, effects, memos, scheduler, owner tree |
| [`@vobs/runtime`](packages/runtime) | Renderer-agnostic DOM ops, dynamic insertion, lists, boundaries, HMR |
| [`@vobs/compiler`](packages/compiler) | TS/JSX compiler with real statement-level source maps and structured diagnostics |
| [`@vobs/vite-plugin`](packages/vite-plugin) | Vite integration: TSX transform, HTML components, HMR |
| [`@vobs/dom`](packages/dom) | DOM renderer adapter (`createDOMRenderer`) |
| [`@vobs/ssr`](packages/ssr) | String renderer, hydration, state serialization |
| [`@vobs/router`](packages/router) | Fileless router: guards, loaders, lazy components, data-request tracing |
| [`@vobs/resource`](packages/resource) | Async resource client with cache strategies and revision-safe mutations |
| [`@vobs/http`](packages/http) | HTTP client: adapters, retry, timeouts, streaming, WebSocket |
| [`@vobs/auth`](packages/auth) / [`@vobs/jwt-auth`](packages/jwt-auth) | Session context and JWT refresh lifecycle |
| [`@vobs/storage`](packages/storage) | Namespaced localStorage/sessionStorage with envelopes and cross-tab sync |
| [`@vobs/sync`](packages/sync) / [`@vobs/queue`](packages/queue) | Offline sync engine and retryable task queue |
| [`@vobs/i18n`](packages/i18n) / [`@vobs/dict`](packages/dict) | Translations with fallback chains; async dictionary service |
| [`@vobs/theme`](packages/theme) | Design tokens, dark mode, system preference tracking |
| [`@vobs/preferences`](packages/preferences) | Schema-validated user preferences with autosave |
| [`@vobs/notification`](packages/notification) | Toast/notification state with timers and overflow policy |
| [`@vobs/payment`](packages/payment) | Payment integration: Alipay, WeChat (extension SDK) |
| [`@vobs/upload`](packages/upload) | Concurrent upload queue with progress and cancellation |
| [`@vobs/captcha`](packages/captcha) | Slider and challenge captchas |
| [`@vobs/forms`](packages/forms) | Form state, validation, submit lifecycle |
| [`@vobs/ui`](packages/ui) | Core UI components: dialog, drawer, popover, overlay, focus trap |
| [`@vobs/layout`](packages/layout) | App shell layout: header, sidebar, menus, viewport |
| [`@vobs/kit`](packages/kit) | High-level composition of ui + layout + table + auth + i18n + theme |
| [`@vobs/table`](packages/table) | Data table: sort, filter, paginate, column settings |
| [`@vobs/transition`](packages/transition) | Enter/leave animation driver with cancellation |
| [`@vobs/icon-core`](packages/icon-core) | Icon rendering primitives |
| [`@vobs/logger`](packages/logger) | Structured logging |
| [`@vobs/devtools`](packages/devtools) | Debug hooks: owners, signals, effects, network tracing |
| [`@vobs/devtools-ui`](packages/devtools-ui) | Devtools panel UI |
| [`@vobs/tailwind`](packages/tailwind) | Tailwind CSS v4 integration and theme bridge |
| [`@vobs/test-utils`](packages/test-utils) | Test helpers for component and renderer assertions |

## DSH 插件

vobs 可以拿来写 [DeepSeek Harness](https://github.com/deepseek-ai) 的客户端插件。仓库里是**一套工具链 + 三个插件包**：

| 包 | 作用 |
| --- | --- |
| [`@vobs/dsh`](packages/dsh) | 运行时适配（`defineDshPlugin` / `defineDshOverlay` / `defineDshPanel`）+ `dshBundle()` 构建插件 + `@vobs/dsh/preview` 本地预览运行时 |
| [`@vobs/cli`](packages/cli) | `vobs dsh init / dev / build / check / install` 命令组与插件模板；另有 `vobs check` 源码静态检查 |
| [`packages/dsh-plugin`](packages/dsh-plugin) | 最小可用插件（浮层），也是「vobs → DSH」的参考实现 |
| [`packages/dsh-console`](packages/dsh-console) | **Vobs Console**：注册进 `main` slot 的多会话实时驾驶舱（总览 / 事件流 / 工具分析 / 产物） |
| [`packages/dsh-devkit`](packages/dsh-devkit) | **Vobs 开发台**：项目检查（读 `.vobs/check.json`）/ 护栏 / API / 示例 / 状态 |

这三个 `dsh-plugin*` 包与其余包共用版本号（仓库统一），但**不发布到 npm** —— 它们靠 Git 标签或提交 + `#path:` 子目录分发。

### 用户怎么装

#### 方式一：DSH 插件页（推荐）

侧栏 → **Plugins** → **Add plugin**。该对话框接受**包名、Git 地址、tarball 或本地绝对路径**，粘贴：

```text
github:vobsjs/vobs#<ref>&path:/packages/dsh-console
github:vobsjs/vobs#<ref>&path:/packages/dsh-devkit
```

Host 会先读取 spec 指向的内容再执行 pnpm（能看到 pnpm 输出），装完**需要把它的开关打开**，然后**完全退出 DSH 再打开**。一次只能装一个。

#### 方式二：命令行

```bash
dsh plugin --profile <profile> add "github:vobsjs/vobs#<ref>&path:/packages/dsh-devkit"
```

也可以用自带 CLI（它会替你处理 Windows 上 `&` 被当成命令分隔符的问题，并在 pnpm < 11 时警告）：

```bash
vobs dsh install --repo vobsjs/vobs --tag <ref> --subpath /packages/dsh-devkit --profile <profile>
```

#### 方式三：本地目录（改这两个面板时最快）

插件页的 Add plugin 也接受**绝对本地路径**。pnpm 装的是链接，所以改完源码 + `pnpm build:dsh` 重建，重启 DSH 即生效，不用推 GitHub：

```text
C:\path\to\vobs\packages\dsh-devkit
```

#### `<ref>` 用哪个

标签或提交 SHA 都行。**仓库里还没有同时包含这两个面板全部修复的标签**，所以现阶段用提交 SHA：

```bash
git rev-parse main     # 拿当前 SHA，粘进上面的 <ref>
```

以后打了版本标签就能写成 `#v1.8.0` 这样。

### 两个必须知道的坑

1. **不要用 `pnpm add` 装。** `&path:` 子目录语法要 **pnpm ≥ 11**；pnpm 10 会**静默忽略**它，把整个 monorepo 根装进来而不是目标子包。DSH 插件页与 `dsh plugin` 用的是 DSH 内置的 pnpm 11。
2. **开发台的「项目」页需要数据**：它读工作区里的 `.vobs/check.json`，由 `vobs check --write` 产出（没有该文件时面板会如实提示该跑什么）。其余页面是构建期打进的静态内容，装完就能看。

### 构建与校验

```bash
pnpm build:packages      # 首次：产出 @vobs/dsh 与 @vobs/vite-plugin 的构建产物
pnpm build:dsh           # 构建三个插件包的 lib/{index,client}.js
node packages/dsh-plugin/scripts/verify-client.mjs     # 54 项产物校验
node packages/dsh-console/scripts/verify-console.mjs   # 62 项
node packages/dsh-devkit/scripts/verify-devkit.mjs     # 65 项
```

产物 `lib/` 是**签入仓库**的 —— DSH 不会构建你的包，所以改了源码必须重新构建并提交（CI 会跑上面三个校验拦住漏重建）。

插件契约、`dshBundle()` 的三条纯度门禁、Windows CLI 的 `&` 陷阱等细节写在 [`packages/dsh/README.md`](packages/dsh/README.md)。

## Development

```bash
pnpm install
pnpm test        # vitest in watch mode
pnpm test:run    # single pass
pnpm typecheck   # tsc --noEmit
pnpm check:source # 源码静态检查（effect 自订阅 / 列表写进分支 / 组件体里读信号）
pnpm dev         # playground
pnpm build       # package artifacts + typecheck + playground production build
pnpm verify:packages # all publishable tarball ESM/CJS/types/source smoke checks
```

- Node 20+, pnpm workspace
- `packages/*` — framework packages; all 37 public packages publish `dist` ESM/CJS/types and retain `src` through an explicit `/source` entry
- `playground/*` — integration examples covering router, devtools, i18n, theme, and more
