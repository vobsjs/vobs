# @vobs/runtime

The renderer-agnostic runtime of the vobs framework: DOM operations, compiled bindings, dynamic insertion, list reconciliation, and lifecycle boundaries.

This package implements the operations the vobs compiler emits (`createElement`, `bindText`, `insertList`, ...) against a pluggable `VobsRenderer`, so the same component code runs under different rendering backends.

## Install

```bash
npm install @vobs/runtime @vobs/reactivity
```

## Quick start

### Boundaries (user-facing)

```tsx
import { ErrorBoundary, AsyncBoundary } from '@vobs/runtime'

<ErrorBoundary fallback={(error, retry) => <button onClick={retry}>Retry</button>}>
  <RiskyView />
</ErrorBoundary>

<AsyncBoundary fallback={<Spinner />}>
  <SlowView />
</AsyncBoundary>
```

### Dynamic children and lists

```ts
import { effect, state } from '@vobs/reactivity'
import { insertDynamicValue, insertList, createFragment } from '@vobs/runtime'

const view = state(<span>hello</span>)
insertDynamicValue(parent, anchor, () => view.value)   // swaps nodes reactively

const items = state(['a', 'b'])
insertList(parent, anchor, () => items.value, {
  key: item => item    // keyed reconciliation; indexed when omitted
})
```

Reactive text binding:

```ts
import { bindText } from '@vobs/runtime'

bindText(node, () => count.value)
```

### Custom renderers

Implement `VobsRenderer` (node creation, insertion, removal, attribute/property/event application, clearing) and register it with `setRenderer`. All compiler-emitted operations route through it.

## API

| Signature | Description |
| --- | --- |
| `setRenderer(renderer)` / `getRenderer()` | Registers the active renderer backend. |
| `createElement(tag)` / `createText(text)` / `createComment(text)` | Node factories (hydration-aware). |
| `insertBefore(parent, node, anchor)` / `removeChild(parent, node)` | Tree mutation, fragment-aware. |
| `setAttribute(node, name, value)` / `setProperty(node, name, value)` | Attribute vs property writes; `isPropertyKey` gates the property whitelist. |
| `addEventListener(node, event, handler)` | Registers under the current owner — handlers get owner-scoped error isolation and are removed on owner dispose. |
| `spreadProps(node, props)` / `setStaticProps(node, props)` | Apply prop objects; property keys accept `false`, attribute keys skip it. |
| `bindText` / `bindAttribute` / `bindProperty` | Reactive one-way bindings to a node target. |
| `ref(target)` / `setRef(node, target)` | Ref plumbing for element access. |
| `insertDynamic(parent, anchor, factory)` / `insertDynamicValue(...)` | Reactive node swapping with full disposal of replaced subtrees. |
| `insertList(parent, anchor, factory, options?)` | Keyed/indexed list reconciliation with per-row owners. |
| `createFragment(render)` | Multi-root node container. |
| `ErrorBoundary` / `insertErrorBoundary` | Catches child render/effect errors with retry. |
| `insertBoundary` | Low-level boundary primitive (loading/error/empty switching). |
| `AsyncBoundary` / `insertAsyncBoundary` | Async view swapping with fallback. |
| `Profiler` / `insertProfiler` | Render timing instrumentation. |
| HMR exports (`createHmrStateStore`, `registerHmrInstance`, `updateHmrModule`, ...) | Hot-reload state preservation. |

## Types

`VobsRenderer`, `VobsNode`, `VobsFragment`, `DynamicChild`, `NodeFactory`, `Ref`, plus option types for each boundary.
