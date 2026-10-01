/**
 * `on*` 属性 → DOM 事件名。
 *
 * 编译器原来的做法是无条件 `name.slice(2).toLowerCase()`，于是：
 *   onDoubleClick → "doubleclick"   DOM 里根本叫 dblclick，回调永不触发且无报错
 *   once={fn}     → "ce"            垃圾事件名，同样静默失效
 *   onclick       → "click"         碰巧能工作
 *
 * 这里把三类分开处理：能修的直接修（别名），明显坏掉的报错，可疑的报警告。
 * 事件名不进运行时产物，这张表只在编译期用，不占用户包体。
 */

/** JSX 驼峰名与 DOM 事件名不一致的少数情况（小写后的驼峰名 → 真实事件名）。 */
export const EVENT_NAME_ALIASES: Readonly<Record<string, string>> = {
  // React 风格的 onDoubleClick 对应的 DOM 事件是 dblclick
  doubleclick: 'dblclick',
  // 少数人按 addEventListener 的写法写成 onDblClick
  dblclick: 'dblclick'
}

/** 常见 DOM 事件名（用于区分「写错了」与「自定义事件」）。 */
export const DOM_EVENT_NAMES: ReadonlySet<string> = new Set([
  // 剪贴板
  'copy', 'cut', 'paste',
  // 输入法
  'compositionstart', 'compositionupdate', 'compositionend',
  // 键盘
  'keydown', 'keypress', 'keyup',
  // 焦点
  'focus', 'blur', 'focusin', 'focusout',
  // 鼠标
  'click', 'dblclick', 'mousedown', 'mouseup', 'mouseenter', 'mouseleave', 'mousemove',
  'mouseover', 'mouseout', 'contextmenu', 'auxclick',
  // 指针
  'pointerdown', 'pointerup', 'pointermove', 'pointerover', 'pointerout', 'pointerenter',
  'pointerleave', 'pointercancel', 'pointerrawupdate', 'gotpointercapture', 'lostpointercapture',
  // 触摸
  'touchstart', 'touchend', 'touchmove', 'touchcancel',
  // 拖拽
  'drag', 'dragstart', 'dragend', 'dragenter', 'dragleave', 'dragover', 'drop',
  // 滚动与滚轮
  'wheel', 'scroll', 'scrollend',
  // 表单
  'input', 'beforeinput', 'change', 'submit', 'reset', 'invalid', 'select', 'selectionchange',
  // 媒体
  'play', 'playing', 'pause', 'ended', 'timeupdate', 'volumechange', 'durationchange',
  'loadedmetadata', 'loadeddata', 'canplay', 'canplaythrough', 'progress', 'seeking', 'seeked',
  'stalled', 'suspend', 'waiting', 'ratechange', 'emptied',
  // 动画与过渡
  'animationstart', 'animationend', 'animationiteration', 'animationcancel',
  'transitionstart', 'transitionend', 'transitionrun', 'transitioncancel',
  // 文档与窗口
  'load', 'unload', 'beforeunload', 'resize', 'online', 'offline', 'error', 'abort',
  'hashchange', 'popstate', 'pagehide', 'pageshow', 'visibilitychange', 'readystatechange',
  'storage', 'languagechange', 'message', 'messageerror', 'slotchange', 'selectstart',
  // 其他
  'toggle', 'close', 'cancel', 'cuechange', 'fullscreenchange', 'fullscreenerror',
  'securitypolicyviolation', 'contextlost', 'contextrestored'
])

export interface ResolvedEventName {
  /** 最终绑定的 DOM 事件名。 */
  readonly eventName: string
  /** `on` 之后的部分是否以大写字母开头（vobs 的驼峰约定）。 */
  readonly camelCase: boolean
  /** 是否属于已知 DOM 事件（false 不必然是错的 —— 可能是自定义事件）。 */
  readonly known: boolean
}

/**
 * 解析 `on*` 属性名。
 *
 * @returns 属性名不以 `on` 开头或只有 `on` 本身时返回 undefined。
 */
export function resolveEventName(attributeName: string): ResolvedEventName | undefined {
  if (!attributeName.startsWith('on') || attributeName.length <= 2) return undefined
  const rest = attributeName.slice(2)
  const lowered = rest.toLowerCase()
  const eventName = EVENT_NAME_ALIASES[lowered] ?? lowered
  return {
    eventName,
    camelCase: /^[A-Z]/u.test(rest),
    known: DOM_EVENT_NAMES.has(eventName)
  }
}
