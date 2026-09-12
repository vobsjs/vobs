import type { Ref, RefTarget, VobsNode } from '@vobs/runtime'

// JSX 类型声明

type VobsEventHandler<T extends Event = Event> = (event: T) => void

interface VobsHTMLAttributes {
  ref?: RefTarget<any>
  accept?: string
  accessKey?: string
  alt?: string
  autofocus?: boolean
  checked?: boolean
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
    // 组件 props 注入可选 key：编译器在列表 map 中提取 key 生成 keyOf（keyed 调和），
    // key 不传入组件 props，仅供类型层面放行（IntrinsicAttributes 合并进所有 JSX 元素）。
    interface IntrinsicAttributes {
      key?: string | number
    }
    interface IntrinsicElements {
      a: VobsHTMLAttributes
      abbr: VobsHTMLAttributes
      address: VobsHTMLAttributes
      article: VobsHTMLAttributes
      aside: VobsHTMLAttributes
      b: VobsHTMLAttributes
      button: VobsHTMLAttributes
      canvas: VobsHTMLAttributes
      code: VobsHTMLAttributes
      dd: VobsHTMLAttributes
      del: VobsHTMLAttributes
      details: VobsHTMLAttributes
      dialog: VobsHTMLAttributes
      div: VobsHTMLAttributes
      dl: VobsHTMLAttributes
      dt: VobsHTMLAttributes
      em: VobsHTMLAttributes
      fieldset: VobsHTMLAttributes
      figcaption: VobsHTMLAttributes
      figure: VobsHTMLAttributes
      footer: VobsHTMLAttributes
      form: VobsHTMLAttributes
      h1: VobsHTMLAttributes
      h2: VobsHTMLAttributes
      h3: VobsHTMLAttributes
      h4: VobsHTMLAttributes
      h5: VobsHTMLAttributes
      h6: VobsHTMLAttributes
      header: VobsHTMLAttributes
      hr: VobsHTMLAttributes
      i: VobsHTMLAttributes
      img: VobsHTMLAttributes
      input: VobsHTMLAttributes
      ins: VobsHTMLAttributes
      kbd: VobsHTMLAttributes
      label: VobsHTMLAttributes
      legend: VobsHTMLAttributes
      li: VobsHTMLAttributes
      main: VobsHTMLAttributes
      mark: VobsHTMLAttributes
      nav: VobsHTMLAttributes
      ol: VobsHTMLAttributes
      optgroup: VobsHTMLAttributes
      option: VobsHTMLAttributes
      output: VobsHTMLAttributes
      pre: VobsHTMLAttributes
      p: VobsHTMLAttributes
      q: VobsHTMLAttributes
      s: VobsHTMLAttributes
      section: VobsHTMLAttributes
      select: VobsHTMLAttributes
      small: VobsHTMLAttributes
      span: VobsHTMLAttributes
      strong: VobsHTMLAttributes
      sub: VobsHTMLAttributes
      summary: VobsHTMLAttributes
      sup: VobsHTMLAttributes
      table: VobsHTMLAttributes
      tbody: VobsHTMLAttributes
      td: VobsHTMLAttributes
      textarea: VobsHTMLAttributes
      tfoot: VobsHTMLAttributes
      th: VobsHTMLAttributes
      thead: VobsHTMLAttributes
      time: VobsHTMLAttributes
      tr: VobsHTMLAttributes
      u: VobsHTMLAttributes
      ul: VobsHTMLAttributes
      video: VobsHTMLAttributes
    }
  }
}

export {}
