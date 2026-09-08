# @vobs/captcha

State-driven captcha widgets for vobs: `Captcha` renders an externally supplied challenge and forwards answers to your submit handler, while `SliderCaptcha` is a slider puzzle that submits drag trail and device signals for server-side verification.

## Install

```bash
npm install @vobs/captcha
```

## Quick start

```ts
import { state } from '@vobs/reactivity'
import { createElement, createText, createVobs, insertBefore } from '@vobs/vobs'
import { Captcha } from '@vobs/captcha'
import type { CaptchaChallenge, CaptchaStatus } from '@vobs/captcha'

const status = state<CaptchaStatus>('ready')
const challenge = state<CaptchaChallenge<{ prompt: string }> | null>({
  id: 'challenge-1',
  payload: { prompt: 'Answer this' },
  expiresAt: Date.now() + 60_000
})

const app = createVobs({
  render: () => Captcha({
    challenge,
    status,
    onSubmit: (answer, current) => verifyOnServer(current.id, answer),
    renderChallenge({ challenge: current, submit }) {
      const button = createElement('button')
      insertBefore(button, createText(current.payload!.prompt), null)
      button.addEventListener('click', () => submit('answer'))
      return button
    }
  })
})

app.mount(document.getElementById('app')!)
```

Props accept plain values, signals, or getters. The component never fetches anything itself: statuses (`idle`, `loading`, `ready`, `verifying`, `verified`, `expired`, `error`) render built-in messages, retry/cancel actions appear based on status, and `submit` does nothing when no `onSubmit` is present or the status is `loading`/`verifying`. `onSubmit` returns the caller's promise unchanged, so the owner decides when to move to `verified`, `expired`, or `error`.

## API

| Signature | Description |
| --- | --- |
| `Captcha<Challenge>(props?: CaptchaProps<Challenge>)` | Challenge host. `renderChallenge(context)` draws the challenge and receives `submit(answer)`. Options: `keepChallengeOnError`/`keepChallengeOnLoading`/`keepChallengeOnVerifying`, `messagePlacement` (`'challenge' \| 'footer' \| 'none'`), custom `retryLabel`/`cancelLabel`/`expiredLabel`/..., `retryIcon`, `showRetry`/`showCancel`. |
| `SliderCaptcha(props?: SliderCaptchaProps)` | Puzzle slider with target notch, optional `decoys`, and a draggable handle or piece. On drop it calls `onSubmit(result, challenge)` with `{ x, trail, deviceSignals }`. Keeps the piece position and shows an overlay error on failure, disables dragging and refresh while loading, shows a check on the handle after `verified`, and dismisses the component `successDuration` ms (default 1000) later via `onSuccessDismiss`. |
| `analyzeSliderTrail(trail)` | Behavior features of a drag trail: `pointCount`, `duration`, `distance`, `directionChanges`, `verticalTravel`, `looksHuman`. |
| `collectCaptchaDeviceSignals()` | Basic device signals (including a `sessionId`) attached to slider submissions; disable with `collectDeviceSignals: false`. |

## Types

CaptchaStatus, CaptchaAnswer, CaptchaValue, CaptchaChallenge, CaptchaSubmitContext, CaptchaChallengeRenderer, CaptchaProps, SliderShape, SliderTrailPoint, SliderTrailAnalysis, CaptchaDeviceSignals, SliderCaptchaResult, SliderCaptchaProps, SliderCaptchaValue, SliderCaptchaChallenge, SliderCaptchaPayload, SliderCaptchaDecoy
