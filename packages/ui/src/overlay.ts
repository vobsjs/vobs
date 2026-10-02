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

  /*
   * 可聚焦元素必须**真的能被聚焦**，不能只按标签名取。
   *
   * 原来只过滤 `disabled` 与 `aria-hidden="true"`，于是这些都会进列表：
   * - `hidden` 属性 / `display:none` / `visibility:hidden`（元素根本不可见）
   * - `tabindex="-1"`（**明确**声明"可编程聚焦、不参与 Tab"）
   * - `inert` 子树里的元素（整棵子树不参与交互）
   * - 祖先上的 `hidden` / `display:none` / `aria-hidden`
   *
   * 后果不只是"焦点落在隐藏元素上"。Tab 循环用的是 `first`/`last` 两个端点：
   * 若**最后一个可见元素之后还有隐藏元素**，`last` 会算成隐藏那个 ——
   * 于是用户在最后一个可见元素上按 Tab 时，焦点被送进不可见区域（看起来"焦点消失了"），
   * 反向 Shift+Tab 同理。
   *
   * 说明一处**刻意的取舍**：隐藏判定只看内联样式与 `hidden` 属性，不做
   * `getComputedStyle`。理由是后者在测试环境（jsdom 不加载外部样式表）对 class 驱动的
   * 在隐藏测不出来、且每次 Tab 都要强制样式计算。**由 class / 外部样式表造成的隐藏
   * 这里识别不到** —— 那种情况下请让被隐藏的元素带上 `hidden` 或 `aria-hidden="true"`
   * （这本来也是更好的可访问性写法）。
   */
  const isFocusable = (element: HTMLElement): boolean => {
    if (element.hasAttribute('disabled')) return false
    // `closest` 会匹配自身，所以这一条同时覆盖"自身带 hidden"与"祖先带 hidden"
    if (element.closest('[hidden]') !== null) return false
    if (element.closest('[inert]') !== null) return false
    if (element.closest('[aria-hidden="true"]') !== null) return false
    // tabindex="-1" 是"可编程聚焦"，按设计不参与 Tab 序列；非数字同样无效
    const tabIndex = element.getAttribute('tabindex')
    if (tabIndex !== null && (Number.isNaN(Number(tabIndex)) || Number(tabIndex) < 0)) return false
    // 内联样式隐藏：自身或**任意祖先**（`[hidden]` 之外最常见的写法）
    let current: HTMLElement | null = element
    while (current !== null && current !== root) {
      const style = current.style
      if (style.display === 'none') return false
      if (style.visibility === 'hidden' || style.visibility === 'collapse') return false
      current = current.parentElement
    }
    return true
  }

  const focusable = (): HTMLElement[] => [...root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)]
    .filter(isFocusable)

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
