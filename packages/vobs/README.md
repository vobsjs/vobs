# @vobs/vobs

The umbrella package of the vobs framework: reactivity + runtime + DOM renderer in a single import, plus application bootstrap (`createVobs`), context (`provide`/`inject`), and the JSX runtime.

## Install

```bash
npm install @vobs/vobs
```

Pair with [`@vobs/vite-plugin`](../vite-plugin) to compile TSX.

## Quick start

```tsx
import { createVobs, createInjectionKey, state, inject, provide } from '@vobs/vobs'

const GreetingKey = createInjectionKey<string>('greeting')

function Hello() {
  const greeting = injectRequired(GreetingKey)
  return <h1>{greeting}</h1>
}

const app = createVobs({
  render: () => <Hello />,
  plugins: []
})

app.mount('#app')          // or app.hydrate('#app') for SSR markup
```

Plugins receive an app context and can provide values, register router/auth/etc., and return a cleanup function that runs on `app.destroy()`.

### Context

```tsx
import { createInjectionKey, provide, inject } from '@vobs/vobs'

const ThemeKey = createInjectionKey<'dark' | 'light'>('theme')

function Toolbar() {
  provide(ThemeKey, 'dark')               // scoped to the current owner subtree
  const theme = inject(ThemeKey, 'light') // read with fallback
}
```

### Reactivity and rendering

Everything from `@vobs/reactivity` (`state`, `memo`, `effect`, `batch`, owner APIs) and the rendering primitives from `@vobs/runtime` (`insertDynamic`, `insertList`, boundaries, refs) are re-exported, with the DOM renderer pre-registered:

```tsx
import { state, ErrorBoundary } from '@vobs/vobs'

function Counter() {
  const count = state(0)
  return <button onClick={() => count.value++}>Count: {count.value}</button>
}

<ErrorBoundary fallback={error => <span>failed: {error.message}</span>}>
  <Counter />
</ErrorBoundary>
```

## App lifecycle

| Member | Description |
| --- | --- |
| `app.mount(target)` | Clears the target and renders into it. |
| `app.hydrate(target)` | Claims server-rendered markup instead of clearing it; mismatched nodes are replaced with a reported error. |
| `app.update()` | Flushes pending scheduler work synchronously (used by HMR and tests). |
| `app.use(plugin)` | Installs a plugin before or after mount. |
| `app.provide(key, value, options?)` | Provides a value into the root owner. |
| `app.destroy()` | Runs plugin cleanups, then disposes the owner tree and clears the container. |

## API highlights

| Signature | Description |
| --- | --- |
| `createVobs(options)` | Creates an app (`render`, `plugins`). |
| `createInjectionKey(description)` | Typed injection key (`Symbol`-based). |
| `provide(key, value, options?)` / `inject(key, fallback?)` / `injectRequired(key)` | Owner-scoped context. |
| `Fragment` / `Vobs` | JSX fragment and runtime entry points (`jsx-runtime`, `jsx-dev-runtime`). |
| `createDOMRenderer()` | The built-in DOM renderer. |
| re-exports | Full `@vobs/reactivity` + runtime ops, bindings, lists, boundaries, HMR. |

## Types

`VobsApp`, `VobsPlugin`, `VobsPluginContext`, `InjectionKey<T>`, plus all re-exported reactivity/runtime types.
