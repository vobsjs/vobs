import type { Ref, RefTarget, VobsNode } from '@vobs/runtime'

// JSX 类型声明

type VobsEventHandler<T extends Event = Event> = (event: T) => void

export interface VobsHTMLAttributes {
  ref?: RefTarget<any>
  accept?: string
  accessKey?: string
  alt?: string
  autoComplete?: string
  autofocus?: boolean
  checked?: boolean
  class?: string
  className?: string
  cols?: number
  colSpan?: number
  disabled?: boolean
  download?: string | boolean
  height?: number | string
  href?: string
  hrefLang?: string
  hidden?: boolean
  id?: string
  /** 原生图片懒加载（img） */
  loading?: 'lazy' | 'eager'
  /** 原生图片解码时机（img） */
  decoding?: 'sync' | 'async' | 'auto'
  max?: number | string
  maxLength?: number
  min?: number | string
  minLength?: number
  multiple?: boolean
  name?: string
  placeholder?: string
  readOnly?: boolean
  rel?: string
  required?: boolean
  role?: string
  rows?: number
  rowSpan?: number
  selected?: boolean
  size?: number
  spellCheck?: boolean
  src?: string
  step?: number | string
  style?: string | Readonly<Record<string, string | number | boolean | null | undefined>>
  tabIndex?: number
  target?: string
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
  onPointerDown?: VobsEventHandler<PointerEvent>
  onPointerUp?: VobsEventHandler<PointerEvent>
  onPointerMove?: VobsEventHandler<PointerEvent>
  onPointerEnter?: VobsEventHandler<PointerEvent>
  onPointerLeave?: VobsEventHandler<PointerEvent>
  onMouseDown?: VobsEventHandler<MouseEvent>
  onMouseUp?: VobsEventHandler<MouseEvent>
  onMouseMove?: VobsEventHandler<MouseEvent>
  onMouseEnter?: VobsEventHandler<MouseEvent>
  onMouseLeave?: VobsEventHandler<MouseEvent>
  onTouchStart?: VobsEventHandler<TouchEvent>
  onTouchMove?: VobsEventHandler<TouchEvent>
  onTouchEnd?: VobsEventHandler<TouchEvent>
  onWheel?: VobsEventHandler<WheelEvent>
  onScroll?: VobsEventHandler<Event>
  [name: `data-${string}`]: string | number | boolean | undefined
  [name: `aria-${string}`]: string | number | boolean | undefined
}

/** SVG 元素属性：属性体系庞大且以 kebab-case 为主（stroke-width 等），通用索引放行；编译器对未知属性名原样 setAttribute。 */
export interface VobsSVGAttributes {
  children?: unknown
  class?: string
  width?: number | string
  height?: number | string
  viewBox?: string
  fill?: string
  stroke?: string
  strokeWidth?: number | string
  strokeLinecap?: 'butt' | 'round' | 'square' | 'inherit'
  strokeLinejoin?: 'miter' | 'round' | 'bevel' | 'inherit'
  [name: string]: unknown
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
    // 内置元素全量自动映射：HTML 元素与 SVG 元素分别来自 lib.dom 的标签映射表，
    // 属性统一走 vobs 的属性模型（setAttribute/property 混合）。新增元素随 TS
    // 的 lib.dom 升级自动获得，无需手工维护元素枚举。
    type IntrinsicElements = {
      [K in keyof HTMLElementTagNameMap]: VobsHTMLAttributes
    } & {
      [K in keyof SVGElementTagNameMap]: VobsSVGAttributes
    }
  }
}

export {}
