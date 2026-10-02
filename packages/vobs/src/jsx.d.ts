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
  /**

   * 对象 / 数组形式的响应式类名（`{ 'is-open': open.value }`）。

   * 只贡献它自己那部分，不影响 `class` 里的类名。见 @vobs/runtime 的 applyClassList。

   */
  classList?: Record<string, unknown> | readonly unknown[] | string
  cols?: number
  colSpan?: number
  disabled?: boolean
  /** 原生拖拽开关（img 防误拖等） */
  draggable?: boolean
  download?: string | boolean
  height?: number | string
  href?: string
  hrefLang?: string
  hidden?: boolean
  id?: string
  /** 虚拟键盘类型提示（移动端 input） */
  inputMode?: 'none' | 'text' | 'tel' | 'url' | 'email' | 'numeric' | 'decimal' | 'search'
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
  /** 资源加载失败（img error） */
  onError?: VobsEventHandler<ErrorEvent>
  /** 资源加载完成（img load） */
  onLoad?: VobsEventHandler<Event>
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
  /*
   * ↓ 以下事件**运行时早就支持**（dom-events.ts 对任何 `on*` 做 toLowerCase 解析），
   * 这里只是补类型。起因：真实项目里 `onDragOver`/`onDrop` 报「不存在于
   * VobsHTMLAttributes」，于是拖拽导入只能退回 ref + 原生 addEventListener。
   */
  /* 拖拽（onDragOver / onDrop 就是这次的报错来源） */
  onDrag?: VobsEventHandler<DragEvent>
  onDragStart?: VobsEventHandler<DragEvent>
  onDragEnd?: VobsEventHandler<DragEvent>
  onDragEnter?: VobsEventHandler<DragEvent>
  onDragLeave?: VobsEventHandler<DragEvent>
  onDragOver?: VobsEventHandler<DragEvent>
  onDragExit?: VobsEventHandler<DragEvent>
  onDrop?: VobsEventHandler<DragEvent>
  /* 剪贴板 */
  onCopy?: VobsEventHandler<ClipboardEvent>
  onCut?: VobsEventHandler<ClipboardEvent>
  onPaste?: VobsEventHandler<ClipboardEvent>
  /* 鼠标的补充（over/out 会冒泡，enter/leave 不会，两者语义不同） */
  onMouseOver?: VobsEventHandler<MouseEvent>
  onMouseOut?: VobsEventHandler<MouseEvent>
  onContextMenu?: VobsEventHandler<MouseEvent>
  /* 指针与触摸的补充 */
  onPointerCancel?: VobsEventHandler<PointerEvent>
  onPointerOver?: VobsEventHandler<PointerEvent>
  onPointerOut?: VobsEventHandler<PointerEvent>
  onTouchCancel?: VobsEventHandler<TouchEvent>
  /* 键盘补充（keypress 已废弃但仍在广泛使用） */
  onKeyPress?: VobsEventHandler<KeyboardEvent>
  /* 表单补充 */
  onSelect?: VobsEventHandler<Event>
  onReset?: VobsEventHandler<Event>
  onInvalid?: VobsEventHandler<Event>
  /* 动画与过渡 */
  onAnimationStart?: VobsEventHandler<AnimationEvent>
  onAnimationEnd?: VobsEventHandler<AnimationEvent>
  onAnimationIteration?: VobsEventHandler<AnimationEvent>
  onTransitionEnd?: VobsEventHandler<TransitionEvent>
  onTransitionStart?: VobsEventHandler<TransitionEvent>
  onTransitionCancel?: VobsEventHandler<TransitionEvent>
  /* 媒体 */
  onPlay?: VobsEventHandler<Event>
  onPause?: VobsEventHandler<Event>
  onEnded?: VobsEventHandler<Event>
  onTimeUpdate?: VobsEventHandler<Event>
  onVolumeChange?: VobsEventHandler<Event>
  onDurationChange?: VobsEventHandler<Event>
  onRateChange?: VobsEventHandler<Event>
  onSeeking?: VobsEventHandler<Event>
  onSeeked?: VobsEventHandler<Event>
  onWaiting?: VobsEventHandler<Event>
  onStalled?: VobsEventHandler<Event>
  onSuspend?: VobsEventHandler<Event>
  onEmptied?: VobsEventHandler<Event>
  onProgress?: VobsEventHandler<ProgressEvent>
  onCanPlay?: VobsEventHandler<Event>
  onLoadedMetadata?: VobsEventHandler<Event>
  onLoadedData?: VobsEventHandler<Event>
  /* 其它常用 */
  onToggle?: VobsEventHandler<Event>
  onAbort?: VobsEventHandler<UIEvent>
  onBeforeInput?: VobsEventHandler<InputEvent>
  onCompositionStart?: VobsEventHandler<CompositionEvent>
  onCompositionUpdate?: VobsEventHandler<CompositionEvent>
  onCompositionEnd?: VobsEventHandler<CompositionEvent>
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
