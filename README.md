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

## Development

```bash
pnpm install
pnpm test        # vitest in watch mode
pnpm test:run    # single pass
pnpm typecheck   # tsc --noEmit
pnpm dev         # playground
pnpm build       # typecheck + playground production build
```

- Node 20+, pnpm workspace
- `packages/*` — framework packages (source-referenced, no build step yet)
- `playground/*` — integration examples covering router, devtools, i18n, theme, and more
