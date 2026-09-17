// 可搜索下拉（Combobox）：输入过滤 + 键盘导航 + 选项列表，供选项较多的场景（系统字体等）。
// 纯命令式 DOM 实现（与 forms.ts 同风格）：内部状态走 @vobs/reactivity 信号，
// 组件随 Owner 销毁自动清理全局监听；受控 value / 双向 bind / onChange 三种接法。
import { effect, state, type Signal } from '@vobs/reactivity'
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

/** 单个选项：label 缺省时显示 value */
export interface ComboboxOption {
  readonly value: string
  readonly label?: string
}

export interface ComboboxProps extends VuiCommonProps {
  /** 选项列表（编译用法支持 getter 响应式更新） */
  readonly options?: readonly ComboboxOption[]
  /** 受控当前值（与 bind 二选一；bind 优先） */
  readonly value?: string
  /** 双向绑定信号：选中写回、外部变更同步显示 */
  readonly bind?: Signal<string>
  readonly placeholder?: string
  /** 无匹配项时的提示文案 */
  readonly emptyText?: string
  readonly disabled?: boolean
  /** 选中回调（入参为选项 value） */
  readonly onChange?: (value: string) => void
}

export function Combobox(props: ComboboxProps = {}): VobsNode {
  const root = createElement('div')
  bindClassList(root, props, () => [
    'vui-combobox',
    readProp(props, 'disabled', false) ? 'is-disabled' : undefined
  ])
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
  toggle.setAttribute('aria-label', 'toggle')
  toggle.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>'

  const panel = createElement('div')
  setAttribute(panel, 'class', 'vui-combobox__panel')
  const list = createElement('div')
  setAttribute(list, 'class', 'vui-combobox__list')
  insertBefore(panel, list, null)

  insertBefore(root, input, null)
  insertBefore(root, toggle, null)

  /* ---------- 内部状态 ---------- */
  const open = state(false)
  const query = state('')
  const active = state(0)

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
    // 打开时清空过滤词（全量列出），光标在输入框
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

  /* ---------- 输入框显示：关闭态显示选中项 label，展开态显示过滤词 ---------- */
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

  /* ---------- 面板渲染：open/query/options 变化时重建选项（无选项级 effect，重建即清理） ---------- */
  effect(() => {
    if (!open.value) {
      panel.remove()
      return
    }
    if (panel.parentElement !== root) insertBefore(root, panel, null)
    const matches = filtered()
    active.set(Math.min(active.value, Math.max(0, matches.length - 1)))
    list.replaceChildren()
    if (matches.length === 0) {
      const empty = createElement('p')
      setAttribute(empty, 'class', 'vui-combobox__empty')
      empty.textContent = emptyText()
      list.append(empty)
      return
    }
    const current = currentValue()
    matches.forEach((option, index) => {
      const item = createElement('button') as HTMLButtonElement
      item.type = 'button'
      setAttribute(item, 'class', 'vui-combobox__option'
        + (option.value === current ? ' is-selected' : '')
        + (index === active.value ? ' is-active' : ''))
      item.textContent = optionLabel(option)
      item.addEventListener('click', () => select(option))
      item.addEventListener('mousemove', () => {
        if (active.value !== index) active.set(index)
      })
      list.append(item)
    })
  })

  /* ---------- 键盘导航 ---------- */
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

  /* ---------- 交互：聚焦/输入即展开，切换按钮开合，外部点击关闭 ---------- */
  input.addEventListener('focus', () => { if (!open.value) openPanel() })
  input.addEventListener('input', (event: Event) => {
    query.set((event.target as HTMLInputElement).value)
    active.set(0)
    if (!open.value) open.set(true)
  })
  listen(toggle, 'click', { onClick: () => { if (open.value) open.set(false); else openPanel() } }, 'onClick')
  // 外部点击关闭：effect 内注册（读取 open → 仅展开期监听），effect 重跑/销毁时自动移除
  effect(() => {
    if (!open.value) return
    const closeOnOutside = (event: Event): void => {
      if (!root.contains(event.target as Node)) open.set(false)
    }
    document.addEventListener('click', closeOnOutside)
    return () => document.removeEventListener('click', closeOnOutside)
  })

  /* ---------- 公共属性 ---------- */
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
