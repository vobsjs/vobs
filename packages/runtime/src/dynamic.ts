import { createOwner, effect, state, type Owner, type Signal } from '@vobs/reactivity'
import {
  associateNodeOwner,
  createBlock,
  createComment,
  createText,
  insertBefore,
  removeChild
} from './ops'
import { createFragment, isVobsFragment, type VobsNode } from './fragment'

export type NodeFactory = () => VobsNode | null | undefined | false
export type DynamicChild = VobsNode | string | number | boolean | null | undefined | readonly DynamicChild[]

interface ListEntry<T> {
  key: unknown
  node: VobsNode
  owner: Owner
  viewOwner: Owner
  item: Signal<T>
  /** 最近一次赋值的原始 item：供比较与刷新使用，避免在列表 effect 内读取 item 信号造成自依赖。 */
  value: T
  index: number
}

export function insertDynamic(parent: Node, anchor: Node | null, factory: NodeFactory): void {
  const marker = createComment('vobs:dynamic')
  insertBefore(parent, marker, anchor)
  let current: VobsNode | null = null

  effect(() => {
    const next = createBlock(factory)
    if (next === current) return

    if (current) removeChild(parent, current)
    current = next
    if (current) insertBefore(parent, current, marker)
  })
}

/**
 * Inserts any Vobs child value. This is the escape hatch for JSX expressions
 * that return a node, an array of nodes, text, or an empty conditional value.
 */
export function insertDynamicValue(
  parent: Node,
  anchor: Node | null,
  factory: () => DynamicChild
): void {
  const marker = createComment('vobs:value')
  insertBefore(parent, marker, anchor)
  let current: VobsNode | null = null
  let scope: Owner | null = null

  effect(() => {
    // 每轮求值使用独立 scope Owner：factory 求值与挂载期间创建的组件 Owner 全部挂在它下面。
    // 数组/节点被替换时整体 dispose 旧 scope，避免被丢弃子树的 effect 继续订阅信号（幽灵更新与内存泄漏）。
    const nextScope = createOwner()
    const next = nextScope.run(() => normalizeDynamicChild(factory()))
    if (next === current) {
      nextScope.dispose()
      return
    }
    if (current) removeChild(parent, current)
    scope?.dispose()
    scope = nextScope
    current = next
    if (current) insertBefore(parent, current, marker)
  })
}

/** Convert a JSX child value to a host node without creating a wrapper element. */
export function normalizeDynamicChild(value: DynamicChild): VobsNode | null {
  if (value === null || value === undefined || typeof value === 'boolean') return null
  if (typeof value === 'string' || typeof value === 'number') return createText(String(value))
  if (isVobsFragment(value) || isHostNode(value)) return value as VobsNode
  if (Array.isArray(value)) {
    const children = value
    if (children.length === 0) return null
    return createFragment((parent, anchor) => {
      for (const child of children) {
        const node = normalizeDynamicChild(child)
        if (node) insertBefore(parent, node, anchor)
      }
    })
  }
  return null
}

function isHostNode(value: unknown): value is Node {
  return Boolean(value && typeof value === 'object'
    && ('nodeType' in value || ((value as { type?: unknown }).type === 'element'
      || (value as { type?: unknown }).type === 'text'
      || (value as { type?: unknown }).type === 'comment')))
}

export function insertList<T>(
  parent: Node,
  anchor: Node | null,
  source: () => readonly T[],
  renderItem: (item: T, index: number) => VobsNode,
  keyOf?: (item: T, index: number) => unknown
): void {
  const marker = createComment('vobs:list')
  insertBefore(parent, marker, anchor)
  let entries: Array<ListEntry<T>> = []
  const tracksIndex = renderItem.length >= 2

  effect(() => {
    const items = source()

    // key 只计算一次：keyed 判定与调和共用，避免 keyOf 每轮被调用两遍。
    let keys: unknown[] | null = null
    if (keyOf) {
      keys = new Array(items.length)
      let allKeyed = items.length > 0
      for (let index = 0; index < items.length; index++) {
        const key = keyOf(items[index], index)
        if (key == null) {
          allKeyed = false
          break
        }
        keys[index] = key
      }
      if (!allKeyed) keys = null
    }

    const nextEntries = keys
      ? reconcileKeyed(items, keys, entries, renderItem)
      : reconcileIndexed(items, entries, renderItem)

    // tracksIndex 时 index 参与渲染，位置变化的行必须整体重建，新节点不在 DOM 中，
    // 重排阶段强制插入；否则只同步记录的位置，节点保持原样交给重排阶段移动。
    const refreshed = tracksIndex ? new Set<ListEntry<T>>() : null
    for (let index = 0; index < nextEntries.length; index++) {
      const entry = nextEntries[index]
      if (tracksIndex) {
        if (entry.index !== index) {
          refreshListEntry(parent, entry, index, renderItem)
          refreshed!.add(entry)
        }
      } else {
        entry.index = index
      }
    }

    const retained = new Set(nextEntries)
    for (const entry of entries) {
      if (!retained.has(entry)) disposeEntry(parent, entry)
    }

    reorderListEntries(parent, marker, entries, nextEntries, refreshed)
    entries = nextEntries
  })
}

/**
 * 按 nextEntries 顺序整理 DOM，但只移动必须移动的节点。
 */
function reorderListEntries<T>(
  parent: Node,
  marker: Node,
  previous: readonly ListEntry<T>[],
  nextEntries: readonly ListEntry<T>[],
  forceInsert: Set<ListEntry<T>> | null
): void {
  const count = nextEntries.length
  if (count === 0) return

  // 首次挂载（旧列表为空）：全部是新节点，倒序直插即可，跳过 Map/LIS 构建。
  if (previous.length === 0) {
    let reference: VobsNode = marker
    for (let index = count - 1; index >= 0; index--) {
      const node = nextEntries[index].node
      insertBefore(parent, node, reference)
      reference = node
    }
    return
  }

  const oldIndexOf = new Map<ListEntry<T>, number>()
  for (let index = 0; index < previous.length; index++) oldIndexOf.set(previous[index], index)

  // seq[i] = 条目在旧序中的位置；新条目、重建条目与强制插入条目为 -1。
  const seq: number[] = new Array(count)
  for (let index = 0; index < count; index++) {
    const entry = nextEntries[index]
    seq[index] = forceInsert?.has(entry) ? -1 : oldIndexOf.get(entry) ?? -1
  }

  const keep = computeKeptByLis(seq)

  let reference: VobsNode = marker
  for (let index = count - 1; index >= 0; index--) {
    const node = nextEntries[index].node
    if (keep[index]) {
      reference = node
      continue
    }
    insertBefore(parent, node, reference)
    reference = node
  }
}

/**
 * 严格递增子序列（LIS）成员标记，O(n log n)。
 * 负值（新节点）不参与 LIS，永远视为需要移动。
 */
function computeKeptByLis(seq: readonly number[]): boolean[] {
  const count = seq.length
  const keep = new Array<boolean>(count).fill(false)
  const tailsIndex: number[] = []
  const tailsValue: number[] = []
  const prev = new Array<number>(count).fill(-1)

  for (let i = 0; i < count; i++) {
    const value = seq[i]
    if (value < 0) continue
    let lo = 0
    let hi = tailsValue.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (tailsValue[mid] < value) lo = mid + 1
      else hi = mid
    }
    if (lo === tailsValue.length) {
      tailsValue.push(value)
      tailsIndex.push(i)
    } else {
      tailsValue[lo] = value
      tailsIndex[lo] = i
    }
    prev[i] = lo > 0 ? tailsIndex[lo - 1] : -1
  }

  let cursor = tailsIndex.length > 0 ? tailsIndex[tailsIndex.length - 1] : -1
  while (cursor >= 0) {
    keep[cursor] = true
    cursor = prev[cursor]
  }
  return keep
}

function reconcileKeyed<T>(
  items: readonly T[],
  keys: readonly unknown[],
  entries: Array<ListEntry<T>>,
  renderItem: (item: T, index: number) => VobsNode
): Array<ListEntry<T>> {
  const previous = new Map(entries.map(entry => [entry.key, entry]))
  const seen = new Set<unknown>()
  const nextEntries: Array<ListEntry<T>> = []

  for (let index = 0; index < items.length; index++) {
    const item = items[index]
    const key = keys[index]
    if (seen.has(key)) {
      console.warn(`Vobs: 检测到重复的列表 key: ${String(key)}`)
    }
    seen.add(key)
    const entry = previous.get(key)
    if (entry) {
      previous.delete(key)
      if (isPrimitiveItem(item) && !Object.is(entry.value, item)) {
        // 原始类型项在编译产物中被静态捕获，无法通过 item 信号刷新视图：值变化时必须重建行。
        nextEntries.push(createListEntry(item, index, key, renderItem))
        continue
      }
      entry.item.value = item
      entry.value = item
      nextEntries.push(entry)
      continue
    }
    nextEntries.push(createListEntry(item, index, key, renderItem))
  }

  return nextEntries
}

function reconcileIndexed<T>(
  items: readonly T[],
  entries: Array<ListEntry<T>>,
  renderItem: (item: T, index: number) => VobsNode
): Array<ListEntry<T>> {
  const nextEntries: Array<ListEntry<T>> = []
  for (let index = 0; index < items.length; index++) {
    const item = items[index]
    const entry = entries[index]
    if (entry && isPrimitiveItem(item) && !Object.is(entry.value, item)) {
      // 原始类型项被编译产物静态捕获，值变化时必须重建行；旧行由主循环统一 dispose。
      nextEntries.push(createListEntry(item, index, index, renderItem))
      continue
    }
    if (entry) {
      entry.item.value = item
      entry.value = item
      nextEntries.push(entry)
      continue
    }
    nextEntries.push(createListEntry(item, index, index, renderItem))
  }
  return nextEntries
}

/** 原始类型（含 function）无法被 Proxy 响应化，只能整行重建。 */
function isPrimitiveItem(item: unknown): boolean {
  return item === null || typeof item !== 'object'
}

function createListEntry<T>(
  item: T,
  index: number,
  key: unknown,
  renderItem: (item: T, index: number) => VobsNode
): ListEntry<T> {
  const owner = createOwner()
  let itemSignal!: Signal<T>
  let viewOwner!: Owner
  let node!: VobsNode
  owner.run(() => {
    itemSignal = state(item)
    viewOwner = createOwner()
    node = viewOwner.run(() => renderItem(toReactiveItem(itemSignal, item), index))
  })
  associateNodeOwner(node, viewOwner)
  return { key, node, owner, viewOwner, item: itemSignal, value: item, index }
}

function refreshListEntry<T>(
  parent: Node,
  entry: ListEntry<T>,
  index: number,
  renderItem: (item: T, index: number) => VobsNode
): void {
  removeChild(parent, entry.node)
  entry.index = index
  const previousView = entry.viewOwner
  entry.owner.run(() => {
    entry.viewOwner = createOwner()
    entry.node = entry.viewOwner.run(() => renderItem(
      toReactiveItem(entry.item, entry.value),
      index
    ))
  })
  // 旧视图的 effect 仍订阅着 item 信号，必须 dispose，否则会写已脱离的 DOM（幽灵更新）。
  previousView.dispose()
  associateNodeOwner(entry.node, entry.viewOwner)
}

function toReactiveItem<T>(item: Signal<T>, initialValue: T): T {
  if (typeof initialValue !== 'object' || initialValue === null) {
    return initialValue
  }

  // 代理目标使用创建时的原始对象：避免在列表 effect 内读取 item 信号造成自依赖；
  // 属性读取始终转发到 item.value，在行内绑定 effect 中被正常追踪。
  return new Proxy(initialValue as object, {
    get(_target, property, receiver) {
      return Reflect.get(item.value as object, property, receiver)
    },
    has(_target, property) {
      return property in (item.value as object)
    },
    ownKeys() {
      return Reflect.ownKeys(item.value as object)
    },
    getOwnPropertyDescriptor(_target, property) {
      return Object.getOwnPropertyDescriptor(item.value as object, property)
    }
  }) as T
}

function disposeEntry(parent: Node, entry: ListEntry<unknown>): void {
  removeChild(parent, entry.node)
  entry.owner.dispose()
}
