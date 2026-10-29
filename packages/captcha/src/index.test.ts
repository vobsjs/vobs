import { describe, expect, it, vi } from 'vitest'
import { createElement, createText, createVobs, insertBefore } from '@vobs/vobs'
import { state } from '@vobs/reactivity'
import {
  Captcha,
  analyzeSliderTrail,
  SliderCaptcha,
  type CaptchaChallenge,
  type CaptchaProps,
  type CaptchaStatus,
  type SliderCaptchaChallenge
} from './index'

function mountCaptcha<Challenge = unknown>(props: CaptchaProps<Challenge>): HTMLElement {
  const host = document.createElement('div')
  createVobs({ render: () => Captcha(props) }).mount(host)
  return host
}

describe('@vobs/captcha', () => {
  it('renders only the externally provided challenge and never issues requests', () => {
    const challenge: CaptchaChallenge<{ prompt: string }> = {
      id: 'challenge-1',
      type: 'custom',
      payload: { prompt: 'Answer this' },
      expiresAt: Date.now() + 60_000
    }
    const onSubmit = vi.fn()
    const host = mountCaptcha({
      challenge,
      status: 'ready',
      onSubmit,
      renderChallenge({ challenge: current, submit }) {
        const button = createElement('button')
        insertBefore(button, createText(current.payload!.prompt), null)
        button.addEventListener('click', () => submit('answer'))
        return button
      }
    })

    expect(host.querySelector('[data-status="ready"]')).not.toBeNull()
    expect(host.textContent).toContain('Answer this')
    host.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(onSubmit).toHaveBeenCalledWith('answer', challenge)
  })

  it('expired status and the retry action are controlled externally', () => {
    const retry = vi.fn()
    const host = mountCaptcha({ status: 'expired', onRetry: retry, expiredLabel: 'Expired' })
    expect(host.textContent).toContain('Expired')
    const button = host.querySelector('button')!
    expect(button.textContent).toBe('Retry')
    button.click()
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it('does not process server results; submit returns the business callback Promise as-is', async () => {
    const result = { token: 'server-token' }
    const onSubmit = vi.fn(async () => result)
    let submit!: (answer: string) => void | PromiseLike<unknown>
    mountCaptcha({
      challenge: { id: 'c1', expiresAt: Date.now() + 60_000 },
      status: 'ready',
      onSubmit,
      renderChallenge(context) {
        submit = context.submit
        return createElement('div')
      }
    })
    await expect(submit('answer')).resolves.toBe(result)
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('does not submit when onSubmit is missing or status is loading/verifying', () => {
    const onSubmit = vi.fn()
    const host = mountCaptcha({
      challenge: { id: 'c1', expiresAt: Date.now() + 60_000 },
      status: 'verifying',
      onSubmit,
      renderChallenge({ submit }) {
        const button = createElement('button')
        button.addEventListener('click', () => submit('answer'))
        return button
      }
    })
    expect(host.textContent).toContain('Verifying captcha…')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('supports Signal props and updates the UI with external state and challenge', async () => {
    const status = state<CaptchaStatus>('loading')
    const challenge = state<CaptchaChallenge<{ prompt: string }> | null>(null)
    const error = state<unknown>(null)
    const host = mountCaptcha({
      challenge,
      status,
      error,
      onRetry: vi.fn(),
      renderChallenge({ challenge: current }) {
        return createText(current.payload!.prompt)
      }
    })

    expect(host.textContent).toContain('Loading captcha…')
    status.value = 'ready'
    await Promise.resolve()
    expect(host.textContent).toContain('Captcha is not ready.')

    challenge.value = {
      id: 'c2',
      payload: { prompt: 'Solve this' },
      expiresAt: Date.now() + 60_000
    }
    await Promise.resolve()
    expect(host.textContent).toContain('Solve this')

    status.value = 'error'
    error.value = new Error('verification failed')
    await Promise.resolve()
    expect(host.textContent).toContain('verification failed')
  })

  it('supports getter props reading Signals and switches action buttons after status updates', async () => {
    const status = state<CaptchaStatus>('loading')
    const retry = vi.fn()
    const host = mountCaptcha({
      get status() { return status.value },
      onRetry: retry,
      onCancel: vi.fn()
    })

    expect(host.querySelector('.vobs-captcha__action')?.textContent).toBe('Cancel')
    status.value = 'expired'
    await Promise.resolve()
    expect(host.querySelector('.vobs-captcha__action')?.textContent).toBe('Retry')
    host.querySelector('button')!.click()
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it('renders the slider gap and submits trail and device signals after Pointer dragging ends', async () => {
    const challenge: SliderCaptchaChallenge = {
      id: 'slider-1',
      payload: {
        image: 'data:image/svg+xml,%3Csvg%20xmlns="http://www.w3.org/2000/svg"%3E%3C/svg%3E',
        width: 320,
        height: 160,
        targetX: 180,
        targetY: 50,
        rotation: 18,
        decoyX: 104,
        decoyY: 76,
        decoyRotation: -12,
        pieceWidth: 48,
        pieceHeight: 48,
        shape: 'puzzle'
      },
      expiresAt: Date.now() + 60_000
    }
    const onSubmit = vi.fn()
    const host = document.createElement('div')
    createVobs({
      render: () => SliderCaptcha({ challenge, status: 'ready', onSubmit })
    }).mount(host)

    const handle = host.querySelector('[role="slider"]') as HTMLElement
    expect(handle).not.toBeNull()
    expect(handle.textContent).toBe('>')
    expect(host.querySelector('.vobs-slider-captcha__track-prompt')?.textContent).toBe('Drag the slider to complete the puzzle')
    expect(host.querySelector('.vobs-slider-captcha__target')).not.toBeNull()
    expect(host.querySelector('.vobs-slider-captcha__decoy')).not.toBeNull()
    expect(host.querySelector('.vobs-slider-captcha__piece .vobs-slider-captcha__image')?.getAttribute('style'))
      .toContain('background-position: -180px -50px')
    expect(host.querySelector('.vobs-slider-captcha__target .vobs-slider-captcha__image')?.getAttribute('style'))
      .toContain('background-position: -180px -50px')
    expect(host.querySelector('.vobs-slider-captcha__target')?.getAttribute('style'))
      .toContain('transform: rotate(18deg)')
    expect(host.querySelector('.vobs-slider-captcha__target .vobs-slider-captcha__image')?.getAttribute('style'))
      .toContain('transform: rotate(-18deg)')
    expect(host.querySelector('.vobs-slider-captcha__piece .vobs-slider-captcha__image')?.getAttribute('style'))
      .toContain('transform: rotate(-18deg)')
    expect(host.querySelector('.vobs-slider-captcha__decoy')?.getAttribute('style'))
      .toContain('transform: rotate(-12deg)')
    expect(host.querySelector('.vobs-slider-captcha__decoy .vobs-slider-captcha__image')?.getAttribute('style'))
      .toContain('transform: rotate(12deg)')

    handle.dispatchEvent(pointerEvent('pointerdown', 10, 40))
    handle.dispatchEvent(pointerEvent('pointermove', 120, 43))
    handle.dispatchEvent(pointerEvent('pointerup', 120, 43))

    await Promise.resolve()
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(host.querySelector('.vobs-slider-captcha__track')?.getAttribute('data-has-moved')).toBe('true')
    const [result, submittedChallenge] = onSubmit.mock.calls[0]
    expect(result.x).toBeGreaterThan(0)
    expect(result.trail.length).toBeGreaterThanOrEqual(2)
    expect(result.deviceSignals?.sessionId).toBeTypeOf('string')
    expect(submittedChallenge).toBe(challenge)
  })

  it('the puzzle piece itself is draggable and submits the result', async () => {
    const challenge: SliderCaptchaChallenge = {
      id: 'slider-piece-1',
      payload: {
        width: 320,
        height: 160,
        targetX: 180,
        targetY: 50,
        pieceWidth: 48,
        pieceHeight: 48
      },
      expiresAt: Date.now() + 60_000
    }
    const onSubmit = vi.fn()
    const host = document.createElement('div')
    createVobs({
      render: () => SliderCaptcha({ challenge, status: 'ready', onSubmit })
    }).mount(host)

    const piece = host.querySelector('.vobs-slider-captcha__piece') as HTMLElement
    piece.dispatchEvent(pointerEvent('pointerdown', 10, 40))
    piece.dispatchEvent(pointerEvent('pointermove', 120, 43))
    piece.dispatchEvent(pointerEvent('pointerup', 120, 43))

    await Promise.resolve()
    expect(piece.getAttribute('style')).toContain('left: 110px')
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('supports a variable number of decoy gaps provided by the challenge', () => {
    const challenge: SliderCaptchaChallenge = {
      id: 'slider-decoys-1',
      payload: {
        width: 320,
        height: 160,
        targetX: 220,
        targetY: 50,
        decoys: [
          { x: 104, y: 22, rotation: -12 },
          { x: 154, y: 96, rotation: 18 },
          { x: 204, y: 24 }
        ],
        pieceWidth: 48,
        pieceHeight: 48
      },
      expiresAt: Date.now() + 60_000
    }
    const host = document.createElement('div')
    createVobs({ render: () => SliderCaptcha({ challenge, status: 'ready' }) }).mount(host)

    expect(host.querySelectorAll('.vobs-slider-captcha__decoy')).toHaveLength(3)
    expect(host.querySelectorAll('.vobs-slider-captcha__decoy .vobs-slider-captcha__image')).toHaveLength(3)
    expect(host.querySelector('.vobs-slider-captcha__decoy')?.getAttribute('style')).toContain('rotate(-12deg)')
    expect(host.querySelectorAll('.vobs-slider-captcha__decoy')[2]?.querySelector('.vobs-slider-captcha__image')?.getAttribute('style'))
      .not.toContain('transform: rotate(')
  })

  it('supports a left-side startX initial piece position and submits absolute coordinates within the image', async () => {
    const challenge: SliderCaptchaChallenge = {
      id: 'slider-start-position-1',
      payload: {
        width: 320,
        height: 160,
        startX: 52,
        targetX: 180,
        targetY: 50,
        pieceWidth: 48,
        pieceHeight: 48
      },
      expiresAt: Date.now() + 60_000
    }
    const onSubmit = vi.fn()
    const host = document.createElement('div')
    createVobs({
      render: () => SliderCaptcha({ challenge, status: 'ready', onSubmit })
    }).mount(host)

    const handle = host.querySelector('[role="slider"]') as HTMLElement
    expect(host.querySelector('.vobs-slider-captcha__piece')?.getAttribute('style')).toContain('left: 52px')
    handle.dispatchEvent(pointerEvent('pointerdown', 10, 40))
    handle.dispatchEvent(pointerEvent('pointermove', 120, 43))
    handle.dispatchEvent(pointerEvent('pointerup', 120, 43))
    await Promise.resolve()

    expect(host.querySelector('.vobs-slider-captcha__piece')?.getAttribute('style')).toContain('left: 162px')
    expect(onSubmit.mock.calls[0][0].x).toBe(162)
  })

  it('keeps the piece position on verification failure and overlays the error at the bottom of the image', async () => {
    const status = state<CaptchaStatus>('ready')
    const error = state<unknown>(null)
    const challenge: SliderCaptchaChallenge = {
      id: 'slider-error-1',
      payload: {
        width: 320,
        height: 160,
        targetX: 180,
        targetY: 50,
        decoyX: 104,
        decoyY: 76,
        pieceWidth: 48,
        pieceHeight: 48
      },
      expiresAt: Date.now() + 60_000
    }
    const host = document.createElement('div')
    createVobs({
      render: () => SliderCaptcha({ challenge, status, error, onSubmit: vi.fn() })
    }).mount(host)

    const piece = host.querySelector('.vobs-slider-captcha__piece') as HTMLElement
    piece.dispatchEvent(pointerEvent('pointerdown', 10, 40))
    piece.dispatchEvent(pointerEvent('pointermove', 120, 43))
    await Promise.resolve()

    status.value = 'error'
    error.value = 'Slider position is incorrect, please retry.'
    await Promise.resolve()

    expect(host.querySelector('.vobs-slider-captcha__piece')?.getAttribute('style')).toContain('left: 110px')
    expect(host.querySelector('.vobs-slider-captcha__error')?.textContent).toContain('Slider position is incorrect')
    expect(host.querySelector('.vobs-captcha__message-host')?.textContent).toBe('')
  })

  it('keeps the canvas and panel size while refreshing and disables dragging and the refresh action', async () => {
    const status = state<CaptchaStatus>('ready')
    const challenge: SliderCaptchaChallenge = {
      id: 'slider-loading-1',
      payload: {
        width: 320,
        height: 160,
        targetX: 180,
        targetY: 50,
        pieceWidth: 48,
        pieceHeight: 48
      },
      expiresAt: Date.now() + 60_000
    }
    const host = document.createElement('div')
    createVobs({
      render: () => SliderCaptcha({
        challenge,
        status,
        onSubmit: vi.fn(),
        onRetry: vi.fn(),
        retryLabel: 'Refresh',
        refreshingLabel: 'Refreshing',
        loadingLabel: 'Refreshing captcha…'
      })
    }).mount(host)

    status.value = 'loading'
    await Promise.resolve()

    expect(host.querySelector('.vobs-slider-captcha__visual')).not.toBeNull()
    expect((host.querySelector('[role="slider"]') as HTMLButtonElement).disabled).toBe(true)
    expect((host.querySelector('.vobs-captcha__action') as HTMLButtonElement).disabled).toBe(true)
    expect(host.querySelector('.vobs-captcha__action')?.textContent).toBe('Refreshing')
    expect(host.querySelector('.vobs-slider-captcha__notice')?.textContent).toContain('Refreshing captcha')
  })

  it('hides the component after a configurable delay once verified', async () => {
    vi.useFakeTimers()
    try {
      const status = state<CaptchaStatus>('ready')
      const challenge: SliderCaptchaChallenge = {
        id: 'slider-success-1',
        payload: {
          width: 320,
          height: 160,
          targetX: 180,
          targetY: 50,
          pieceWidth: 48,
          pieceHeight: 48
        },
        expiresAt: Date.now() + 60_000
      }
      const host = document.createElement('div')
      createVobs({
        render: () => SliderCaptcha({ challenge, status, successDuration: 300, onSubmit: vi.fn() })
      }).mount(host)

      status.value = 'verified'
      await Promise.resolve()
      expect(host.querySelector('.vobs-slider-captcha')?.className).not.toContain('--dismissed')
      expect(host.querySelector('[role="slider"]')?.textContent).toBe('√')
      expect(host.querySelector('[role="slider"]')?.className).toContain('--verified')
      vi.advanceTimersByTime(300)
      await Promise.resolve()
      expect(host.querySelector('.vobs-slider-captcha')?.className).toContain('--dismissed')
    } finally {
      vi.useRealTimers()
    }
  })

  it('computes basic behavioral features of the slider trail and flags obviously incomplete trails', () => {
    const analysis = analyzeSliderTrail([
      { x: 0, y: 10, t: 0 },
      { x: 40, y: 11, t: 100 },
      { x: 80, y: 9, t: 220 },
      { x: 72, y: 10, t: 360 }
    ])

    expect(analysis.pointCount).toBe(4)
    expect(analysis.duration).toBe(360)
    expect(analysis.distance).toBeGreaterThan(0)
    expect(analysis.directionChanges).toBe(1)
    expect(analysis.verticalTravel).toBe(4)
    expect(analysis.looksHuman).toBe(true)
    expect(analyzeSliderTrail([{ x: 0, y: 0, t: 0 }]).looksHuman).toBe(false)
  })
})

function pointerEvent(type: string, clientX: number, clientY: number): Event {
  const event = new Event(type, { bubbles: true })
  Object.assign(event, { clientX, clientY, button: 0, pointerId: 1 })
  return event
}
