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
  it('只渲染外部传入的 challenge，不发起请求', () => {
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

  it('由外部控制 expired 和 retry 动作', () => {
    const retry = vi.fn()
    const host = mountCaptcha({ status: 'expired', onRetry: retry, expiredLabel: '已过期' })
    expect(host.textContent).toContain('已过期')
    const button = host.querySelector('button')!
    expect(button.textContent).toBe('Retry')
    button.click()
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it('不处理服务端结果，submit 原样返回业务回调的 Promise', async () => {
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

  it('没有 onSubmit 或处于 loading/verifying 时不会提交', () => {
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

  it('支持 Signal props，并随外部状态和 challenge 更新 UI', async () => {
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
    error.value = new Error('验证失败')
    await Promise.resolve()
    expect(host.textContent).toContain('验证失败')
  })

  it('支持读取 Signal 的 getter props，并在状态更新后切换操作按钮', async () => {
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

  it('渲染滑块缺口并在 Pointer 拖动结束后提交轨迹和设备信号', async () => {
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
    expect(host.querySelector('.vobs-slider-captcha__track-prompt')?.textContent).toBe('向右拖动滑块完成拼图')
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

  it('拼图块本身也可以拖动并提交结果', async () => {
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

  it('支持由 challenge 提供数量不固定的多个干扰缺口', () => {
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

  it('支持左侧 startX 初始拼图位置，并提交图片内的绝对坐标', async () => {
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

  it('校验失败时保持拼图位置，并将错误覆盖在图片底部', async () => {
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
    error.value = '滑块位置不正确，请重试。'
    await Promise.resolve()

    expect(host.querySelector('.vobs-slider-captcha__piece')?.getAttribute('style')).toContain('left: 110px')
    expect(host.querySelector('.vobs-slider-captcha__error')?.textContent).toContain('滑块位置不正确')
    expect(host.querySelector('.vobs-captcha__message-host')?.textContent).toBe('')
  })

  it('刷新时保留画布和面板尺寸，并禁用拖动与刷新操作', async () => {
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
        retryLabel: '刷新',
        refreshingLabel: '刷新中',
        loadingLabel: '正在刷新验证码…'
      })
    }).mount(host)

    status.value = 'loading'
    await Promise.resolve()

    expect(host.querySelector('.vobs-slider-captcha__visual')).not.toBeNull()
    expect((host.querySelector('[role="slider"]') as HTMLButtonElement).disabled).toBe(true)
    expect((host.querySelector('.vobs-captcha__action') as HTMLButtonElement).disabled).toBe(true)
    expect(host.querySelector('.vobs-captcha__action')?.textContent).toBe('刷新中')
    expect(host.querySelector('.vobs-slider-captcha__notice')?.textContent).toContain('正在刷新验证码')
  })

  it('验证成功后按可配置延迟隐藏组件', async () => {
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

  it('计算滑块轨迹的基础行为特征，并标记明显不完整的轨迹', () => {
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
