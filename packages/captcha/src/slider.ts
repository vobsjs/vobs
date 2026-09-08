import {
  addEventListener,
  createElement,
  createText,
  effect,
  insertBefore,
  setAttribute,
  setProperty,
  state,
  type Signal,
  type VobsNode
} from '@vobs/vobs'
import { onDispose } from '@vobs/reactivity'
import { Captcha, type CaptchaStatus, type CaptchaSubmitContext } from './index'

export type SliderShape = 'puzzle' | 'circle' | 'square' | 'triangle'

export interface SliderCaptchaChallenge {
  readonly id: string
  readonly payload: SliderCaptchaPayload
  readonly expiresAt: number
}

export interface SliderCaptchaPayload {
  readonly image?: string
  readonly width: number
  readonly height: number
  readonly startX?: number
  readonly targetX: number
  readonly targetY: number
  readonly rotation?: number
  readonly decoys?: readonly SliderCaptchaDecoy[]
  readonly decoyX?: number
  readonly decoyY?: number
  readonly decoyRotation?: number
  readonly pieceWidth: number
  readonly pieceHeight: number
  readonly tolerance?: number
  readonly shape?: SliderShape
}

export interface SliderCaptchaDecoy {
  readonly x: number
  readonly y: number
  readonly rotation?: number
}

export interface SliderTrailPoint {
  readonly x: number
  readonly y: number
  readonly t: number
}

export interface SliderTrailAnalysis {
  readonly pointCount: number
  readonly duration: number
  readonly distance: number
  readonly averageSpeed: number
  readonly maxSpeed: number
  readonly directionChanges: number
  readonly verticalTravel: number
  readonly averageInterval: number
  readonly looksHuman: boolean
}

export interface CaptchaDeviceSignals {
  readonly sessionId: string
  readonly userAgent?: string
  readonly platform?: string
  readonly language?: string
  readonly languages?: readonly string[]
  readonly timezone?: string
  readonly screen?: { readonly width: number; readonly height: number; readonly pixelRatio: number }
  readonly viewport?: { readonly width: number; readonly height: number }
  readonly touchPoints?: number
  readonly hardwareConcurrency?: number
  readonly deviceMemory?: number
  readonly webdriver?: boolean
}

export interface SliderCaptchaResult {
  readonly x: number
  readonly y: number
  readonly trail: readonly SliderTrailPoint[]
  readonly duration: number
  readonly analysis: SliderTrailAnalysis
  readonly deviceSignals?: CaptchaDeviceSignals
}

export interface SliderCaptchaProps {
  readonly challenge?: SliderCaptchaValue<SliderCaptchaChallenge | null>
  readonly status?: SliderCaptchaValue<CaptchaStatus>
  readonly disabled?: SliderCaptchaValue<boolean>
  readonly collectDeviceSignals?: SliderCaptchaValue<boolean>
  readonly onSubmit?: (result: SliderCaptchaResult, challenge: SliderCaptchaChallenge) => void | PromiseLike<unknown>
  readonly onRetry?: () => void
  readonly onCancel?: () => void
  readonly retryLabel?: SliderCaptchaValue<string>
  readonly refreshingLabel?: SliderCaptchaValue<string>
  readonly retryIcon?: VobsNode | (() => VobsNode | null | undefined)
  readonly cancelLabel?: SliderCaptchaValue<string>
  readonly loadingLabel?: SliderCaptchaValue<string>
  readonly emptyLabel?: SliderCaptchaValue<string>
  readonly expiredLabel?: SliderCaptchaValue<string>
  readonly error?: SliderCaptchaValue<unknown>
  readonly errorLabel?: SliderCaptchaValue<string>
  readonly label?: SliderCaptchaValue<string>
  readonly dragLabel?: SliderCaptchaValue<string>
  readonly successDuration?: SliderCaptchaValue<number>
  readonly onSuccessDismiss?: () => void
  readonly class?: SliderCaptchaValue<string>
  readonly className?: SliderCaptchaValue<string>
  readonly id?: SliderCaptchaValue<string>
  readonly title?: SliderCaptchaValue<string>
  readonly role?: SliderCaptchaValue<string>
  readonly [name: `aria-${string}`]: string | number | boolean | undefined
  readonly [name: `data-${string}`]: string | number | boolean | undefined
}

export type SliderCaptchaValue<T> = T | Signal<T> | (() => T)

const sessionId = createSessionId()

export function collectCaptchaDeviceSignals(): CaptchaDeviceSignals {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') {
    return { sessionId }
  }

  let timezone: string | undefined
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    timezone = undefined
  }

  const screen = window.screen
  const navigatorWithMemory = navigator as Navigator & { deviceMemory?: number }
  return {
    sessionId,
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    language: navigator.language,
    languages: navigator.languages ? [...navigator.languages] : undefined,
    timezone,
    screen: {
      width: screen.width,
      height: screen.height,
      pixelRatio: window.devicePixelRatio || 1
    },
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight
    },
    touchPoints: navigator.maxTouchPoints,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: navigatorWithMemory.deviceMemory,
    webdriver: navigator.webdriver
  }
}

export function SliderCaptcha(props: SliderCaptchaProps = {}): VobsNode {
  const positions = new Map<string, number>()
  const successDismissed = state(false)
  let successTimer: ReturnType<typeof setTimeout> | undefined
  let waitingForDismiss = false

  effect(() => {
    const currentStatus = readValue<CaptchaStatus>(props, 'status', 'idle')
    if (currentStatus !== 'verified') {
      waitingForDismiss = false
      successDismissed.value = false
      if (successTimer !== undefined) {
        clearTimeout(successTimer)
        successTimer = undefined
      }
      return
    }
    if (waitingForDismiss) return
    waitingForDismiss = true
    const duration = Math.max(0, readValue(props, 'successDuration', 1_000))
    successTimer = setTimeout(() => {
      successTimer = undefined
      successDismissed.value = true
      props.onSuccessDismiss?.()
    }, duration)
  })
  onDispose(() => {
    if (successTimer !== undefined) clearTimeout(successTimer)
    positions.clear()
  })

  return Captcha<SliderCaptchaPayload>({
    get challenge() { return readValue<SliderCaptchaChallenge | null>(props, 'challenge', null) },
    get status() { return readValue<CaptchaStatus>(props, 'status', 'idle') },
    get error() { return readValue<unknown>(props, 'error', undefined) },
    get disabled() { return readValue(props, 'disabled', false) },
    get retryLabel() {
      return readValue<CaptchaStatus>(props, 'status', 'idle') === 'loading'
        ? readValue(props, 'refreshingLabel', 'Refreshing…')
        : readValue(props, 'retryLabel', 'Retry')
    },
    get retryIcon() { return props.retryIcon },
    get cancelLabel() { return readValue(props, 'cancelLabel', 'Cancel') },
    get loadingLabel() { return readValue(props, 'loadingLabel', 'Loading captcha…') },
    get emptyLabel() { return readValue(props, 'emptyLabel', 'Captcha is not ready.') },
    get expiredLabel() { return readValue(props, 'expiredLabel', 'This captcha has expired.') },
    get errorLabel() { return readValue(props, 'errorLabel', 'Captcha verification failed.') },
    get label() { return readValue(props, 'label', '') },
    get messagePlacement() { return 'none' as const },
    get keepChallengeOnError() { return true },
    get keepChallengeOnLoading() { return true },
    get keepChallengeOnVerifying() { return true },
    get showRetry() { return true },
    get showRetryWhileLoading() { return true },
    get showCancel() { return true },
    get class() {
      return classNames(
        'vobs-slider-captcha',
        successDismissed.value ? 'vobs-slider-captcha--dismissed' : undefined,
        readString(props, 'class'),
        readString(props, 'className')
      )
    },
    get id() { return readString(props, 'id') },
    get title() { return readString(props, 'title') },
    get role() { return readString(props, 'role') },
    onRetry: props.onRetry,
    onCancel: props.onCancel,
    onSubmit(answer, challenge) {
      if (!isSliderResult(answer)) return
      return props.onSubmit?.(answer, challenge as unknown as SliderCaptchaChallenge)
    },
    renderChallenge(context) {
      return createSliderChallenge(
        context,
        props,
        positions.get(context.challenge.id) ?? 0,
        position => positions.set(context.challenge.id, position)
      )
    },
    ...readDataAndAriaProps(props)
  })
}

function createSliderChallenge(
  context: CaptchaSubmitContext<SliderCaptchaPayload>,
  props: SliderCaptchaProps,
  initialPosition: number,
  onPositionChange: (position: number) => void
): VobsNode {
  const challenge = context.challenge
  const payload = challenge.payload!
  const interactionDisabled = context.disabled || context.status === 'error'
    || context.status === 'expired' || context.status === 'verified'
  const wrapper = createElement('div')
  const visual = createElement('div')
  const target = createElement('div')
  const targetImage = createElement('div')
  const piece = createElement('div')
  const pieceImage = createElement('div')
  const track = createElement('div')
  const trackPrompt = createElement('span')
  const handle = createElement('button')
  const handleText = createText(context.status === 'verified' ? '√' : readValue(props, 'dragLabel', '>'))
  const trail: SliderTrailPoint[] = []
  const startX = clamp(payload.startX ?? 0, 0, Math.max(0, payload.width - payload.pieceWidth))
  const maxPosition = Math.max(0, payload.width - payload.pieceWidth - startX)
  const position = state(clamp(initialPosition, 0, maxPosition))
  const dragging = state(false)
  const handleWidth = 50
  let startClientX = 0
  let startPosition = 0
  let lastRecordedAt = 0
  let startedAt = 0

  setAttribute(wrapper, 'class', 'vobs-slider-captcha__challenge')
  setAttribute(visual, 'class', 'vobs-slider-captcha__visual')
  setAttribute(target, 'class', `vobs-slider-captcha__target vobs-slider-captcha__target--${payload.shape ?? 'puzzle'}`)
  setAttribute(targetImage, 'class', 'vobs-slider-captcha__image')
  setAttribute(piece, 'class', `vobs-slider-captcha__piece vobs-slider-captcha__piece--${payload.shape ?? 'puzzle'}`)
  setAttribute(pieceImage, 'class', 'vobs-slider-captcha__image')
  setAttribute(track, 'class', 'vobs-slider-captcha__track')
  setAttribute(trackPrompt, 'class', 'vobs-slider-captcha__track-prompt')
  setAttribute(handle, 'class', `vobs-slider-captcha__handle${context.status === 'verified' ? ' vobs-slider-captcha__handle--verified' : ''}`)
  setAttribute(handle, 'type', 'button')
  setAttribute(handle, 'role', 'slider')
  setAttribute(handle, 'aria-label', context.status === 'verified' ? '验证通过' : readValue(props, 'dragLabel', '>'))
  insertBefore(trackPrompt, createText('向右拖动滑块完成拼图'), null)
  insertBefore(handle, handleText, null)

  const visualImageStyle = payload.image
    ? `background-image: url(${quoteCssUrl(payload.image)}); background-size: ${payload.width}px ${payload.height}px;`
    : ''
  const imageAt = (x: number, y: number) => payload.image
    ? `${visualImageStyle} background-position: -${x}px -${y}px;`
    : ''
  setAttribute(visual, 'style', `width: ${payload.width}px; height: ${payload.height}px; ${visualImageStyle}`)
  const targetRotation = rotationStyle(payload.rotation)
  setAttribute(target, 'style', `left: ${payload.targetX}px; top: ${payload.targetY}px; width: ${payload.pieceWidth}px; height: ${payload.pieceHeight}px; ${targetRotation}`)
  setAttribute(targetImage, 'style', `${counterRotationStyle(payload.rotation)} ${imageAt(payload.targetX, payload.targetY)}`)
  setAttribute(pieceImage, 'style', `${counterRotationStyle(payload.rotation)} ${imageAt(payload.targetX, payload.targetY)}`)
  setAttribute(piece, 'style', `top: ${payload.targetY}px; width: ${payload.pieceWidth}px; height: ${payload.pieceHeight}px; ${targetRotation}`)
  setAttribute(track, 'style', `width: ${payload.width}px`)
  insertBefore(target, targetImage, null)
  const decoys = readDecoys(payload)
  const decoyNodes = decoys.map(decoyData => {
    const decoy = createElement('div')
    const decoyImage = createElement('div')
    setAttribute(decoy, 'class', `vobs-slider-captcha__decoy vobs-slider-captcha__decoy--${payload.shape ?? 'puzzle'}`)
    setAttribute(decoyImage, 'class', 'vobs-slider-captcha__image')
    setAttribute(decoy, 'style', `left: ${decoyData.x}px; top: ${decoyData.y}px; width: ${payload.pieceWidth}px; height: ${payload.pieceHeight}px; ${rotationStyle(decoyData.rotation)}`)
    setAttribute(decoyImage, 'style', `${counterRotationStyle(decoyData.rotation)} ${imageAt(decoyData.x, decoyData.y)}`)
    insertBefore(decoy, decoyImage, null)
    return decoy
  })
  insertBefore(piece, pieceImage, null)
  insertBefore(visual, target, null)
  for (const decoy of decoyNodes) insertBefore(visual, decoy, null)
  insertBefore(visual, piece, null)
  if (context.status === 'error' || context.status === 'loading') {
    const notice = createElement('p')
    const isError = context.status === 'error'
    setAttribute(notice, 'class', isError ? 'vobs-slider-captcha__error' : 'vobs-slider-captcha__notice')
    setAttribute(notice, 'role', isError ? 'alert' : 'status')
    insertBefore(notice, createText(isError
      ? readErrorMessage(props)
      : readValue(props, 'loadingLabel', 'Refreshing captcha…')), null)
    insertBefore(visual, notice, null)
  }
  insertBefore(track, trackPrompt, null)
  insertBefore(track, handle, null)
  insertBefore(wrapper, visual, null)
  insertBefore(wrapper, track, null)

  effect(() => {
    const value = position.value
    const pieceX = startX + value
    onPositionChange(value)
    setAttribute(track, 'data-has-moved', String(value > 0))
    setAttribute(piece, 'style', `left: ${pieceX}px; top: ${payload.targetY}px; width: ${payload.pieceWidth}px; height: ${payload.pieceHeight}px; ${targetRotation}`)
    setAttribute(handle, 'style', `left: calc(${value / Math.max(1, maxPosition) * 100}% - ${value / Math.max(1, maxPosition) * handleWidth}px)`)
    setAttribute(handle, 'aria-valuemin', '0')
    setAttribute(handle, 'aria-valuemax', String(maxPosition))
    setAttribute(handle, 'aria-valuenow', String(Math.round(value)))
    setProperty(handle, 'disabled', interactionDisabled)
    setAttribute(wrapper, 'data-dragging', String(dragging.value))
  })

  for (const source of [piece, handle]) {
    addEventListener(source, 'pointerdown', event => {
      if (interactionDisabled) return
      const pointer = event as PointerEvent
      if (pointer.button !== undefined && pointer.button !== 0) return
      dragging.value = true
      startClientX = pointer.clientX
      startPosition = position.value
      startedAt = Date.now()
      lastRecordedAt = 0
      trail.length = 0
      recordPoint(pointer)
      const capture = source as Element & { setPointerCapture?: (pointerId: number) => void }
      capture.setPointerCapture?.(pointer.pointerId)
    })
    addEventListener(source, 'pointermove', event => {
      if (!dragging.value || interactionDisabled) return
      const pointer = event as PointerEvent
      const scale = getVisualScale(visual, payload.width)
      position.value = clamp(startPosition + (pointer.clientX - startClientX) / scale, 0, maxPosition)
      recordPoint(pointer)
    })
    addEventListener(source, 'pointerup', event => {
      if (!dragging.value) return
      recordPoint(event as PointerEvent, true)
      dragging.value = false
      submit()
    })
    addEventListener(source, 'pointercancel', () => {
      dragging.value = false
      position.value = 0
      trail.length = 0
    })
  }
  addEventListener(handle, 'keydown', event => {
    if (interactionDisabled) return
    const keyboard = event as KeyboardEvent
    if (keyboard.key === 'ArrowLeft' || keyboard.key === 'ArrowRight') {
      const direction = keyboard.key === 'ArrowRight' ? 1 : -1
      position.value = clamp(position.value + direction * Math.max(1, maxPosition / 20), 0, maxPosition)
      recordPoint({ clientX: position.value, clientY: 0 } as PointerEvent, true)
      keyboard.preventDefault()
    } else if (keyboard.key === 'Enter' || keyboard.key === ' ') {
      submit()
      keyboard.preventDefault()
    }
  })

  onDispose(() => {
    trail.length = 0
  })

  function recordPoint(pointer: PointerEvent, force = false): void {
    const now = Date.now()
    if (!force && now - lastRecordedAt < 20) return
    trail.push({ x: pointer.clientX, y: pointer.clientY, t: now })
    lastRecordedAt = now
  }

  function submit(): void {
    if (interactionDisabled || trail.length === 0) return
    const now = Date.now()
    const finalPoint = trail[trail.length - 1]
    context.submit({
      x: startX + position.value,
      y: payload.targetY,
      trail: trail.slice(),
      duration: Math.max(0, (finalPoint?.t ?? now) - (startedAt || now)),
      analysis: analyzeSliderTrail(trail),
      deviceSignals: readValue(props, 'collectDeviceSignals', true)
        ? collectCaptchaDeviceSignals()
        : undefined
    })
  }

  return wrapper
}

export function analyzeSliderTrail(trail: readonly SliderTrailPoint[]): SliderTrailAnalysis {
  if (trail.length === 0) {
    return {
      pointCount: 0,
      duration: 0,
      distance: 0,
      averageSpeed: 0,
      maxSpeed: 0,
      directionChanges: 0,
      verticalTravel: 0,
      averageInterval: 0,
      looksHuman: false
    }
  }

  let distance = 0
  let verticalTravel = 0
  let maxSpeed = 0
  let directionChanges = 0
  let previousDirection = 0
  let intervalTotal = 0
  let intervalCount = 0

  for (let index = 1; index < trail.length; index++) {
    const previous = trail[index - 1]
    const current = trail[index]
    const dx = current.x - previous.x
    const dy = current.y - previous.y
    const dt = Math.max(1, current.t - previous.t)
    const segmentDistance = Math.hypot(dx, dy)
    distance += segmentDistance
    verticalTravel += Math.abs(dy)
    maxSpeed = Math.max(maxSpeed, segmentDistance / dt * 1000)
    intervalTotal += current.t - previous.t
    intervalCount++

    if (Math.abs(dx) >= 0.5) {
      const direction = Math.sign(dx)
      if (previousDirection !== 0 && direction !== previousDirection) directionChanges++
      previousDirection = direction
    }
  }

  const duration = Math.max(0, trail[trail.length - 1].t - trail[0].t)
  const averageSpeed = duration > 0 ? distance / duration * 1000 : 0
  const averageInterval = intervalCount > 0 ? intervalTotal / intervalCount : 0
  const looksHuman = trail.length >= 3
    && duration >= 120
    && duration <= 10_000
    && directionChanges > 0

  return {
    pointCount: trail.length,
    duration,
    distance,
    averageSpeed,
    maxSpeed,
    directionChanges,
    verticalTravel,
    averageInterval,
    looksHuman
  }
}

function readErrorMessage(props: SliderCaptchaProps): string {
  const error = readValue<unknown>(props, 'error', undefined)
  if (typeof error === 'string' && error) return error
  if (error instanceof Error) return error.message
  return readValue(props, 'errorLabel', 'Captcha verification failed.')
}

function isSliderResult(value: unknown): value is SliderCaptchaResult {
  if (value === null || typeof value !== 'object') return false
  const result = value as Partial<SliderCaptchaResult>
  return typeof result.x === 'number' && typeof result.y === 'number'
    && typeof result.duration === 'number' && Array.isArray(result.trail)
    && typeof result.analysis === 'object' && result.analysis !== null
}

function getVisualScale(visual: Element, width: number): number {
  const measured = visual.getBoundingClientRect?.().width ?? width
  return measured > 0 ? measured / width : 1
}

function quoteCssUrl(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}` + '"'
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function rotationStyle(rotation: number | undefined): string {
  return rotation === undefined || rotation === 0 ? '' : `transform: rotate(${rotation}deg);`
}

function readDecoys(payload: SliderCaptchaPayload): readonly SliderCaptchaDecoy[] {
  if (payload.decoys !== undefined) return payload.decoys
  if (payload.decoyX === undefined || payload.decoyY === undefined) return []
  return [{ x: payload.decoyX, y: payload.decoyY, rotation: payload.decoyRotation }]
}

function counterRotationStyle(rotation: number | undefined): string {
  return rotation === undefined || rotation === 0 ? '' : `transform: rotate(${-rotation}deg);`
}

function classNames(...values: readonly (string | undefined)[]): string {
  return values.filter(Boolean).join(' ')
}

function readValue<T>(props: object, name: string, fallback: T): T {
  const value = Reflect.get(props, name)
  if (value === undefined) return fallback
  if (typeof value === 'function') return value() as T
  if (isSignal<T>(value)) return value.value
  return value as T
}

function readString(props: object, name: string): string | undefined {
  const value = readValue<string | undefined>(props, name, undefined)
  return typeof value === 'string' ? value : undefined
}

function readDataAndAriaProps(props: object): Record<string, string | number | boolean | undefined> {
  const result: Record<string, string | number | boolean | undefined> = {}
  for (const name of Object.keys(props)) {
    if (name.startsWith('aria-') || name.startsWith('data-')) result[name] = readValue(props, name, undefined)
  }
  return result
}

function isSignal<T>(value: unknown): value is Signal<T> {
  return value !== null && typeof value === 'object'
    && 'value' in value && typeof (value as { dispose?: unknown }).dispose === 'function'
}

function createSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `captcha-${Date.now()}-${Math.random().toString(36).slice(2)}`
}
