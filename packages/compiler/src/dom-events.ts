/**
 * `on*` attributes → DOM event names.
 *
 * The compiler's original approach was an unconditional `name.slice(2).toLowerCase()`, so:
 *   onDoubleClick → "doubleclick"   the DOM actually calls it dblclick; the callback never fires and nothing reports it
 *   once={fn}     → "ce"            a garbage event name, silently broken the same way
 *   onclick       → "click"         happens to work
 *
 * ⚠️ **The single source of the alias table and resolver is `@vobs/runtime`'s `dom-events.ts`**; this file only re-exports it —
 * the runtime's `{...props}` spread path must use the same alias table as compile time, otherwise
 * `<div {...props} onDoubleClick={…}>` binds the nonexistent `"doubleclick"`,
 * while `<div onDoubleClick={…}>` binds the correct `dblclick`: one attribute name, two paths, two behaviors.
 * It was consolidated into the runtime because the runtime uses it too; only the compiler's diagnostics need the extra info (see below).
 */

export { EVENT_NAME_ALIASES } from '@vobs/runtime/dom-events'

import { resolveEventName as resolveEventNamePlain } from '@vobs/runtime/dom-events'

/** Common DOM event names (used to distinguish "a typo" from "a custom event"). */
export const DOM_EVENT_NAMES: ReadonlySet<string> = new Set([
  // clipboard
  'copy', 'cut', 'paste',
  // input method
  'compositionstart', 'compositionupdate', 'compositionend',
  // keyboard
  'keydown', 'keypress', 'keyup',
  // focus
  'focus', 'blur', 'focusin', 'focusout',
  // mouse
  'click', 'dblclick', 'mousedown', 'mouseup', 'mouseenter', 'mouseleave', 'mousemove',
  'mouseover', 'mouseout', 'contextmenu', 'auxclick',
  // pointer
  'pointerdown', 'pointerup', 'pointermove', 'pointerover', 'pointerout', 'pointerenter',
  'pointerleave', 'pointercancel', 'pointerrawupdate', 'gotpointercapture', 'lostpointercapture',
  // touch
  'touchstart', 'touchend', 'touchmove', 'touchcancel',
  // drag & drop
  'drag', 'dragstart', 'dragend', 'dragenter', 'dragleave', 'dragover', 'drop',
  // scroll & wheel
  'wheel', 'scroll', 'scrollend',
  // form
  'input', 'beforeinput', 'change', 'submit', 'reset', 'invalid', 'select', 'selectionchange',
  // media
  'play', 'playing', 'pause', 'ended', 'timeupdate', 'volumechange', 'durationchange',
  'loadedmetadata', 'loadeddata', 'canplay', 'canplaythrough', 'progress', 'seeking', 'seeked',
  'stalled', 'suspend', 'waiting', 'ratechange', 'emptied',
  // animation & transition
  'animationstart', 'animationend', 'animationiteration', 'animationcancel',
  'transitionstart', 'transitionend', 'transitionrun', 'transitioncancel',
  // document & window
  'load', 'unload', 'beforeunload', 'resize', 'online', 'offline', 'error', 'abort',
  'hashchange', 'popstate', 'pagehide', 'pageshow', 'visibilitychange', 'readystatechange',
  'storage', 'languagechange', 'message', 'messageerror', 'slotchange', 'selectstart',
  // misc
  'toggle', 'close', 'cancel', 'cuechange', 'fullscreenchange', 'fullscreenerror',
  'securitypolicyviolation', 'contextlost', 'contextrestored'
])

export interface ResolvedEventName {
  /** The DOM event name finally bound. */
  readonly eventName: string
  /** Whether the part after `on` starts with an uppercase letter (vobs's camelCase convention). */
  readonly camelCase: boolean
  /** Whether it is a known DOM event (false is not necessarily wrong — it may be a custom event). */
  readonly known: boolean
}

/**
 * Resolve an `on*` attribute name (the compile-time version, additionally providing `camelCase`/`known` for diagnostics).
 *
 * The event name itself comes from the runtime's single source; this only adds diagnostic info.
 * Kept distinct from the runtime's same-named export to avoid clashing with this file's re-export.
 *
 * @returns undefined when the attribute name does not start with `on` or is just `on` itself.
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
