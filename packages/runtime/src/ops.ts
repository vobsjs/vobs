// 编译产物调用的基础操作

import { createOwner, getCurrentOwner, setOwnerDebugName, untrack, type Owner } from '@vobs/reactivity'
import { isVobsFragment, type VobsNode } from './fragment'
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

export function setRenderer<
  NodeType,
  TextNode extends NodeType,
  ElementNode extends NodeType,
  CommentNode extends NodeType
>(renderer: VobsRenderer<NodeType, TextNode, ElementNode, CommentNode>): void {
  // 编译产物仍使用 DOM 节点声明；实际宿主类型由应用提供的渲染器决定。
  currentRenderer = renderer as unknown as RuntimeRenderer
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

export function createElement(tag: string): Element {
  return getRenderer().createElement(tag)
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
    return
  }
  getRenderer().insertBefore(parent, child, isVobsFragment(anchor) ? anchor.start : anchor)
  markHmrInstanceMounted(child, parent)
  if (getRuntimeDebugHooks()) {
    invokeRuntimeDebug('domMutation', {
      operation: 'insert',
      target: describeDebugNode(child),
      parent: describeDebugNode(parent)
    })
  }
}

export function removeChild(
  parent: Node,
  child: VobsNode
): void {
  disposeNodeOwner(child)
  if (isVobsFragment(child)) {
    child.unmount(parent)
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
  queueMicrotask(() => {
    selectSyncScheduled.delete(node)
    if (!pendingSelectValues.has(node)) return
    const pending = pendingSelectValues.get(node)
    pendingSelectValues.delete(node)
    getRenderer().setProperty(node, 'value', pending)
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
  for (const [key, value] of Object.entries(props)) {
    if (key === 'key' || value === null || value === undefined) continue
    if (key === 'ref') {
      setRef(node, value)
      continue
    }
    if (key.startsWith('on') && typeof value === 'function') addEventListener(node, key.slice(2).toLowerCase(), value as EventListener)
    // property 键的 false 有语义（如 disabled={false} 必须清除），不能跳过；
    // attribute 键的 false 表示“不设置”，与 HTML 语义一致。
    else if (isPropertyKey(key)) setProperty(node, key, value)
    else if (value === false) continue
    else setAttribute(node, key === 'className' ? 'class' : key, key === 'style' && isStyleObject(value) ? formatStyle(value) : String(value))
  }
}

/** Apply compile-time host properties in one renderer pass. */
export function setStaticProps(node: Element, props: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(props)) {
    if (key === 'key' || key === 'ref' || key.startsWith('on')) continue
    if (value === null || value === undefined) continue
    if (isPropertyKey(key)) setProperty(node, key, value)
    else if (value === false) continue
    else setAttribute(node, key === 'className' ? 'class' : key, key === 'style' && isStyleObject(value) ? formatStyle(value) : String(value))
  }
}

function isPropertyKey(key: string): boolean {
  return key === 'value' || key === 'checked' || key === 'selected' || key === 'disabled'
    || key === 'multiple' || key === 'readOnly' || key === 'required'
    || key === 'autofocus' || key === 'hidden' || key === 'tabIndex'
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
  if (previous) renderer.removeEventListener(node, event, previous.handler)
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
      if (!handled) throw error
    }
  } : handler
  const binding: EventBinding = { handler: listener, owner, original: handler }
  bindings.set(event, binding)
  renderer.addEventListener(node, event, listener)
  owner?.onDispose(() => {
    if (bindings?.get(event) !== binding) return
    bindings.delete(event)
    renderer.removeEventListener(node, event, listener)
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

export function clear(container: Node): void {
  getRenderer().clear(container)
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
  const hmrKey = (component as typeof component & { hmrKey?: string }).hmrKey
  if (hmrKey) {
    const instance: HmrInstance = {
      node,
      parent: null,
      refresh(): void {
        const previous = instance.node
        const next = owner.run(() => untrack(() => component(props)))
        if (instance.parent && !isVobsFragment(previous) && !isVobsFragment(next)) {
          getRenderer().insertBefore(instance.parent, next, previous)
          getRenderer().removeChild(instance.parent, previous)
        }
        nodeOwners.delete(previous as object)
        nodeOwners.set(next as object, owner)
        associateHmrInstance(next, instance)
        instance.node = next
      }
    }
    associateHmrInstance(node, instance)
    const separator = hmrKey.lastIndexOf(':')
    const moduleId = separator < 0 ? hmrKey : hmrKey.slice(0, separator)
    const cleanup = registerHmrInstance(moduleId, instance)
    owner.onDispose(cleanup)
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
