# @vobs/reactivity

The signals engine of the vobs framework: state, memo, effect, scheduler, and the owner tree that manages disposal.

Pull-based evaluation with push-invalidation: writes mark dependents dirty instead of eagerly recomputing, a microtask flush runs only dirty nodes (deduplicated), and loops are detected and thrown after a bounded number of rounds.

## Install

```bash
npm install @vobs/reactivity
```

Framework-free — usable without the vobs renderer.

## Quick start

```ts
import { state, memo, effect } from '@vobs/reactivity'

const count = state(0)
const doubled = memo(() => count.value * 2)

effect(() => console.log(doubled.value)) // logs 0
count.value = 2                          // logs 4 (batched into a microtask flush)
```

### Ownership and disposal

Every effect, memo, and signal created inside an owner is disposed with it:

```ts
import { createOwner, effect, onDispose } from '@vobs/reactivity'

const owner = createOwner()

owner.run(() => {
  effect(() => trackSomething())
  onDispose(() => console.log('cleanup'))
})

owner.dispose() // runs 'cleanup', disposes the effect
```

### Batching

```ts
import { batch, state } from '@vobs/reactivity'

batch(() => {
  first.value = 'a'
  last.value = 'b'   // observers run once, after both writes
})
```

## API

| Signature | Description |
| --- | --- |
| `state(value)` | Creates a writable signal. Read/write via `.value`; subscribes the current effect/memo on read. |
| `memo(fn)` | Cached derivation; recomputes only when dependencies change and the value is read after invalidation. |
| `effect(fn)` | Runs `fn` immediately, then re-runs on dependency changes. Auto-disposed by the current owner. `renderEffect` is a render-side alias. |
| `untrack(fn)` | Reads signals without subscribing. |
| `batch(fn)` | Defers flushes until `fn` returns. |
| `scheduleLow(fn)` | Schedules work at lower scheduler priority. |
| `scheduler` | Flush scheduler with priority lanes and cycle detection. |
| `createOwner()` / `getCurrentOwner()` / `runWithOwner(owner, fn)` | Owner tree primitives for scoped lifecycle. |
| `onDispose(cleanup)` | Registers cleanup on the current owner (throws outside an owner). |
| `setOwnerDebugName(owner, name)` / `getOwnerDebugName(owner)` | Names for devtools inspection. |
| `useId(prefix?)` / `createId()` | SSR-stable unique ids. |

## Types

`Signal<T>`, `Memo<T>`, `Effect`, `Owner`, `Scheduler`, `Dependency`, `Subscriber`.
