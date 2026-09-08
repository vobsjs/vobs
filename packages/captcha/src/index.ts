import {
  addEventListener,
  createElement,
  createFragment,
  createText,
  effect,
  insertBefore,
  insertDynamic,
  setAttribute,
  setProperty,
  type Signal,
  type VobsNode
} from '@vobs/vobs'

export type CaptchaStatus = 'idle' | 'loading' | 'ready' | 'verifying' | 'verified' | 'expired' | 'error'
export type CaptchaAnswer = string | Readonly<Record<string, unknown>> | null | undefined
export type CaptchaValue<T> = T | Signal<T> | (() => T)

export interface CaptchaChallenge<T = unknown> {
  readonly id: string
  readonly type?: string
  readonly payload?: T
  readonly expiresAt: number
}

export interface CaptchaSubmitContext<Challenge = unknown> {
  readonly challenge: CaptchaChallenge<Challenge>
  readonly status: CaptchaStatus
  readonly disabled: boolean
  submit(answer: CaptchaAnswer): void | PromiseLike<unknown>
}

export type CaptchaChallengeRenderer<Challenge = unknown> =
  (context: CaptchaSubmitContext<Challenge>) => VobsNode | null | undefined

export interface CaptchaProps<Challenge = unknown> {
  readonly challenge?: CaptchaValue<CaptchaChallenge<Challenge> | null>
  readonly status?: CaptchaValue<CaptchaStatus>
  readonly error?: CaptchaValue<unknown>
  readonly disabled?: CaptchaValue<boolean>
  readonly renderChallenge?: CaptchaChallengeRenderer<Challenge>
  readonly onSubmit?: (answer: CaptchaAnswer, challenge: CaptchaChallenge<Challenge>) => void | PromiseLike<unknown>
  readonly onRetry?: () => void
  readonly onCancel?: () => void
  readonly retryLabel?: CaptchaValue<string>
  readonly cancelLabel?: CaptchaValue<string>
  readonly loadingLabel?: CaptchaValue<string>
  readonly emptyLabel?: CaptchaValue<string>
  readonly expiredLabel?: CaptchaValue<string>
  readonly errorLabel?: CaptchaValue<string>
  readonly label?: CaptchaValue<string>
  readonly messagePlacement?: 'challenge' | 'footer' | 'none'
  readonly keepChallengeOnError?: boolean
  readonly keepChallengeOnLoading?: boolean
  readonly keepChallengeOnVerifying?: boolean
  readonly showRetry?: boolean
  readonly showRetryWhileLoading?: boolean
  readonly showCancel?: boolean
  readonly retryIcon?: VobsNode | (() => VobsNode | null | undefined)
  readonly class?: CaptchaValue<string>
  readonly className?: CaptchaValue<string>
  readonly id?: CaptchaValue<string>
  readonly title?: CaptchaValue<string>
  readonly role?: CaptchaValue<string>
  readonly [name: `aria-${string}`]: string | number | boolean | undefined
  readonly [name: `data-${string}`]: string | number | boolean | undefined
}

export function Captcha<Challenge = unknown>(props: CaptchaProps<Challenge> = {}): VobsNode {
  const root = createElement('section')
  const challengeHost = createElement('div')
  const messageHost = createElement('div')
  const actions = createElement('div')
  const header = createElement('div')
  const headerText = createText('')

  setAttribute(header, 'class', 'vobs-captcha__header')
  setAttribute(challengeHost, 'class', 'vobs-captcha__challenge')
  setAttribute(messageHost, 'class', 'vobs-captcha__message-host')
  setAttribute(actions, 'class', 'vobs-captcha__actions')
  insertBefore(root, header, null)
  insertBefore(root, challengeHost, null)
  insertBefore(root, messageHost, null)
  insertBefore(root, actions, null)

  insertDynamic(header, null, () => {
    const label = readString(props, 'label')
    if (!label) return null
    setText(headerText, label)
    return headerText
  })

  effect(() => {
    const status = readValue<CaptchaStatus>(props, 'status', 'idle')
    setAttribute(root, 'class', classNames('vobs-captcha', readString(props, 'class'), readString(props, 'className')))
    setAttribute(root, 'data-status', status)
    setOptionalAttribute(root, 'id', readString(props, 'id'))
    setOptionalAttribute(root, 'title', readString(props, 'title'))
    setOptionalAttribute(root, 'role', readString(props, 'role'))
    setAttribute(root, 'aria-busy', String(status === 'loading' || status === 'verifying'))
    if (readValue(props, 'disabled', false) || status === 'loading' || status === 'verifying') setAttribute(root, 'aria-disabled', 'true')
    else root.removeAttribute('aria-disabled')
    bindDataAndAriaAttributes(root, props)
  })

  insertDynamic(challengeHost, null, () => renderChallenge(props))
  insertDynamic(messageHost, null, () => renderMessage(props))
  insertDynamic(actions, null, () => renderActions(props))
  return root

  function renderChallenge(input: CaptchaProps<Challenge>): VobsNode | null {
    const status = readValue<CaptchaStatus>(input, 'status', 'idle')
    const challenge = readValue<CaptchaChallenge<Challenge> | null>(input, 'challenge', null)
    const disabled = readValue(input, 'disabled', false) || status === 'loading' || status === 'verifying'
    const renderer = readCallback<CaptchaChallengeRenderer<Challenge> | undefined>(input, 'renderChallenge', undefined)

    if (status === 'loading' && !readValue(input, 'keepChallengeOnLoading', false)) {
      return createMessage(readValue(input, 'loadingLabel', 'Loading captcha…'))
    }
    if (status === 'verifying' && !readValue(input, 'keepChallengeOnVerifying', false)) {
      return createMessage('Verifying captcha…')
    }
    if (status === 'expired') return createMessage(readValue(input, 'expiredLabel', 'This captcha has expired.'))
    if (status === 'error' && !readValue(input, 'keepChallengeOnError', false)
      && readValue(input, 'messagePlacement', 'challenge') === 'challenge') {
      return createMessage(readError(input) || readValue(input, 'errorLabel', 'Captcha verification failed.'))
    }
    if (status === 'error' && !readValue(input, 'keepChallengeOnError', false)) return null
    if (!challenge) return createMessage(readValue(input, 'emptyLabel', 'Captcha is not ready.'))
    if (!renderer) return createMessage('Provide renderChallenge to render this captcha challenge.')

    return renderer({
      challenge,
      status,
      disabled,
      submit(answer) {
        const onSubmit = readCallback<CaptchaProps<Challenge>['onSubmit'] | undefined>(input, 'onSubmit', undefined)
        if (disabled || !onSubmit) return
        return onSubmit(answer, challenge)
      }
    }) ?? createMessage(readValue(input, 'emptyLabel', 'Captcha is not ready.'))
  }

  function renderMessage(input: CaptchaProps<Challenge>): VobsNode | null {
    const status = readValue<CaptchaStatus>(input, 'status', 'idle')
    if (readValue<'challenge' | 'footer' | 'none'>(input, 'messagePlacement', 'challenge') !== 'footer') return null
    if (status !== 'error') return null
    return createMessage(readError(input) || readValue(input, 'errorLabel', 'Captcha verification failed.'))
  }

  function renderActions(input: CaptchaProps<Challenge>): VobsNode | null {
    const status = readValue<CaptchaStatus>(input, 'status', 'idle')
    const disabled = readValue(input, 'disabled', false) || status === 'loading' || status === 'verifying'
    const retry = readCallback<(() => void) | undefined>(input, 'onRetry', undefined)
    const cancel = readCallback<(() => void) | undefined>(input, 'onCancel', undefined)
    if (!retry && !cancel) return null
    return createFragment((parent, anchor) => {
      const canRetry = status === 'idle' || status === 'expired' || status === 'error'
        || (status === 'loading' && readValue(input, 'showRetryWhileLoading', false))
        || (readValue(input, 'showRetry', false) && status !== 'loading' && status !== 'verifying')
      if (retry && canRetry) {
        insertBefore(parent, createActionButton(
          readValue(input, 'retryLabel', 'Retry'),
          readCallback(input, 'retryIcon', undefined),
          retry,
          disabled,
          'vobs-captcha__action--retry'
        ), anchor)
      }
      const canCancel = status === 'loading' || status === 'verifying' || readValue(input, 'showCancel', false)
      if (cancel && canCancel) {
        insertBefore(parent, createActionButton(
          readValue(input, 'cancelLabel', 'Cancel'),
          undefined,
          cancel,
          disabled,
          'vobs-captcha__action--cancel'
        ), anchor)
      }
    })
  }

  function createActionButton(
    label: string,
    icon: VobsNode | (() => VobsNode | null | undefined) | undefined,
    handler: () => void,
    disabled: boolean,
    variant: string
  ): Element {
    const button = createElement('button')
    setAttribute(button, 'class', `vobs-captcha__action ${variant}`)
    setAttribute(button, 'type', 'button')
    setAttribute(button, 'aria-label', label)
    setProperty(button, 'disabled', disabled)
    if (icon !== undefined) {
      const iconHost = createElement('span')
      setAttribute(iconHost, 'class', 'vobs-captcha__action-icon')
      const value = typeof icon === 'function' ? icon() : icon
      if (value !== null && value !== undefined) insertBefore(iconHost, value, null)
      insertBefore(button, iconHost, null)
    }
    insertBefore(button, createText(label), null)
    addEventListener(button, 'click', handler)
    return button
  }

  function createMessage(message: string): VobsNode {
    const node = createElement('p')
    setAttribute(node, 'class', 'vobs-captcha__message')
    insertBefore(node, createText(message), null)
    return node
  }
}

function setText(node: Text, value: string): void {
  node.data = value
}

export { SliderCaptcha, analyzeSliderTrail, collectCaptchaDeviceSignals } from './slider'
export type {
  CaptchaDeviceSignals,
  SliderCaptchaDecoy,
  SliderCaptchaChallenge,
  SliderCaptchaPayload,
  SliderCaptchaProps,
  SliderCaptchaResult,
  SliderTrailAnalysis,
  SliderCaptchaValue,
  SliderShape,
  SliderTrailPoint
} from './slider'

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

function readCallback<T>(props: object, name: string, fallback: T): T {
  const value = Reflect.get(props, name)
  return (value === undefined ? fallback : value) as T
}

function readString(props: object, name: string): string | undefined {
  const value = readValue<string | undefined>(props, name, undefined)
  return typeof value === 'string' ? value : undefined
}

function readError(props: object): string | undefined {
  const error = readValue<unknown>(props, 'error', undefined)
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message
  return error == null ? undefined : String(error)
}

function setOptionalAttribute(node: Element, name: string, value: string | undefined): void {
  if (value) setAttribute(node, name, value)
  else node.removeAttribute(name)
}

function bindDataAndAriaAttributes(node: Element, props: object): void {
  for (const name of Object.keys(props)) {
    if (!name.startsWith('aria-') && !name.startsWith('data-')) continue
    const value = readValue<unknown>(props, name, undefined)
    if (value === undefined || value === null || value === false) node.removeAttribute(name)
    else setAttribute(node, name, String(value))
  }
}

function isSignal<T>(value: unknown): value is Signal<T> {
  return value !== null && typeof value === 'object'
    && 'value' in value && typeof (value as { dispose?: unknown }).dispose === 'function'
}
