import type { VobsNode } from './fragment'
import type { Ref, RefTarget } from '@vobs/runtime'

// JSX 类型声明

type VobsEventHandler<T extends Event = Event> = (event: T) => void

interface VobsHTMLAttributes {
  ref?: RefTarget<any>
  accessKey?: string
  autofocus?: boolean
  class?: string
  className?: string
  cols?: number
  disabled?: boolean
  height?: number | string
  hidden?: boolean
  id?: string
  max?: number | string
  maxLength?: number
  min?: number | string
  minLength?: number
  multiple?: boolean
  name?: string
  placeholder?: string
  readOnly?: boolean
  required?: boolean
  rows?: number
  selected?: boolean
  size?: number
  src?: string
  step?: number | string
  style?: string | Readonly<Record<string, string | number | boolean | null | undefined>>
  tabIndex?: number
  title?: string
  type?: string
  value?: string | number | readonly string[]
  key?: string | number
  width?: number | string
  children?: unknown
  onClick?: VobsEventHandler<MouseEvent>
  onDblClick?: VobsEventHandler<MouseEvent>
  onFocus?: VobsEventHandler<FocusEvent>
  onBlur?: VobsEventHandler<FocusEvent>
  onInput?: VobsEventHandler<InputEvent>
  onChange?: VobsEventHandler<Event>
  onKeyDown?: VobsEventHandler<KeyboardEvent>
  onKeyUp?: VobsEventHandler<KeyboardEvent>
  onSubmit?: VobsEventHandler<SubmitEvent>
  [name: `data-${string}`]: string | number | boolean | undefined
  [name: `aria-${string}`]: string | number | boolean | undefined
}

declare global {
  namespace JSX {
    type Element = VobsNode
    interface ElementChildrenAttribute { children: {} }
    interface IntrinsicElements {
      a: VobsHTMLAttributes
      article: VobsHTMLAttributes
      aside: VobsHTMLAttributes
      button: VobsHTMLAttributes
      code: VobsHTMLAttributes
      div: VobsHTMLAttributes
      footer: VobsHTMLAttributes
      form: VobsHTMLAttributes
      h1: VobsHTMLAttributes
      h2: VobsHTMLAttributes
      h3: VobsHTMLAttributes
      header: VobsHTMLAttributes
      img: VobsHTMLAttributes
      input: VobsHTMLAttributes
      label: VobsHTMLAttributes
      li: VobsHTMLAttributes
      main: VobsHTMLAttributes
      nav: VobsHTMLAttributes
      ol: VobsHTMLAttributes
      option: VobsHTMLAttributes
      pre: VobsHTMLAttributes
      p: VobsHTMLAttributes
      section: VobsHTMLAttributes
      select: VobsHTMLAttributes
      span: VobsHTMLAttributes
      table: VobsHTMLAttributes
      tbody: VobsHTMLAttributes
      td: VobsHTMLAttributes
      textarea: VobsHTMLAttributes
      tfoot: VobsHTMLAttributes
      th: VobsHTMLAttributes
      thead: VobsHTMLAttributes
      tr: VobsHTMLAttributes
      ul: VobsHTMLAttributes
    }
  }
}

export {}
