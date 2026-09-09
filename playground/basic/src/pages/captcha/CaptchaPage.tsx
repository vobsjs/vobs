import { onDispose, state } from '@vobs/vobs'
import {
  SliderCaptcha,
  type SliderCaptchaChallenge,
  type SliderCaptchaResult
} from '@vobs/captcha'
import { Icon, Tag } from '@vobs/ui'
import { KitPage } from '@vobs/kit'
import { useI18n } from '@vobs/i18n'

const demoShapes = ['square', 'circle', 'triangle'] as const
const demoPalettes = [
  ['#234b63', '#32f08c', '#3c7eff'],
  ['#5b345e', '#f48cca', '#80bbff'],
  ['#6b4b2b', '#f0d87e', '#f29d79']
] as const

let challengeSequence = 0

function svgImage(shape: typeof demoShapes[number], base: string, primary: string, secondary: string): string {
  const geometry = shape === 'circle'
    ? `<g fill="none" stroke="${secondary}" stroke-opacity=".24" stroke-width="3">
        <circle cx="200" cy="100" r="26"/><circle cx="200" cy="100" r="56"/><circle cx="200" cy="100" r="88"/>
        <path d="M200 12v176M112 100h176M138 38l124 124M262 38L138 162"/>
      </g>`
    : shape === 'triangle'
      ? `<g fill="none" stroke="${secondary}" stroke-opacity=".24" stroke-width="3">
          <path d="M200 12 28 180h344zM200 48 66 172h268zM200 84 104 164h192z"/>
          <path d="M28 180 200 12l172 168M66 172 200 48l134 124"/>
        </g>`
      : '<rect width="400" height="200" fill="url(#p)"/>'
  const source = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200" viewBox="0 0 400 200">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${base}"/><stop offset="1" stop-color="#111827"/>
      </linearGradient>
      <pattern id="p" width="32" height="32" patternUnits="userSpaceOnUse" patternTransform="rotate(18)">
        <path d="M0 16h32M16 0v32" stroke="${secondary}" stroke-opacity=".2" stroke-width="3"/>
      </pattern>
    </defs>
    <rect width="400" height="200" fill="url(#g)"/>
    <circle cx="48" cy="34" r="36" fill="${primary}" fill-opacity=".24"/>
    <circle cx="222" cy="96" r="56" fill="${secondary}" fill-opacity=".24"/>
    <path d="M-20 104C46 42 96 144 168 62S276 42 308 16" fill="none" stroke="${primary}" stroke-opacity=".45" stroke-width="16"/>
    ${geometry}
  </svg>`
  return `data:image/svg+xml,${encodeURIComponent(source)}`
}

function createDemoChallenge(): SliderCaptchaChallenge {
  const index = challengeSequence++ % 3
  const shape = demoShapes[index]
  const [base, primary, secondary] = demoPalettes[index]
  const startX = randomInteger(0, 24)
  const targetX = randomInteger(316, 332)
  const targetY = randomInteger(76, 108)
  const decoyCount = randomInteger(1, 3)
  const decoys = shuffle([
    { x: 156, y: 28 },
    { x: 216, y: 124 },
    { x: 270, y: 28 }
  ]).slice(0, decoyCount).map(({ x, y }) => ({
    x,
    y,
    rotation: randomChoice([-26, -18, -12, 12, 18, 26])
  }))
  return {
    id: `playground-slider-${challengeSequence}`,
    payload: {
      image: svgImage(shape, base, primary, secondary),
      width: 400,
      height: 200,
      startX,
      targetX,
      targetY,
      rotation: randomChoice([-26, -18, -12, 12, 18, 26]),
      decoys,
      pieceWidth: 48,
      pieceHeight: 48,
      tolerance: 8,
      shape
    },
    expiresAt: Date.now() + 90_000
  }
}

function randomInteger(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function randomChoice<T>(values: readonly T[]): T {
  return values[randomInteger(0, values.length - 1)]!
}

function shuffle<T>(values: readonly T[]): T[] {
  const result = [...values]
  for (let index = result.length - 1; index > 0; index--) {
    const swapIndex = randomInteger(0, index)
    const current = result[index]
    result[index] = result[swapIndex]!
    result[swapIndex] = current!
  }
  return result
}

export function CaptchaPage() {
  const i18n = useI18n()
  const challenge = state<SliderCaptchaChallenge | null>(createDemoChallenge())
  const status = state<'idle' | 'loading' | 'ready' | 'verifying' | 'verified' | 'expired' | 'error'>('ready')
  const error = state<unknown>(null)
  const closed = state(false)
  let operation = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let finishPending: (() => void) | undefined

  onDispose(() => {
    operation++
    clearPending()
  })

  function clearPending(): void {
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
    finishPending?.()
    finishPending = undefined
  }

  function reloadCaptcha(): void {
    clearPending()
    closed.value = false
    const currentOperation = ++operation
    error.value = null
    status.value = 'loading'
    timer = setTimeout(() => {
      if (currentOperation !== operation) return
      challenge.value = createDemoChallenge()
      status.value = 'ready'
      timer = undefined
    }, 450)
  }

  function cancelCaptcha(): void {
    clearPending()
    operation++
    challenge.value = null
    error.value = null
    status.value = 'idle'
    closed.value = true
  }

  async function verifyCaptcha(result: SliderCaptchaResult, current: SliderCaptchaChallenge): Promise<void> {
    clearPending()
    const currentOperation = ++operation
    error.value = null
    status.value = 'verifying'
    await new Promise<void>(resolve => {
      finishPending = resolve
      timer = setTimeout(() => {
        timer = undefined
        finishPending = undefined
        resolve()
      }, 500)
    })
    if (currentOperation !== operation) return

    const tolerance = current.payload.tolerance ?? 4
    if (Math.abs(result.x - current.payload.targetX) <= tolerance && result.trail.length >= 3) {
      status.value = 'verified'
    } else {
      error.value = Math.abs(result.x - current.payload.targetX) <= tolerance
        ? i18n.t('captcha.trailError')
        : i18n.t('captcha.positionError')
      status.value = 'error'
    }
  }

  return (
    <KitPage
      class="demo-shell"
      title={i18n.t('captcha.title')}
      description={i18n.t('captcha.description')}
      actions={<Tag tone="brand">{i18n.t('captcha.mockSlider')}</Tag>}
    >
      <div class="captcha-demo">
        <div class="captcha-demo__intro">
          <h2>{i18n.t('captcha.sliderTitle')}</h2>
          <p>
            {i18n.t('captcha.instructions')}
          </p>
          <p class="captcha-demo__security-note">
            {i18n.t('captcha.security')}
          </p>
        </div>
        <SliderCaptcha
          challenge={challenge}
          status={status}
          error={error}
          collectDeviceSignals
          dragLabel=">"
          retryIcon={<Icon name="refresh" />}
          onRetry={reloadCaptcha}
          onCancel={cancelCaptcha}
          onSubmit={verifyCaptcha}
          retryLabel={i18n.t('captcha.retry')}
          refreshingLabel={i18n.t('captcha.refreshing')}
          cancelLabel="×"
          successDuration={3_000}
          class={() => closed.value ? 'captcha-demo__captcha--closed' : ''}
          loadingLabel={i18n.t('captcha.loading')}
          emptyLabel={i18n.t('captcha.empty')}
          expiredLabel={i18n.t('captcha.expired')}
          errorLabel={i18n.t('captcha.error')}
          aria-label={i18n.t('captcha.aria')}
        />
        <div class="captcha-demo__notes">
          <span>{i18n.t('captcha.currentStatus', { status: i18n.t(`common.status.${status.value}`) })}</span>
          <span>{i18n.t('captcha.challengeId', { id: challenge.value?.id ?? '-' })}</span>
        </div>
      </div>
    </KitPage>
  )
}
