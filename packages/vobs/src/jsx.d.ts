import type { Ref, RefTarget, VobsNode } from '@vobs/runtime'

// JSX type declarations

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

   * Reactive class names as object / array (`{ 'is-open': open.value }`).

   * Contributes only its own portion; does not affect class names in `class`. See applyClassList in @vobs/runtime.

   */
  classList?: Record<string, unknown> | readonly unknown[] | string
  cols?: number
  colSpan?: number
  disabled?: boolean
  /** Native drag toggle (preventing accidental drags on img, etc.) */
  draggable?: boolean
  download?: string | boolean
  height?: number | string
  href?: string
  hrefLang?: string
  hidden?: boolean
  id?: string
  /** Virtual keyboard type hint (mobile input) */
  inputMode?: 'none' | 'text' | 'tel' | 'url' | 'email' | 'numeric' | 'decimal' | 'search'
  /** Native lazy loading for images (img) */
  loading?: 'lazy' | 'eager'
  /** Native image decode timing (img) */
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
  /** Resource failed to load (img error) */
  onError?: VobsEventHandler<ErrorEvent>
  /** Resource finished loading (img load) */
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
   * ↓ The events below were **already supported at runtime** (dom-events.ts applies toLowerCase
   * resolution to any `on*`); this only adds the types. Origin: in a real project
   * `onDragOver`/`onDrop` reported "does not exist on VobsHTMLAttributes", so drag-and-drop
   * import had to fall back to ref + native addEventListener.
   */
  /* Drag and drop (onDragOver / onDrop were the source of that error report) */
  onDrag?: VobsEventHandler<DragEvent>
  onDragStart?: VobsEventHandler<DragEvent>
  onDragEnd?: VobsEventHandler<DragEvent>
  onDragEnter?: VobsEventHandler<DragEvent>
  onDragLeave?: VobsEventHandler<DragEvent>
  onDragOver?: VobsEventHandler<DragEvent>
  onDragExit?: VobsEventHandler<DragEvent>
  onDrop?: VobsEventHandler<DragEvent>
  /* Clipboard */
  onCopy?: VobsEventHandler<ClipboardEvent>
  onCut?: VobsEventHandler<ClipboardEvent>
  onPaste?: VobsEventHandler<ClipboardEvent>
  /* Mouse additions (over/out bubble, enter/leave do not — different semantics) */
  onMouseOver?: VobsEventHandler<MouseEvent>
  onMouseOut?: VobsEventHandler<MouseEvent>
  onContextMenu?: VobsEventHandler<MouseEvent>
  /* Pointer and touch additions */
  onPointerCancel?: VobsEventHandler<PointerEvent>
  onPointerOver?: VobsEventHandler<PointerEvent>
  onPointerOut?: VobsEventHandler<PointerEvent>
  onTouchCancel?: VobsEventHandler<TouchEvent>
  /* Keyboard additions (keypress is deprecated but still widely used) */
  onKeyPress?: VobsEventHandler<KeyboardEvent>
  /* Form additions */
  onSelect?: VobsEventHandler<Event>
  onReset?: VobsEventHandler<Event>
  onInvalid?: VobsEventHandler<Event>
  /* Animation and transitions */
  onAnimationStart?: VobsEventHandler<AnimationEvent>
  onAnimationEnd?: VobsEventHandler<AnimationEvent>
  onAnimationIteration?: VobsEventHandler<AnimationEvent>
  onTransitionEnd?: VobsEventHandler<TransitionEvent>
  onTransitionStart?: VobsEventHandler<TransitionEvent>
  onTransitionCancel?: VobsEventHandler<TransitionEvent>
  /* Media */
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
  /* Other common events */
  onToggle?: VobsEventHandler<Event>
  onAbort?: VobsEventHandler<UIEvent>
  onBeforeInput?: VobsEventHandler<InputEvent>
  onCompositionStart?: VobsEventHandler<CompositionEvent>
  onCompositionUpdate?: VobsEventHandler<CompositionEvent>
  onCompositionEnd?: VobsEventHandler<CompositionEvent>
  [name: `data-${string}`]: string | number | boolean | undefined
  [name: `aria-${string}`]: string | number | boolean | undefined
}

/** SVG element attributes: the attribute system is large and mostly kebab-case (stroke-width etc.), so a catch-all index is allowed; the compiler setAttributes unknown attribute names verbatim. */
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
    // Inject optional key into component props: the compiler extracts key in list maps to generate keyOf
    // (keyed reconciliation); key is not passed into component props, it only exists to pass type checking
    // (IntrinsicAttributes is merged into all JSX elements).
    interface IntrinsicAttributes {
      key?: string | number
    }
    // Full automatic mapping of built-in elements: HTML and SVG elements come from lib.dom's
    // tag mapping tables respectively; attributes go through vobs' unified attribute model
    // (setAttribute/property mix). New elements arrive automatically as TS's lib.dom is
    // upgraded — no manual element enumeration to maintain.
    type IntrinsicElements = {
      [K in keyof HTMLElementTagNameMap]: VobsHTMLAttributes
    } & {
      [K in keyof SVGElementTagNameMap]: VobsSVGAttributes
    }
  }
}

export {}
