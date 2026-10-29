// Searchable dropdown (Combobox): input filtering + keyboard navigation + option list, for
// scenarios with many options (system fonts, etc.).
// Purely imperative DOM implementation (same style as forms.ts): internal state uses
// @vobs/reactivity signals, global listeners are cleaned up automatically when the Owner is
// destroyed; three wiring styles: controlled value / two-way bind / onChange.
import { effect, state, untrack, type Signal } from '@vobs/reactivity'
import {
  createElement,
  insertBefore,
  setAttribute,
  type VobsNode
} from '@vobs/vobs'
import {
  bindClassList,
  bindUserStyle,
  hasProp,
  listen,
  readProp,
  setOptionalProperty
} from './utils'
import type { VuiCommonProps } from './types'

/** A single option: falls back to showing value when label is absent */
export interface ComboboxOption {
  readonly value: string
  readonly label?: string
}

export interface ComboboxProps extends VuiCommonProps {
  /** Option list (compiled usage supports getter-based reactive updates) */
  readonly options?: readonly ComboboxOption[]
  /** Controlled current value (mutually exclusive with bind; bind wins) */
  readonly value?: string
  /** Two-way binding signal: selection writes back, external changes sync the display */
  readonly bind?: Signal<string>
  readonly placeholder?: string
  /** Message shown when nothing matches */
  readonly emptyText?: string
  readonly toggleLabel?: string
  readonly disabled?: boolean
  /** Selection callback (receives the option value) */
  readonly onChange?: (value: string) => void
  /** Panel open direction: down always opens downward (default, kept for back-compat);
   *  up always opens upward;
   *  auto = on each open, measure the viewport space below the trigger and flip up when it
   *  cannot fit the panel and there is enough room above */
  readonly direction?: 'down' | 'up' | 'auto'
  /** Panel horizontal alignment: start = left-aligned and as wide as the trigger (default);
   *  end = right edge aligned with the trigger's right edge, width follows content
   *  (max-content) stretching leftward so long options are not truncated; override max-width
   *  separately for ultra-wide cases */
  readonly align?: 'start' | 'end'
}

export function Combobox(props: ComboboxProps = {}): VobsNode {
  const root = createElement('div')
  // The auto-direction measurement result lives in a signal: class names are managed uniformly
  // by bindClassList (which overwrites className wholesale), so classes toggled manually via
  // classList.toggle would get wiped when its effect re-runs
  const flipUp = state(false, 'flipUp')
  bindClassList(root, props, () => {
    const direction = readProp<'down' | 'up' | 'auto'>(props, 'direction', 'down')
    return [
      'vui-combobox',
      direction === 'up' || (direction === 'auto' && flipUp.value) ? 'vui-combobox--up' : undefined,
      readProp<'start' | 'end'>(props, 'align', 'start') === 'end' ? 'vui-combobox--align-end' : undefined,
      readProp(props, 'disabled', false) ? 'is-disabled' : undefined
    ]
  })
  bindUserStyle(root, props)

  const input = createElement('input') as HTMLInputElement
  setAttribute(input, 'class', 'vui-combobox__input')
  input.type = 'text'
  input.autocomplete = 'off'
  input.setAttribute('autocomplete', 'off')
  input.setAttribute('role', 'combobox')
  input.setAttribute('aria-expanded', 'false')

  const toggle = createElement('button') as HTMLButtonElement
  setAttribute(toggle, 'class', 'vui-combobox__toggle')
  toggle.type = 'button'
  toggle.setAttribute('tabindex', '-1')
  // This used to hard-code the literal 'toggle' — which wasn't even meaningful English (it's a
  // "show options" button) and couldn't be translated. Following the closeLabel convention from
  // dialog/drawer, accept a passable label; the default now actually describes the action.
  setAttribute(toggle, 'aria-label', readProp(props, 'toggleLabel', 'Show options'))
  toggle.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>'

  const panel = createElement('div')
  setAttribute(panel, 'class', 'vui-combobox__panel')
  const list = createElement('div')
  setAttribute(list, 'class', 'vui-combobox__list')
  insertBefore(panel, list, null)

  insertBefore(root, input, null)
  insertBefore(root, toggle, null)

  /* ---------- Internal state ---------- */
  const open = state(false, 'open')
  const query = state('', 'query')
  const active = state(0, 'active')

  const options = (): readonly ComboboxOption[] => readProp<readonly ComboboxOption[]>(props, 'options', [])
  const disabled = (): boolean => readProp(props, 'disabled', false)
  const optionLabel = (option: ComboboxOption): string => option.label ?? option.value
  const emptyText = (): string => readProp(props, 'emptyText', 'No matches')

  const bindSignal = (): Signal<string> | undefined => {
    const value = readProp<Signal<string> | undefined>(props, 'bind', undefined)
    return value && typeof value === 'object' && 'value' in value ? value : undefined
  }
  const currentValue = (): string => bindSignal()?.value ?? readProp(props, 'value', '')

  const openPanel = (): void => {
    if (disabled()) return
    // Clear the filter on open (list everything), cursor in the input
    query.set('')
    active.set(0)
    open.set(true)
  }

  const select = (option: ComboboxOption): void => {
    const bind = bindSignal()
    if (bind) bind.value = option.value
    open.set(false)
    input.blur()
    const handler = readProp<((value: string) => void) | undefined>(props, 'onChange', undefined)
    if (typeof handler === 'function') handler(option.value)
  }

  const filtered = (): readonly ComboboxOption[] => {
    const keyword = query.value.trim().toLowerCase()
    const all = options()
    if (keyword === '') return all
    return all.filter(option =>
      option.value.toLowerCase().includes(keyword) || (option.label ?? '').toLowerCase().includes(keyword))
  }

  /* ---------- Input display: closed state shows the selected option's label, open state shows the filter ---------- */
  effect(() => {
    if (open.value) {
      input.value = query.value
      input.setAttribute('aria-expanded', 'true')
    } else {
      input.setAttribute('aria-expanded', 'false')
      const current = currentValue()
      const option = options().find(item => item.value === current)
      input.value = option !== undefined ? optionLabel(option) : current
    }
  })

  /*
   * Option nodes inside the panel. Highlighting only toggles classes on these nodes; they are
   * never rebuilt.
   *
   * Previously the whole panel effect depended on `active` (read in two places below) — so
   * gliding the mouse across options (mousemove changes active) rebuilt every option: on a
   * 50-item list, 10 mousemoves were measured to trigger **9 rebuilds**.
   * Now active is read with untrack (kept out of the dependency graph), and highlighting is
   * delegated to the class-only effect below.
   */
  const optionNodes: HTMLButtonElement[] = []
  const applyActiveClass = (index: number): void => {
    for (let i = 0; i < optionNodes.length; i++) {
      const isActive = i === index
      if (optionNodes[i].classList.contains('is-active') !== isActive) {
        optionNodes[i].classList.toggle('is-active', isActive)
      }
    }
  }

  /* ---------- Panel rendering: rebuild options when open/query/options change (no per-option effect; rebuild cleans up) ---------- */
  effect(() => {
    if (!open.value) {
      panel.remove()
      return
    }
    if (panel.parentElement !== root) insertBefore(root, panel, null)
    const matches = filtered()
    /*
     * Read outside untrack: this run's subscription to active is kept alive by the `active.value`
     * read at line 164 below (it decides which item is highlighted and must be read after the
     * clamp, so the clamp takes effect immediately).
     * The write is wrapped in untrack: otherwise this write would reschedule its own effect run —
     * the clamp is idempotent so it wouldn't loop,
     * but that round would be pure waste, and the guardrail would report it as VOBS_C210.
     */
    const activeIndex = untrack(() => active.value)
    const clamped = Math.min(activeIndex, Math.max(0, matches.length - 1))
    untrack(() => { active.set(clamped) })
    list.replaceChildren()
    optionNodes.length = 0
    if (matches.length === 0) {
      const empty = createElement('p')
      setAttribute(empty, 'class', 'vui-combobox__empty')
      empty.textContent = emptyText()
      list.append(empty)
    } else {
      const current = currentValue()
      matches.forEach((option, index) => {
        const item = createElement('button') as HTMLButtonElement
        item.type = 'button'
        setAttribute(item, 'class', 'vui-combobox__option'
          + (option.value === current ? ' is-selected' : '')
          + (index === clamped ? ' is-active' : ''))
        item.textContent = optionLabel(option)
        item.addEventListener('click', () => select(option))
        item.addEventListener('mousemove', () => {
          if (active.value !== index) active.set(index)
        })
        list.append(item)
        optionNodes.push(item)
      })
    }
    // auto direction: measure after the panel renders (forced layout to get the real panel
    // height); flip up when space below is insufficient and there is room above;
    // re-measure on every open (window position/scroll may change); non-auto resets
    // (up/down come straight from the class binding)
    applyActiveClass(clamped)
    if (readProp<'down' | 'up' | 'auto'>(props, 'direction', 'down') === 'auto') {
      const rootRect = root.getBoundingClientRect()
      const panelHeight = panel.getBoundingClientRect().height
      const spaceBelow = window.innerHeight - rootRect.bottom
      flipUp.value = spaceBelow < panelHeight + 8 && rootRect.top > panelHeight + 8
    } else {
      flipUp.value = false
    }
  })

  /*
   * Highlighting: class toggling only — no DOM structural changes, no layout measurement.
   * Hovering to another option goes through here.
   */
  effect(() => { applyActiveClass(active.value) })

  /* ---------- Keyboard navigation ---------- */
  input.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      open.set(false)
      input.blur()
      return
    }
    if (!open.value) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        openPanel()
      }
      return
    }
    const matches = filtered()
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      active.set(matches.length === 0 ? 0 : (active.value + 1) % matches.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      active.set(matches.length === 0 ? 0 : (active.value - 1 + matches.length) % matches.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const option = matches[active.value]
      if (option !== undefined) select(option)
    }
  })

  /* ---------- Interaction: focus/input opens, toggle button switches, outside click closes ---------- */
  input.addEventListener('focus', () => { if (!open.value) openPanel() })
  input.addEventListener('input', (event: Event) => {
    query.set((event.target as HTMLInputElement).value)
    active.set(0)
    if (!open.value) open.set(true)
  })
  listen(toggle, 'click', { onClick: () => { if (open.value) open.set(false); else openPanel() } }, 'onClick')
  // Close on outside click: registered inside an effect (reads open → listens only while open),
  // removed automatically when the effect re-runs or on destroy
  effect(() => {
    if (!open.value) return
    const closeOnOutside = (event: Event): void => {
      if (!root.contains(event.target as Node)) open.set(false)
    }
    document.addEventListener('click', closeOnOutside)
    return () => document.removeEventListener('click', closeOnOutside)
  })

  /* ---------- Common properties ---------- */
  effect(() => setOptionalProperty(input, 'disabled', disabled()))
  if (hasProp(props, 'placeholder')) {
    effect(() => {
      const placeholder = readProp<string | undefined>(props, 'placeholder', undefined)
      if (placeholder === undefined || placeholder === null) input.removeAttribute('placeholder')
      else input.setAttribute('placeholder', String(placeholder))
    })
  }

  return root
}
