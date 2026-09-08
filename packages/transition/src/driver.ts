import { getRenderer, isVobsFragment, type VobsNode } from '@vobs/vobs'
import type {
  TransitionDriver,
  TransitionDriverOptions,
  TransitionOptions,
  TransitionPhase,
  TransitionRun,
  TransitionStatus,
  TransitionStyle
} from './types'

export function runTransition(
  node: VobsNode,
  status: Extract<TransitionStatus, 'entering' | 'leaving'>,
  options: TransitionDriverOptions,
  done: () => void
): TransitionRun {
  const elements = getTransitionElements(node)
  if (elements.length === 0 || options.reducedMotion || !options.css && !hasStyles(options.phase)) {
    done()
    return { cancel() {} }
  }

  const phase = options.phase
  const classes = options.css ? phaseClasses(options.name, status) : []
  const restores = elements.map(element => applyInitialState(element, phase, classes, options.duration))
  let finished = false
  let frame: number | undefined
  let timeout: ReturnType<typeof setTimeout> | undefined
  const ended = new Set<Element>()

  const finish = (): void => {
    if (finished) return
    finished = true
    if (frame !== undefined) cancelFrame(frame)
    if (timeout !== undefined) clearTimeout(timeout)
    for (const element of elements) {
      element.removeEventListener('transitionend', onEnd)
      element.removeEventListener('animationend', onEnd)
    }
    for (const restore of restores) restore()
    done()
  }

  const onEnd = (event: Event): void => {
    const target = event.target
    if (!(target instanceof Element) || !elements.includes(target)) return
    ended.add(target)
    if (ended.size === elements.length) finish()
  }

  frame = scheduleFrame(() => {
    if (finished) return
    for (const element of elements) applyTargetState(element, phase, classes)
    if (options.duration <= 0) {
      finish()
      return
    }
    for (const element of elements) {
      element.addEventListener('transitionend', onEnd)
      element.addEventListener('animationend', onEnd)
    }
    timeout = setTimeout(finish, options.duration + 50)
  })

  return {
    cancel(): void {
      if (finished) return
      finished = true
      if (frame !== undefined) cancelFrame(frame)
      if (timeout !== undefined) clearTimeout(timeout)
      for (const element of elements) {
        element.removeEventListener('transitionend', onEnd)
        element.removeEventListener('animationend', onEnd)
      }
      for (const restore of restores) restore()
    }
  }
}

export const cssTransitionDriver: TransitionDriver = {
  run(node, phase, options, done) {
    return runTransition(node, phase === 'enter' ? 'entering' : 'leaving', options, done)
  }
}

export function createCSSTransitionDriver(): TransitionDriver {
  return cssTransitionDriver
}

export function asTransitionElement(node: unknown): Element | null {
  if (!node || typeof node !== 'object') return null
  const candidate = node as Partial<Element>
  return candidate.classList && typeof candidate.addEventListener === 'function' ? candidate as Element : null
}

export function resolveReducedMotion(options: TransitionOptions): boolean {
  if (options.reducedMotion === true) return true
  if (options.reducedMotion === false || typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function getTransitionElements(node: VobsNode): Element[] {
  const element = asTransitionElement(node)
  if (element) return [element]
  if (!isVobsFragment(node)) return []

  const elements: Element[] = []
  const renderer = getRenderer()
  let current = renderer.nextSibling(node.start)
  while (current && current !== node.end) {
    const child = asTransitionElement(current)
    if (child) elements.push(child)
    current = renderer.nextSibling(current)
  }
  return elements
}

function hasStyles(phase: TransitionPhase | undefined): boolean {
  return Boolean(phase?.from || phase?.to)
}

function phaseClasses(prefix: string, status: TransitionStatus): readonly string[] {
  const phase = status === 'entering' ? 'enter' : 'leave'
  return [`${prefix}-${phase}-from`, `${prefix}-${phase}-active`, `${prefix}-${phase}-to`]
}

function applyInitialState(
  element: Element,
  phase: TransitionPhase | undefined,
  classes: readonly string[],
  duration: number
): () => void {
  const [from, active] = classes
  if (from) element.classList.add(from)
  if (active) element.classList.add(active)
  const restoreStyles = applyInlineStyles(element, phase, duration)
  return () => {
    for (const className of classes) element.classList.remove(className)
    restoreStyles()
  }
}

function applyTargetState(element: Element, phase: TransitionPhase | undefined, classes: readonly string[]): void {
  const [from, _active, to] = classes
  if (from) element.classList.remove(from)
  if (to) element.classList.add(to)
  applyStyles(element, phase?.to)
}

function applyInlineStyles(element: Element, phase: TransitionPhase | undefined, duration: number): () => void {
  const style = supportsInlineStyle(element) ? element.style : undefined
  if (!style) return () => {}
  const previous = new Map<string, string>()
  const remember = (styles: TransitionStyle | undefined): void => {
    for (const name of Object.keys(styles ?? {})) {
      const property = stylePropertyName(name)
      if (!previous.has(property)) previous.set(property, style.getPropertyValue(property))
    }
  }
  remember(phase?.from)
  remember(phase?.to)
  if (hasStyles(phase) && duration > 0) {
    previous.set('transition-property', style.getPropertyValue('transition-property'))
    previous.set('transition-duration', style.getPropertyValue('transition-duration'))
    previous.set('transition-timing-function', style.getPropertyValue('transition-timing-function'))
    style.setProperty('transition-property', 'all')
    style.setProperty('transition-duration', `${Math.max(0, duration)}ms`)
    if (phase?.easing) style.setProperty('transition-timing-function', phase.easing)
  }
  applyStyles(element, phase?.from)
  return () => {
    for (const [name, value] of previous) style.setProperty(name, value)
  }
}

function applyStyles(element: Element, styles: TransitionStyle | undefined): void {
  if (!styles) return
  const style = supportsInlineStyle(element) ? element.style : undefined
  if (!style) return
  for (const [name, value] of Object.entries(styles)) {
    const property = stylePropertyName(name)
    if (value === null || value === undefined) style.removeProperty(property)
    else style.setProperty(property, String(value))
  }
}

function stylePropertyName(name: string): string {
  return name.startsWith('--') ? name : name.replace(/[A-Z]/gu, letter => `-${letter.toLowerCase()}`)
}

function supportsInlineStyle(element: Element): element is Element & { style: CSSStyleDeclaration } {
  return 'style' in element && Boolean((element as Partial<Element & { style: CSSStyleDeclaration }>).style)
}

function scheduleFrame(callback: () => void): number {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(callback)
  return setTimeout(callback, 16) as unknown as number
}

function cancelFrame(handle: number): void {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(handle)
  else clearTimeout(handle as unknown as ReturnType<typeof setTimeout>)
}
