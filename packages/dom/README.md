# @vobs/dom

Browser DOM adapter implementing the `VobsRenderer` interface, plus the runtime node and reactive binding primitives.

## Install

```bash
npm install @vobs/dom
```

## Quick start

```ts
import { createDOMRenderer, setRenderer, createElement, createText, insertBefore, bindText } from '@vobs/dom'
import { state } from '@vobs/reactivity'

setRenderer(createDOMRenderer())

const count = state(0)
const span = createElement('span')
const text = createText('')
insertBefore(span, text, null)
bindText(text, () => `count: ${count.value}`)
insertBefore(document.body, span, null)
```

## API

| Signature | Description |
| --- | --- |
| `createDOMRenderer(): VobsRenderer<Node, Text, Element, Comment>` | Create the browser DOM renderer implementation. |
| `setRenderer(renderer)` / `getRenderer()` | Install or read the renderer used by the node factories. |
| `createElement(tag)` / `createText(content)` / `createComment(content)` | Create nodes through the active renderer. |
| `insertBefore(parent, child, anchor)` / `removeChild(parent, child)` | Insert or remove nodes. |
| `setTextContent(node, content)` / `setProperty(node, key, value)` / `setAttribute(node, key, value)` | Update node content, properties and attributes. |
| `setStaticProps(node, props)` | Apply a static props object to an element. |
| `addEventListener(node, event, handler)` / `removeEventListener(node, event, handler)` | Bind or unbind event handlers. |
| `bindText(node, source)` / `bindAttribute(node, key, source)` | Reactive bindings from a `ValueSource` (signal or getter). |
| `insertDynamic(parent, anchor, factory)` | Conditional block that creates and disposes nodes reactively. |
| `insertList(parent, anchor, source, renderItem, keyOf?)` | Keyed or indexed list rendering. |
| `createComponent(fn, props)` / `createFragment(factory)` / `createBlock(factory)` | Component, fragment and lazy block primitives. |
| `ref(initialValue?)` / `setRef(node, target)` | Ref objects for direct node access. |
| `insertErrorBoundary(parent, anchor, options)` / `insertAsyncBoundary(parent, anchor, options)` | Error and async boundaries without wrapper nodes. |
| `insertProfiler(parent, anchor, options)` | Profiler scope. |
| `disposeNodeOwner(node)` / `clear(container)` | Dispose a node's owner / remove all children. |

## Types

VobsRenderer, FragmentFactory, VobsFragment, VobsNode, ValueSource, Ref, RefTarget, NodeFactory, ErrorBoundaryFallback, ErrorBoundaryOptions, AsyncBoundaryFallback, AsyncBoundaryOptions, AsyncBoundaryProps, AsyncBoundaryView, ProfilerOptions, ProfilerProps, ProfilerRenderInfo
