/**
 * `on*` 属性 → DOM 事件名。
 *
 * 编译器原来的做法是无条件 `name.slice(2).toLowerCase()`，于是：
 *   onDoubleClick → "doubleclick"   DOM 里根本叫 dblclick，回调永不触发且无报错
 *   once={fn}     → "ce"            垃圾事件名，同样静默失效
 *   onclick       → "click"         碰巧能工作
 *
 * ⚠️ **别名表与解析函数的单一来源在 `@vobs/runtime` 的 `dom-events.ts`**，这里只是再导出。
 * 此前两边各写一份，而运行期的 `{...props}` 展开路径**根本没有别名表** —— 于是
 * `<div {...props} onDoubleClick={…}>` 挂的是不存在的 `"doubleclick"`，
 * 而 `<div onDoubleClick={…}>` 挂的是正确的 `dblclick`：同一个属性名，两条路径两种行为。
 * 收拢到 runtime 是因为它同时被运行期用；编译期只剩诊断需要额外信息（见下）。
 */

export { EVENT_NAME_ALIASES } from '@vobs/runtime/dom-events'

import { resolveEventName as resolveEventNamePlain } from '@vobs/runtime/dom-events'

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
 * 解析 `on*` 属性名（编译期版本，额外给出诊断需要的 `camelCase`/`known`）。
 *
 * 事件名本身来自 runtime 的单一来源；这里只补诊断信息。
 * 与 runtime 的同名导出区分开，避免与本文件的再导出撞名。
 *
 * @returns 属性名不以 `on` 开头或只有 `on` 本身时返回 undefined。
 */
export function resolveEventNameForDiagnostics(attributeName: string): ResolvedEventName | undefined {
  const eventName = resolveEventNamePlain(attributeName)
  if (eventName === undefined) return undefined
  const rest = attributeName.slice(2)
  return {
    eventName,
    camelCase: /^[A-Z]/u.test(rest),
    known: DOM_EVENT_NAMES.has(eventName)
  }
}
