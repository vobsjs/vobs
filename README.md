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

[`packages/dsh-plugin`](packages/dsh-plugin) 是把 vobs 接到 DeepSeek Harness 的插件组合包：它是 DSH 客户端插件契约（`dsh.bundle.patch` + `dsh.client` + `window.__ModuleLoader__` factory）的一份可用参考实现，用 vobs 在 DSH 界面右下角渲染一块浮层（信号计数、memo 派生值、effect 执行次数、`insertList` 增删的标签列表），外壳只有一个极薄的 React 宿主。

```bash
pnpm build:packages      # 首次：产出 @vobs/vite-plugin 的构建产物
pnpm build:dsh-plugin    # 产出 packages/dsh-plugin/lib/{index,client}.js
node packages/dsh-plugin/scripts/verify-client.mjs   # 对已构建产物做 jsdom 校验
```

插件契约、GitHub 子目录直装方式（`github:vobsjs/vobs#<tag>&path:/packages/dsh-plugin`）与 Windows CLI 的 `&` 陷阱都写在 [`packages/dsh-plugin/README.md`](packages/dsh-plugin/README.md)。该包不参与 `@vobs/*` 发布火车（不在 `publish:packages` 白名单里），版本号独立。

## Development

```bash
pnpm install
pnpm test        # vitest in watch mode
pnpm test:run    # single pass
pnpm typecheck   # tsc --noEmit
pnpm dev         # playground
pnpm build       # package artifacts + typecheck + playground production build
pnpm verify:packages # all publishable tarball ESM/CJS/types/source smoke checks
```

- Node 20+, pnpm workspace
- `packages/*` — framework packages; all 36 public packages publish `dist` ESM/CJS/types and retain `src` through an explicit `/source` entry
- `playground/*` — integration examples covering router, devtools, i18n, theme, and more
