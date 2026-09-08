import { createOwner, effect, onDispose, state, type Owner, type Signal } from '@vobs/reactivity'
import {
  createFragment,
  createText,
  insertBefore,
  removeChild,
  type VobsFragment,
  type VobsNode
} from '@vobs/vobs'
import { createBlock } from '@vobs/runtime'
import { asTransitionElement, cssTransitionDriver, resolveReducedMotion } from './driver'
import type {
  TransitionChildren,
  TransitionDriver,
  TransitionGroupProps,
  TransitionOptions,
  TransitionProps,
  TransitionStatus
} from './types'

interface TransitionEntry {
  node: VobsNode
  status: TransitionStatus
  run?: { readonly cancel: () => void }
}

interface GroupEntry extends TransitionEntry {
  readonly key: unknown
  readonly owner: Owner
  readonly item: Signal<unknown>
  rawItem: unknown
  index: number
}

/**
 * Delays branch disposal until the leave lifecycle has completed. It accepts
 * Any rendered root is accepted; the default CSS driver animates element roots
 * inside a Vobs fragment and leaves non-DOM renderers to complete immediately.
 */
export function Transition(props: TransitionProps = {}): VobsFragment {
  return createFragment((parent, anchor) => {
    let current: TransitionEntry | undefined
    let disposed = false
    let initialized = false

    const stop = effect(() => {
      const visible = readProp<boolean>(props, 'show', true) !== false
      const initial = !initialized
      initialized = true
      if (visible) {
        if (current) {
          if (current.status === 'leaving') startEnter(current, props, true)
          return
        }

        const node = createBlock(() => resolveChildren(readProp(props, 'children', undefined)))
        if (!node) return
        current = { node, status: 'entering' }
        insertBefore(parent, node, anchor)
        startEnter(current, props, !initial || readProp<boolean>(props, 'appear', false))
        return
      }

      if (current && current.status !== 'leaving') {
        const leaving = current
        startLeave(current, props, () => {
          if (current?.node !== leaving.node) return
          current = undefined
        })
      }
    })

    // Keep an owner-scoped cleanup so an outer branch/app removal never leaves
    // an animation timer or DOM event listener behind.
    onDispose(() => {
      disposed = true
      stop.dispose()
      current?.run?.cancel()
    })

    function startLeave(entry: TransitionEntry, options: TransitionOptions, afterLeave: () => void): void {
      startLeaveEntry(entry, options, () => {
        if (disposed || current?.node !== entry.node) return
        removeChild(parent, entry.node)
        afterLeave()
      })
    }
  })
}

/**
 * Transition a keyed collection. `items`, `keyOf` and `renderItem` are
 * explicit so lifecycle ownership remains stable without compiler-only magic.
 */
export function TransitionGroup<Item>(props: TransitionGroupProps<Item>): VobsFragment {
  return createFragment((parent, anchor) => {
    const entries = new Map<unknown, GroupEntry>()
    let disposed = false
    let initialized = false
    const stop = effect(() => {
      const nextEntries: GroupEntry[] = []
      const initial = !initialized
      initialized = true
      const descriptors = readGroupDescriptors(props)
      validateGroupDescriptors(descriptors)
      const nextKeys = new Set(descriptors.map(descriptor => descriptor.key))

      for (let index = 0; index < descriptors.length; index++) {
        const descriptor = descriptors[index]
        const { item, key } = descriptor

        let entry = entries.get(key)
        if (entry) {
          const changed = !Object.is(entry.rawItem, item)
          const tracksIndex = descriptor.render.length >= 2
          if (changed || tracksIndex && entry.index !== index) refreshGroupEntry(parent, entry, descriptor)
          entry.index = index
          if (entry.status === 'leaving') startEnter(entry, props, true)
        } else {
          entry = createGroupEntry(descriptor)
          entries.set(key, entry)
          insertBefore(parent, entry.node, anchor)
          startEnter(entry, props, !initial || readProp<boolean>(props, 'appear', false))
        }
        nextEntries.push(entry)
      }

      for (const [key, entry] of [...entries]) {
        if (nextKeys.has(key)) continue
        if (entry.status !== 'leaving') {
          startLeaveEntry(entry, props, () => {
            if (disposed || entries.get(key) !== entry) return
            removeChild(parent, entry.node)
            entry.owner.dispose()
            entries.delete(key)
          })
        }
      }

      let reference: VobsNode | null = anchor
      for (let index = nextEntries.length - 1; index >= 0; index--) {
        insertBefore(parent, nextEntries[index].node, reference)
        reference = nextEntries[index].node
      }
    })

    onDispose(() => {
      disposed = true
      stop.dispose()
      for (const entry of entries.values()) entry.run?.cancel()
      entries.clear()
    })
  })
}

function validateGroupDescriptors(descriptors: readonly GroupDescriptor[]): void {
  const seen = new Set<unknown>()
  for (const descriptor of descriptors) {
    if (seen.has(descriptor.key)) throw new Error(`TransitionGroup: 检测到重复 key: ${String(descriptor.key)}`)
    seen.add(descriptor.key)
  }
}

function createGroupEntry(descriptor: GroupDescriptor): GroupEntry {
  const owner = createOwner()
  let itemSignal!: Signal<unknown>
  let node!: VobsNode
  try {
    owner.run(() => {
      itemSignal = state(descriptor.item)
      node = renderGroupNode(itemSignal, descriptor, owner)
    })
  } catch (error) {
    owner.dispose()
    throw error
  }
  if (!node) {
    owner.dispose()
    throw new Error('TransitionGroup: renderItem 必须返回节点')
  }
  return {
    key: descriptor.key,
    node,
    owner,
    item: itemSignal,
    rawItem: descriptor.item,
    index: descriptor.index,
    status: 'entering'
  }
}

function refreshGroupEntry(parent: Node, entry: GroupEntry, descriptor: GroupDescriptor): void {
  entry.run?.cancel()
  entry.run = undefined
  entry.item.value = descriptor.item
  const previousNode = entry.node
  const nextNode = renderGroupNode(entry.item, descriptor, entry.owner)
  entry.node = nextNode
  entry.rawItem = descriptor.item
  entry.index = descriptor.index
  removeChild(parent, previousNode)
}

function renderGroupNode(signal: Signal<unknown>, descriptor: GroupDescriptor, owner: Owner): VobsNode {
  const node = owner.run(() => createBlock(() => resolveChildren(descriptor.render(toReactiveItem(signal, descriptor.item), descriptor.index))))
  if (!node) throw new Error('TransitionGroup: renderItem 必须返回节点')
  return node
}

interface GroupDescriptor {
  readonly key: unknown
  readonly item: unknown
  readonly index: number
  readonly render: (item: unknown, index: number) => TransitionChildren
}

function readGroupDescriptors<Item>(props: TransitionGroupProps<Item>): GroupDescriptor[] {
  const items = readProp<readonly Item[] | undefined>(props, 'items', undefined)
  if (items !== undefined) {
    const keyOf = readProp<TransitionGroupProps<Item>['keyOf']>(props, 'keyOf', undefined)
    const renderItem = readProp<TransitionGroupProps<Item>['renderItem']>(props, 'renderItem', undefined)
    if (typeof keyOf !== 'function' || typeof renderItem !== 'function') {
      throw new Error('TransitionGroup: 提供 items 时必须同时提供 keyOf 和 renderItem')
    }
    return items.map((item, index) => ({
      key: keyOf(item, index),
      item,
      index,
      render: renderItem as (value: unknown, position: number) => TransitionChildren
    }))
  }

  const children: unknown[] = []
  flattenChildren(readProp(props, 'children', undefined), children)
  return children.map((child, index) => ({
    key: typeof child === 'object' && child !== null ? child : index,
    item: child,
    index,
    render: value => value as TransitionChildren
  }))
}

function flattenChildren(value: unknown, result: unknown[]): void {
  const resolved = typeof value === 'function' ? value() : value
  if (resolved === null || resolved === undefined || resolved === false) return
  if (Array.isArray(resolved)) {
    for (const child of resolved) flattenChildren(child, result)
    return
  }
  result.push(resolved)
}

function startEnter(entry: TransitionEntry, options: TransitionOptions, animate: boolean): void {
  const element = asTransitionElement(entry.node)
  if (entry.status === 'leaving') {
    entry.run?.cancel()
    invoke(options.onLeaveCancelled, element)
  }
  entry.status = 'entering'
  if (!animate) {
    entry.status = 'entered'
    return
  }
  invoke(options.onBeforeEnter, element)
  invoke(options.onEnter, element)
  const run = runWithDriver(entry.node, 'enter', options, () => {
    if (entry.status !== 'entering') return
    entry.run = undefined
    entry.status = 'entered'
    invoke(options.onAfterEnter, element)
  })
  if (entry.status === 'entering') entry.run = run
}

function startLeaveEntry(entry: TransitionEntry, options: TransitionOptions, done: () => void): void {
  if (entry.status === 'leaving') return
  if (entry.status === 'entering') {
    entry.run?.cancel()
    invoke(options.onEnterCancelled, asTransitionElement(entry.node))
  } else {
    entry.run?.cancel()
  }
  entry.status = 'leaving'
  const element = asTransitionElement(entry.node)
  invoke(options.onBeforeLeave, element)
  invoke(options.onLeave, element)
  let active = true
  const run = runWithDriver(entry.node, 'leave', options, () => {
    active = false
    if (entry.status !== 'leaving') return
    entry.run = undefined
    invoke(options.onAfterLeave, element)
    done()
  })
  if (active && entry.status === 'leaving') entry.run = run
}

function runWithDriver(
  node: VobsNode,
  phase: 'enter' | 'leave',
  options: TransitionOptions,
  done: () => void
): { readonly cancel: () => void } {
  const driver = readProp<TransitionDriver>(options, 'driver', cssTransitionDriver)
  const transitionPhase = phase === 'enter' ? options.enter : options.leave
  const duration = Math.max(0, transitionPhase?.duration ?? options.duration ?? 0)
  return driver.run(node, phase, {
    name: readProp<string>(options, 'name', 'v'),
    phase: transitionPhase,
    duration,
    css: readProp<boolean>(options, 'css', true),
    reducedMotion: resolveReducedMotion(options)
  }, done)
}

function resolveChildren(value: TransitionChildren): VobsNode | null {
  const resolved = typeof value === 'function' ? resolveChildren(value()) : value
  if (resolved === null || resolved === undefined || resolved === false) return null
  if (typeof resolved === 'string' || typeof resolved === 'number') return createText(String(resolved))
  if (Array.isArray(resolved)) {
    return createFragment((parent, anchor) => {
      for (const child of resolved) {
        const node = resolveChildren(child)
        if (node) insertBefore(parent, node, anchor)
      }
    })
  }
  return resolved as VobsNode
}

function readProp<T>(props: object, name: string, fallback: T): T {
  const value = Reflect.get(props, name)
  return (value === undefined ? fallback : value) as T
}

function invoke(callback: ((element: Element) => void) | undefined, element: Element | null): void {
  if (callback && element) callback(element)
}

function toReactiveItem<Item>(signal: Signal<Item>, initialValue: Item): Item {
  if (typeof initialValue !== 'object' || initialValue === null) return initialValue
  return new Proxy(initialValue as object, {
    get(_target, property, receiver) {
      return Reflect.get(signal.value as object, property, receiver)
    },
    has(_target, property) {
      return property in (signal.value as object)
    },
    ownKeys() {
      return Reflect.ownKeys(signal.value as object)
    },
    getOwnPropertyDescriptor(_target, property) {
      return Object.getOwnPropertyDescriptor(signal.value as object, property)
    }
  }) as Item
}
