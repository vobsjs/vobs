# @vobs/transition

Enter/leave transitions for vobs nodes: a CSS class lifecycle with optional inline from/to styles, cancellation when state flips mid-animation, `prefers-reduced-motion` support, and keyed list transitions.

## Install

```bash
npm install @vobs/transition
```

## Quick start

```ts
import { state } from '@vobs/reactivity'
import { createComponent, createDOMRenderer, createVobs, setRenderer } from '@vobs/vobs'
import { Transition } from '@vobs/transition'

setRenderer(createDOMRenderer())

const show = state(true)

const app = createVobs({
  render: () => createComponent(Transition, {
    get show() { return show.value },
    name: 'fade',
    duration: 120,
    appear: true,
    onAfterLeave: () => console.log('gone'),
    children: 'Content'
  })
})

app.mount(document.getElementById('app')!)
```

`name: 'fade'` drives `fade-enter-from`/`-active`/`-to` and `fade-leave-*` classes. During leave the node stays mounted until the animation ends, so owners and disposals survive until then; toggling `show` back before the leave finishes cancels it (`onLeaveCancelled`) and keeps the same node. When `prefers-reduced-motion` matches, enter and leave complete immediately.

## API

| Signature | Description |
| --- | --- |
| `Transition(props: TransitionProps)` | Wraps a single child. Omit `show` to render and enter once; `appear` animates the initial visible branch. `enter`/`leave` phases accept `{ duration, easing, from, to }` inline styles, restored after `transitionend` (or the shared `duration`). Callbacks: `onBeforeEnter`, `onEnter`, `onAfterEnter`, `onEnterCancelled`, and the matching leave hooks. `reducedMotion` respects the media query by default in DOM environments. |
| `TransitionGroup<Item>(props: TransitionGroupProps<Item>)` | Keyed list transitions via `items` + `keyOf` + `renderItem`. Leaving items are removed only after their leave completes; `renderItem` receives a refreshed index after reorders; duplicate keys throw before the DOM is committed. A stable `children` array is also supported. |
| `createCSSTransitionDriver()` / `cssTransitionDriver` | The built-in CSS driver. Pass a custom `TransitionDriver` — `run(node, phase, options, done)` returning a `TransitionRun` with `cancel()` — through the `driver` option for JS-driven animation. |

SSR renders the current visible branch without touching the DOM and without emitting transition classes.

## Types

TransitionStyle, TransitionPhase, TransitionPhaseName, TransitionRun, TransitionDriver, TransitionDriverOptions, TransitionCallbacks, TransitionOptions, TransitionChildren, TransitionProps, TransitionGroupProps, TransitionStatus
