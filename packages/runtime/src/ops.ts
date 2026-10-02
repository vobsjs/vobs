// 编译产物调用的基础操作

import { createOwner, effect, getCurrentOwner, setOwnerDebugName, untrack, type Owner } from '@vobs/reactivity'
import { isVobsFragment, type VobsNode } from './fragment'
import { domAttributeName, isPropertyName } from './dom-props'
import { resolveEventName } from './dom-events'
import { isSvgTag } from './svg'
import { formatVobsError } from './error'
import { describeDebugNode, getRuntimeDebugHooks, invokeRuntimeDebug, readDebugValue } from './debug'
import {
  associateHmrInstance,
  markHmrInstanceMounted,
  registerHmrInstance,
  type HmrInstance
} from './hmr'
import type { VobsRenderer } from './renderer'
import { setRef } from './ref'

type RuntimeRenderer = VobsRenderer<Node, Text, Element, Comment>

let currentRenderer: RuntimeRenderer | null = null
const nodeOwners = new WeakMap<object, Owner>()
interface EventBinding {
  readonly handler: EventListener
  readonly owner: Owner | null
  readonly original: EventListener
}
const eventBindings = new WeakMap<object, Map<string, EventBinding>>()

/*
 * 事件清理槽。目的：让**每个 (Owner, node, event) 只在 `Owner.cleanups` 里占一个槽**，
 * 重绑 handler 时只换槽里的间接引用，数组不增长（理由见 addEventListener）。
 *
 * 用 WeakMap<Owner, Map<key, handle>> 而不是往 Owner 上挂属性：
 * Owner 是 class 实例，挂新属性会把它推进字典模式（reactivity/src/owner.ts:30-50 记过这笔账）。
 * key 由 per-node 数字 id 与事件名拼成，避免每次重绑比较长字符串前缀。
 */
const eventCleanupSlots = new WeakMap<Owner, Map<string, EventBinding>>()
const eventCleanupNodeIds = new WeakMap<object, number>()
let nextEventCleanupNodeId = 0

function eventCleanupKey(node: object, event: string): string {
  let id = eventCleanupNodeIds.get(node)
  if (id === undefined) {
    id = ++nextEventCleanupNodeId
    eventCleanupNodeIds.set(node, id)
  }
  return `${id}:${event}`
}

export function setRenderer<
  NodeType,
  TextNode extends NodeType,
  ElementNode extends NodeType,
  CommentNode extends NodeType
>(
  renderer: VobsRenderer<NodeType, TextNode, ElementNode, CommentNode> | undefined
): VobsRenderer<NodeType, TextNode, ElementNode, CommentNode> | undefined {
  // 返回**上一份**渲染器（没有则是 undefined），调用方据此成对"安装 / 还原"。
  // 全局单例原来只装不还：一次 renderToString 之后就永久停在 SSR 渲染器上（见 vobs/src/app.ts）。
  const previous = currentRenderer as unknown as
    VobsRenderer<NodeType, TextNode, ElementNode, CommentNode> | undefined
  // 编译产物仍使用 DOM 节点声明；实际宿主类型由应用提供的渲染器决定。
  currentRenderer = (renderer as unknown as RuntimeRenderer) ?? null
  return previous
}

export function getRenderer(): RuntimeRenderer {
  if (!currentRenderer) {
    throw new Error('渲染器未初始化')
  }
  return currentRenderer
}

export function createText(content: string): Text {
  return getRenderer().createText(content)
}

/** SVG 命名空间与标签清单见 ./svg —— 编译期判定提升用的是同一份依据。 */
export { SVG_NAMESPACE } from './svg'

export function createElement(tag: string): Element {
  // SVG 标签走命名空间创建：document.createElement('rect') 产物是 HTMLUnknownElement，
  // 整棵 SVG 子树都不会渲染（无报错）。渲染器未实现 createSvgElement 时按 createElement
  // 兜底（旧自定义渲染器保持原行为）。
  if (isSvgTag(tag)) {
    const renderer = getRenderer()
    if (renderer.createSvgElement) return renderer.createSvgElement(tag)
  }
  return getRenderer().createElement(tag)
}

/**
 * 在 SVG 命名空间里建元素，**不看标签名**。
 *
 * 给编译器用在 `<svg>` 祖先下那些与 HTML 同名的标签（a / title / style / script）——
 * 它们不在 SVG_TAGS 里，`createElement` 会按 HTML 建。只按名字判定命名空间是行不通的：
 * `<svg><a href="…">` 会变成 HTML 锚点，而且不报错。
 *
 * 渲染器没实现 createSvgElement 时按 createElement 兜底（自定义渲染器保持原行为）。
 */
export function createSvgElement(tag: string): Element {
  const renderer = getRenderer()
  if (renderer.createSvgElement) return renderer.createSvgElement(tag)
  return renderer.createElement(tag)
}

export function createComment(content: string): Comment {
  return getRenderer().createComment(content)
}

export function insertBefore(
  parent: Node,
  child: VobsNode,
  anchor: VobsNode | null
): void {
  if (isVobsFragment(child)) {
    child.mount(parent, isVobsFragment(anchor) ? anchor.start : anchor)
    markHmrInstanceMounted(child, parent)
    return
  }
  getRenderer().insertBefore(parent, child, isVobsFragment(anchor) ? anchor.start : anchor)
  markHmrInstanceMounted(child, parent)
  const nodeName = (child as Element).nodeName
  if (nodeName === 'OPTION' || nodeName === 'OPTGROUP') syncSelectValue(parent)
  if (getRuntimeDebugHooks()) {
    invokeRuntimeDebug('domMutation', {
      operation: 'insert',
      target: describeDebugNode(child),
      parent: describeDebugNode(parent)
    })
  }
}

/**
 * Select initial-value auto resync: `bindProperty(node, 'value', …)` registers the value
 * reader for `<select>` elements; whenever an `<option>` is inserted into the select
 * (directly or through an `<optgroup>`), the current bound value is re-applied. This
 * removes the last reason for apps to keep `ref + queueMicrotask` value-sync workarounds
 * for options that arrive after the value binding (e.g. asynchronously loaded lists).
 */
const selectValueReaders = new WeakMap<object, () => unknown>()

export function registerSelectValueBinding(select: Element, read: () => unknown): void {
  selectValueReaders.set(select, read)
}

function syncSelectValue(parent: Node): void {
  let current: Node | null = parent
  while (current !== null) {
    if ((current as Element).nodeName === 'SELECT') {
      const read = selectValueReaders.get(current)
      if (read !== undefined) setProperty(current as Element, 'value', read())
      return
    }
    current = current.parentNode
  }
}

export function removeChild(
  parent: Node,
  child: VobsNode
): void {
  /*
   * **先摘 DOM，再释放 Owner。**
   *
   * 原来是反过来的：`disposeNodeOwner(child)` 抛错（用户 cleanup 里抛）就永远走不到
   * 摘除那一步 —— DOM 里留着旧节点、它的 effect 却已经没了，屏幕上出现两棵树且没有提示。
   * 顺序反过来之后，即使清理抛错，DOM 也已一致；错误照旧抛给调用方。
   */
  if (isVobsFragment(child)) {
    child.unmount(parent)
    disposeNodeOwner(child)
    return
  }
  getRenderer().removeChild(parent, child)
  if (getRuntimeDebugHooks()) {
    invokeRuntimeDebug('domMutation', {
      operation: 'remove',
      target: describeDebugNode(child),
      parent: describeDebugNode(parent)
    })
  }
  disposeNodeOwner(child)
}

export function setTextContent(
  node: Text,
  content: string
): void {
  const previousValue = getRuntimeDebugHooks()
    ? readDebugValue(() => node.textContent)
    : undefined
  getRenderer().setTextContent(node, content)
  if (getRuntimeDebugHooks()) {
    invokeRuntimeDebug('domMutation', {
      operation: 'text',
      target: describeDebugNode(node),
      previousValue,
      nextValue: content
    })
  }
}

export function setProperty(
  node: Element,
  key: string,
  value: unknown
): void {
  const previousValue = getRuntimeDebugHooks()
    ? readDebugValue(() => Reflect.get(node, key))
    : undefined
  getRenderer().setProperty(node, key, value)
  if (key === 'value' && (node as { tagName?: unknown }).tagName === 'SELECT') {
    scheduleSelectValueSync(node, value)
  }
  if (getRuntimeDebugHooks()) {
    invokeRuntimeDebug('domMutation', {
      operation: 'property',
      target: describeDebugNode(node),
      key,
      previousValue,
      nextValue: value
    })
  }
}

const pendingSelectValues = new WeakMap<Element, unknown>()
const selectSyncScheduled = new WeakSet<Element>()

/**
 * `<select value>` 在 option 子节点存在前赋值不生效（HTML 规范：select 的 value
 * 由已存在的 option 决定）。编译产物先设置属性、后插入子节点，静态写法必然丢初始值
 * （消费方此前只能用 ref + queueMicrotask 规避）。
 * 这里对 select 的 value 赋值统一延迟到微任务重放一次：静态子节点在同一同步任务内
 * 插入完毕，重放即命中。动态（insertList/insertDynamic）插入的 option 晚于该微任务时，
 * 由 value 的绑定 effect 在后续信号更新中正常覆盖。
 */
function scheduleSelectValueSync(node: Element, value: unknown): void {
  pendingSelectValues.set(node, value)
  if (selectSyncScheduled.has(node)) return
  selectSyncScheduled.add(node)
  /*
   * 在这一刻就把渲染器抓下来，**不要**在微任务里再 getRenderer()：
   * 1) 应用销毁会把全局渲染器还原（没装过就是"没有"），那时微任务里的 getRenderer() 会抛
   *    "渲染器未初始化" —— 抛在微任务里没人接，直接变成进程级 unhandled error（实测
   *    `packages/ui/src/bind.test.ts` 就因为这条让 vitest 报 1 个 unhandled error，退出码非 0）；
   * 2) 语义上也更对：节点是哪个渲染器造的，就用哪个渲染器写回（期间全局可能已经换人）。
   */
  const renderer = getRenderer()
  queueMicrotask(() => {
    selectSyncScheduled.delete(node)
    if (!pendingSelectValues.has(node)) return
    const pending = pendingSelectValues.get(node)
    pendingSelectValues.delete(node)
    renderer.setProperty(node, 'value', pending)
  })
}

export function setAttribute(
  node: Element,
  key: string,
  value: string
): void {
  const previousValue = getRuntimeDebugHooks()
    ? readDebugValue(() => typeof node.getAttribute === 'function' ? node.getAttribute(key) : undefined)
    : undefined
  getRenderer().setAttribute(node, key, value)
  if (getRuntimeDebugHooks()) {
    invokeRuntimeDebug('domMutation', {
      operation: 'attribute',
      target: describeDebugNode(node),
      key,
      previousValue,
      nextValue: value
    })
  }
}

export function spreadProps(node: Element, props: Record<string, unknown>): void {
  applySpreadProps(node, null, props)
}

/** 删除一个 attribute。渲染器没实现时退回空串（属性仍在，但内容清空）—— 老自定义渲染器的降级行为。 */
export function removeAttribute(node: Element, key: string): void {
  const renderer = getRenderer()
  if (renderer.removeAttribute) {
    renderer.removeAttribute(node, key)
    return
  }
  renderer.setAttribute(node, key, '')
}

/** 布尔型 property 的「清除」值是 false，其余是空串（与 React 的移除语义一致）。 */
const BOOLEAN_PROPERTIES = new Set([
  'checked', 'selected', 'disabled', 'multiple', 'readOnly', 'required',
  'hidden', 'open', 'indeterminate', 'defaultChecked', 'muted'
])

/**
 * 把一份 props 应用（或**增量**应用到）节点上。
 *
 * `previous` 为 null 表示首次应用（`spreadProps` 的老路径）；否则只处理真正变化的键，
 * 并**移除**新对象里已经消失的键 —— 这正是原来缺的那一半：`{...props}` 只在创建时应用一次，
 * 之后对象里删掉的键会永远留在 DOM 上，而且改了的值也不会生效。
 */
function applySpreadProps(
  node: Element,
  previous: Record<string, unknown> | null,
  next: Record<string, unknown>
): void {
  for (const [key, value] of Object.entries(next)) {
    if (key === 'key') continue
    if (previous !== null && Object.is(previous[key], value)) continue

    if (key.startsWith('on')) {
      // 事件：先摘旧监听（值变了、或新值不再是函数），再挂新的。
      // 事件名必须过别名表：`onDoubleClick` 的真实事件名是 `dblclick`，
      // 直接小写会得到不存在的 `"doubleclick"`（回调永不触发且静默）。
      const eventName = resolveEventName(key) ?? key.slice(2).toLowerCase()
      const previousHandler = previous?.[key]
      if (typeof previousHandler === 'function') {
        removeEventListener(node, eventName, previousHandler as EventListener)
      }
      if (typeof value === 'function') {
        addEventListener(node, eventName, value as EventListener)
      }
      continue
    }
    if (key === 'ref') {
      setRef(node, value)
      continue
    }
    // null/undefined 表示"不提供值"，**保持现状**（props.test.ts 把这条钉成了契约）。
    // 注意它有一个已知后果：键仍在 `next` 里时移除循环够不着（`key in next`），
    // 所以"值从中变成 null"不会清掉已有属性 —— 要清就得把键从对象里删掉。
    if (value === null || value === undefined) continue
    // property 键的 false 有语义（如 disabled={false} 必须清除），不能跳过；
    // attribute 键的 false 表示"不设置"，与 HTML 语义一致。
    else if (isPropertyName(key)) setProperty(node, key, value)
    else if (value === false) continue
    else setAttribute(node, domAttributeName(key), key === 'style' && isStyleObject(value) ? formatStyle(value) : String(value))
  }

  if (previous === null) return
  for (const key of Object.keys(previous)) {
    if (key in next || key === 'key') continue
    if (key.startsWith('on')) {
      const eventName = resolveEventName(key) ?? key.slice(2).toLowerCase()
      const previousHandler = previous[key]
      if (typeof previousHandler === 'function') {
        removeEventListener(node, eventName, previousHandler as EventListener)
      }
      continue
    }
    if (key === 'ref') continue
    if (isPropertyName(key)) setProperty(node, key, BOOLEAN_PROPERTIES.has(key) ? false : '')
    else removeAttribute(node, domAttributeName(key))
  }
}

/**
 * 把 `{...props}` 绑定成**响应式**的：对象变了就增量应用，消失的键会被移除。
 *
 * 编译器对带展开的 JSX 属性发射这个而不是 `spreadProps` —— 后者只在创建时应用一次，
 * 于是「改了 props 不生效」「删掉的键留在 DOM 上」两个问题都**不报错**。
 *
 * ⚠️ `previous` 必须是**值的快照**，不能是 `next` 的引用。
 * 这里存引用时，下一轮 `applySpreadProps` 里的 `Object.is(previous[key], value)`
 * 读的是同一份值 → 恒等 → **整个 diff 短路**，移除循环也因 `key in next` 全跳过。
 * 而编译器为 `<div {...props}>` 发射的正是**身份稳定 + getter**的形状
 * （`bindSpreadProps(_el0, () => props)`，值经 getter 反应式求值），
 * 于是真实产物下"改了 props 什么都不更新"。
 *
 * 快照用浅拷贝即可，且**必须在应用之前取**：拷贝会把 getter 求值一次、转成数据属性，
 * 而 `applySpreadProps` 又会把 `next` 的每个键读一遍 —— 两者都在 effect 的追踪窗口内，
 * 所以信号依赖不会因为多这一遍而丢失。
 */
export function bindSpreadProps(node: Element, source: () => Record<string, unknown>): void {
  let previous: Record<string, unknown> | null = null
  effect(() => {
    const next = source() ?? {}
    const snapshot = { ...next }
    applySpreadProps(node, previous, next)
    previous = snapshot
  })
}

/** Apply compile-time host properties in one renderer pass. */
export function setStaticProps(node: Element, props: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(props)) {
    if (key === 'key' || key === 'ref' || key.startsWith('on')) continue
    if (value === null || value === undefined) continue
    if (isPropertyName(key)) setProperty(node, key, value)
    else if (value === false) continue
    else setAttribute(node, domAttributeName(key), key === 'style' && isStyleObject(value) ? formatStyle(value) : String(value))
  }
}


function isStyleObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function formatStyle(value: Record<string, unknown>): string {
  return Object.entries(value).filter(([, entry]) => entry !== null && entry !== undefined && entry !== false)
    .map(([key, entry]) => `${key.replace(/[A-Z]/gu, match => `-${match.toLowerCase()}`)}:${String(entry)}`).join(';')
}

export function addEventListener(
  node: Element,
  event: string,
  handler: EventListener
): void {
  const renderer = getRenderer()
  const owner = getCurrentOwner()
  let bindings = eventBindings.get(node)
  if (!bindings) {
    bindings = new Map()
    eventBindings.set(node, bindings)
  }
  const previous = bindings.get(event)
  if (previous && previous.original === handler && previous.owner === owner) return
  if (previous) {
    // 旧监听先摘掉；Owner 清理槽由下面的 slots 原地续用，不在清理表里增删
    renderer.removeEventListener(node, event, previous.handler)
  }
  const listener = owner ? (reason: Event) => {
    // Owner 已销毁说明节点所属子树已被卸载/替换，事件来自游离 DOM，直接忽略。
    // 否则 owner.run 会抛"已销毁的 Owner"，在事件流里制造无意义的错误噪音。
    if (owner.disposed) return
    try {
      owner.run(() => handler(reason))
    } catch (error) {
      const handled = owner.handleError(error)
      invokeRuntimeDebug('error', {
        error,
        owner,
        phase: 'event',
        handled,
        recovery: handled ? 'handled' : 'propagated'
      })
      /*
       * 被 owner 的 onError 处理掉之后，错误就只剩 debug 钩子这一个出口 ——
       * 没装 DevTools 时控制台一个字都没有：事件处理器抛错、界面没反应、无从查起。
       * 没被处理的情况下面会 rethrow（浏览器自己会报），所以只在「被吞下」时补控制台。
       */
      if (handled && getRuntimeDebugHooks()?.error === undefined) {
        console.error(formatVobsError(error, { includeStack: true }))
      }
      if (!handled) throw error
    }
  } : handler
  /*
   * 这个 (node,event) 在 Owner 清理表里只占**一个**槽，替换 handler 时**原地**换掉它做的事。
   *
   * 此前是在**每次** addEventListener 里无条件 `owner.onDispose(...)`，而 `Owner.cleanups`
   * 是只 push 的数组（reactivity/src/owner.ts:57,84）→ 换一次 handler 就多一条永不执行的
   * 清理项，旧的 handler 闭包也被一并扣住。实测（.artifacts/reports/runtime.supplement.md
   * 缺点 4 与既有报告缺点 1，两轮独立复现）：500 次替换 → `cleanups.length === 500`；
   * 一轮 `{...props}` 换 onClick → 202。组件的 effect 每次重跑都会重绑事件，
   * 所以这是热路径上的**无界增长**（长寿命页面里等价于内存泄漏）。
   *
   * `binding` 是 `const`，所以槽里必须包一层可变的 `current` —— 换绑时改的是 `current`，
   * 数组长度不变、旧闭包被释放。
   */
  const binding: EventBinding = { handler: listener, owner, original: handler }
  bindings.set(event, binding)
  renderer.addEventListener(node, event, listener)
  if (!owner) return
  /*
   * **每个 (node,event) 在 Owner 清理表里只占一个槽。**
   *
   * 此前是在**每次** addEventListener 里无条件 `owner.onDispose(...)`，而 `Owner.cleanups`
   * 是只 push 的数组（reactivity/src/owner.ts:57,84）→ 换一次 handler 就多一条永不执行的
   * 清理项，旧的 handler 闭包也被一并扣住。实测（.artifacts/reports/runtime.supplement.md
   * 缺点 4 与既有报告缺点 1，两轮独立复现）：500 次替换 → `cleanups.length === 500`；
   * 一轮 `{...props}` 换 onClick → 202。组件 effect 每次重跑都会重绑事件，
   * 所以这是热路径上的**无界增长**（长寿命页面里等价于内存泄漏）。
   *
   * 做法：清理槽里存的是**间接引用**（owner → (node,event) → 当前 handle），
   * 重绑时只换间接引用指向的东西，槽本身不增不减；最后一个引用被清掉时槽自然失效。
   * 键用 per-owner 的 `eventCleanupKeys` 映射成数字，避免长字符串前缀比较。
   */
  const key = eventCleanupKey(node, event)
  let slots = eventCleanupSlots.get(owner)
  if (!slots) {
    slots = new Map()
    eventCleanupSlots.set(owner, slots)
  }
  // 槽存的永远是"当前该清哪一条绑定"，所以重绑/摘除后再绑都只是覆盖它
  const hasSlot = slots.has(key)
  slots.set(key, binding)
  if (hasSlot) return
  owner.onDispose(() => {
    const current = eventCleanupSlots.get(owner)?.get(key)
    if (!current) return
    eventCleanupSlots.get(owner)?.delete(key)
    const map = eventBindings.get(node)
    if (map?.get(event) === current) map.delete(event)
    renderer.removeEventListener(node, event, current.handler)
  })
}

export function removeEventListener(
  node: Element,
  event: string,
  handler: EventListener
): void {
  const renderer = getRenderer()
  const binding = eventBindings.get(node)?.get(event)
  renderer.removeEventListener(node, event, binding?.handler ?? handler)
  eventBindings.get(node)?.delete(event)
}

/**
 * 清空容器。
 *
 * 原来只调渲染器的 clear（DOM 实现就是 `textContent = ''`）—— **被清掉子树的 Owner
 * 一个都不释放**：组件里的 effect 继续订阅信号（幽灵更新）、监听不解绑、onDispose 不跑。
 * 现在先把子树里能找到的 Owner 释放掉，再清 DOM。
 *
 * 覆盖范围如实说明：`nodeOwners` 只登记**组件输出节点**（`createComponent` 时
 * `associateNodeOwner`）。所以在组件边界上清理是完整的（组件 Owner 的销毁会级联它的
 * effect 与子 Owner）；而在组件外直接 `bindText` 之类建立的 effect 挂在调用方当时的
 * Owner 上、不在节点表里，这里**清不到** —— 那部分归它的 Owner 管，通常由
 * `app.destroy()` 负责。要彻底解决需要节点表能反向枚举，代价更大，先不做。
 *
 * 清理抛错不影响 DOM 被清空（先释放、后清 DOM 的顺序也保证了这一点）。
 */
export function clear(container: Node): void {
  let firstError: unknown
  const walk = (node: Node): void => {
    try {
      disposeNodeOwner(node as unknown as VobsNode)
    } catch (error) {
      firstError ??= error
    }
    for (const child of Array.from(node.childNodes)) walk(child)
  }
  for (const child of Array.from(container.childNodes)) walk(child)

  getRenderer().clear(container)
  if (getRuntimeDebugHooks()) {
    invokeRuntimeDebug('domMutation', {
      operation: 'clear',
      target: describeDebugNode(container as unknown as VobsNode),
      parent: describeDebugNode(container as unknown as VobsNode)
    })
  }
  if (firstError) throw firstError
}

type VobsComponent = (...args: any[]) => VobsNode

type ComponentProps<Component extends VobsComponent> = Component extends (
  props: infer Props
) => VobsNode
  ? NonNullable<Props> extends object ? NonNullable<Props> : Record<string, never>
  : Record<string, never>

export function createComponent<Component extends VobsComponent>(
  component: Component,
  props: ComponentProps<Component>,
  source?: VobsSourceLocation
): VobsNode {
  const owner = createOwner()
  const componentName = (component as typeof component & { displayName?: string }).displayName
    || component.name
    || 'anonymous'
  setOwnerDebugName(owner, source
    ? `${componentName} (${source.file}:${source.line}:${source.column})`
    : componentName)
  owner.onError(reason => {
    attachSourceLocation(reason, source)
    attachComponentContext(reason, componentName, owner.id)
    throw reason
  })
  // HMR 注册先于渲染作用域标记：注册清理必须跨热更新保活，不能被
  // disposeSince 当作上一轮渲染的清理释放掉。
  const hmrKey = (component as typeof component & { hmrKey?: string }).hmrKey
  let instance: HmrInstance | null = null
  if (hmrKey) {
    const separator = hmrKey.lastIndexOf(':')
    const moduleId = separator < 0 ? hmrKey : hmrKey.slice(0, separator)
    instance = { node: null as unknown as VobsNode, parent: null, refresh: () => refreshInstance() }
    const cleanup = registerHmrInstance(moduleId, instance)
    owner.onDispose(cleanup)
  }
  // 渲染作用域：组件 Owner 只承载 HMR 注册与错误处理，每轮渲染注册的 effect、
  // onDispose（含 portal 清理）与嵌套组件 Owner 都归属该轮作用域。HMR refresh
  // 重渲染前释放上一轮作用域，旧实例的 effect 不再订阅信号、portal 节点不再
  // 残留在 body 中每轮热更新叠加；组件 Owner 与 HMR 注册保活。
  const renderScope = owner.mark()
  let node: VobsNode
  try {
    // 组件渲染必须 untrack：组件是 run-once 的，其渲染发生在某次 effect 求值
    // （insertDynamic/insertBoundary 的渲染工厂、路由挂载）内时，若不切断追踪，
    // 组件体内读取的信号会被收集为祖先 effect 的依赖——一次无关编辑就会触发
    // 整棵子树销毁重建（输入框被换掉、焦点丢失、事件监听随旧树一起被清理）。
    // 结构性响应只属于条件工厂与绑定 effect，组件本体渲染一次即止。
    node = owner.run(() => untrack(() => component(props)))
  } catch (error) {
    owner.dispose()
    attachSourceLocation(error, source)
    attachComponentContext(error, componentName, owner.id)
    throw error
  }
  associateNodeOwner(node, owner)
  if (instance) {
    instance.node = node
    associateHmrInstance(node, instance)
  }
  function refreshInstance(): void {
    // 组件已随旧渲染树一起卸载（如父级在同一次热更新中先完成刷新），
    // 无法也无需再刷新。
    if (owner.disposed) return
    const previous = instance!.node
    owner.disposeSince(renderScope)
    const next = owner.run(() => untrack(() => component(props)))
    const parent = instance!.parent
    if (parent) {
      // 先插入新树再卸载旧树：替换锚点始终取自仍在文档中的旧树，
      // fragment 与普通节点两种形态任意组合都能正确定位插入点。
      const anchor = isVobsFragment(previous) ? previous.start : previous
      if (isVobsFragment(next)) next.mount(parent, anchor)
      else getRenderer().insertBefore(parent, next, anchor)
      if (isVobsFragment(previous)) previous.unmount(parent)
      else getRenderer().removeChild(parent, previous)
    }
    nodeOwners.delete(previous as object)
    nodeOwners.set(next as object, owner)
    associateHmrInstance(next, instance!)
    instance!.node = next
  }
  return node
}

export interface VobsSourceLocation {
  readonly file: string
  readonly line: number
  readonly column: number
}

export interface VobsLocatedError extends Error {
  readonly vobsSource?: VobsSourceLocation
  readonly vobsComponent?: string
  readonly vobsOwnerId?: string
}

function attachSourceLocation(reason: unknown, source: VobsSourceLocation | undefined): void {
  if (!source || (!reason || (typeof reason !== 'object' && typeof reason !== 'function'))) return
  const error = reason as VobsLocatedError
  if (error.vobsSource) return
  try {
    Object.defineProperty(error, 'vobsSource', {
      configurable: true,
      enumerable: false,
      value: source,
      writable: false
    })
  } catch {
    // Frozen third-party errors still propagate with their original details.
  }
}

function attachComponentContext(reason: unknown, component: string, ownerId: string): void {
  if (!reason || (typeof reason !== 'object' && typeof reason !== 'function')) return
  const error = reason as VobsLocatedError
  try {
    if (!error.vobsComponent) Object.defineProperty(error, 'vobsComponent', { configurable: true, enumerable: false, value: component, writable: false })
    if (!error.vobsOwnerId) Object.defineProperty(error, 'vobsOwnerId', { configurable: true, enumerable: false, value: ownerId, writable: false })
  } catch {
    // Frozen third-party errors still propagate with their original details.
  }
}

export function createBlock(factory: () => VobsNode | null | undefined | false): VobsNode | null {
  const owner = createOwner()
  setOwnerDebugName(owner, 'dynamic')
  let node: VobsNode | null | undefined | false
  try {
    node = owner.run(factory)
  } catch (error) {
    owner.dispose()
    throw error
  }
  if (!node) {
    owner.dispose()
    return null
  }
  associateNodeOwner(node, owner)
  return node
}

export function associateNodeOwner(node: VobsNode, owner: Owner): void {
  nodeOwners.set(node, owner)
}

export function disposeNodeOwner(node: VobsNode): void {
  const owner = nodeOwners.get(node)
  if (!owner) return
  nodeOwners.delete(node)
  owner.dispose()
}
