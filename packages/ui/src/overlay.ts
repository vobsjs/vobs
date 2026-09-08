import { getCurrentOwner, onDispose } from '@vobs/reactivity'
import {
  createComment,
  insertBefore,
  isVobsFragment,
  type VobsNode
} from '@vobs/vobs'

export interface VuiPortalAdapter<Target = unknown> {
  mount(node: VobsNode, target: Target): void
  unmount(node: VobsNode, target: Target): void
}

export function createPortal<Target>(
  node: VobsNode,
  adapter: VuiPortalAdapter<Target>,
  target: Target
): VobsNode {
  const placeholder = createComment('vui:portal')
  const owner = getCurrentOwner()
  if (!owner) throw new Error('Vobs UI: createPortal 必须在组件 Owner 作用域内调用')
  adapter.mount(node, target)
  const cleanup = (): void => adapter.unmount(node, target)
  owner.onDispose(cleanup)
  return placeholder
}

export function createDOMPortalAdapter(): VuiPortalAdapter<Node> {
  return {
    mount(node, target): void {
      insertBefore(target, node, null)
    },
    unmount(node, target): void {
      removePortalNode(node, target)
    }
  }
}

export interface FocusTrapOptions {
  readonly initialFocus?: HTMLElement | (() => HTMLElement | null)
  readonly restoreFocus?: boolean
  readonly onEscape?: (event: KeyboardEvent) => void
}

export interface FocusTrapHandle {
  readonly active: boolean
  activate(): void
  deactivate(): void
  dispose(): void
}

export function createFocusTrap(
  root: HTMLElement,
  options: FocusTrapOptions = {}
): FocusTrapHandle {
  let isActive = false
  let disposed = false
  let previouslyFocused: Element | null = null

  const focusable = (): HTMLElement[] => [...root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)]
    .filter(element => !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true')

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!isActive || disposed) return
    if (event.key === 'Escape') {
      options.onEscape?.(event)
      return
    }
    if (event.key !== 'Tab') return
    const elements = focusable()
    if (elements.length === 0) {
      event.preventDefault()
      root.focus()
      return
    }
    const first = elements[0]
    const last = elements[elements.length - 1]
    const current = document.activeElement
    if (event.shiftKey && current === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && current === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const activate = (): void => {
    if (disposed || isActive) return
    isActive = true
    previouslyFocused = document.activeElement
    root.addEventListener('keydown', onKeyDown)
    const initial = resolveInitialFocus(options.initialFocus) ?? focusable()[0] ?? root
    if (!root.hasAttribute('tabindex') && initial === root) root.setAttribute('tabindex', '-1')
    initial.focus()
  }

  const deactivate = (): void => {
    if (!isActive) return
    isActive = false
    root.removeEventListener('keydown', onKeyDown)
    if (options.restoreFocus !== false
      && typeof HTMLElement !== 'undefined'
      && previouslyFocused instanceof HTMLElement) previouslyFocused.focus()
    previouslyFocused = null
  }

  const handle: FocusTrapHandle = {
    get active(): boolean { return isActive },
    activate,
    deactivate,
    dispose(): void {
      if (disposed) return
      deactivate()
      disposed = true
    }
  }
  if (getCurrentOwner()) onDispose(() => handle.dispose())
  return handle
}

export interface OverlayEntry {
  readonly id: string
  readonly modal?: boolean
  readonly closeOnEscape?: boolean
  readonly onEscape?: () => void
}

export interface OverlayManager {
  readonly entries: readonly OverlayEntry[]
  open(entry: OverlayEntry): void
  close(id: string): void
  bringToFront(id: string): void
  subscribe(listener: (entries: readonly OverlayEntry[]) => void): () => void
}

export function createOverlayManager(): OverlayManager {
  let entries: OverlayEntry[] = []
  const listeners = new Set<(entries: readonly OverlayEntry[]) => void>()
  const notify = (): void => {
    const snapshot = entries.slice()
    for (const listener of listeners) listener(snapshot)
  }

  return {
    get entries(): readonly OverlayEntry[] { return entries },
    open(entry): void {
      entries = [...entries.filter(current => current.id !== entry.id), entry]
      notify()
    },
    close(id): void {
      const next = entries.filter(entry => entry.id !== id)
      if (next.length === entries.length) return
      entries = next
      notify()
    },
    bringToFront(id): void {
      const entry = entries.find(current => current.id === id)
      if (!entry || entries[entries.length - 1] === entry) return
      entries = [...entries.filter(current => current !== entry), entry]
      notify()
    },
    subscribe(listener): () => void {
      listeners.add(listener)
      listener(entries.slice())
      return () => listeners.delete(listener)
    }
  }
}

function resolveInitialFocus(
  target: FocusTrapOptions['initialFocus']
): HTMLElement | null {
  if (!target) return null
  return typeof target === 'function' ? target() : target
}

function removePortalNode(node: VobsNode, target: Node): void {
  if (isVobsFragment(node)) {
    let current = node.start.nextSibling
    while (current && current !== node.end) {
      const next = current.nextSibling
      target.removeChild(current)
      current = next
    }
    if (node.start.parentNode === target) target.removeChild(node.start)
    if (node.end.parentNode === target) target.removeChild(node.end)
    return
  }
  if (node.parentNode === target) target.removeChild(node)
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button',
  'input',
  'select',
  'textarea',
  'iframe',
  'object',
  'embed',
  '[contenteditable]',
  '[tabindex]'
].join(',')
