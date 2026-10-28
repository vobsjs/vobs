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

## SliderCaptcha contract (the easily-misread parts)

These prop names do **not** match what they actually do; this bit us in practice (see pitfall stats item Q in `docs/dev/`). Use them by their actual semantics:

### `payload` is **puzzle geometry**, not slider data

The `SliderCaptchaChallenge.payload` delivered by the server:

```ts
{
  image?: string          // background image (see below)
  width, height           // puzzle area size (px)
  targetX, targetY        // gap position (px, relative to the puzzle area's top-left corner)
  pieceWidth, pieceHeight // puzzle piece size
  startX?, tolerance?, shape?, decoys?, decoyX/Y/Rotation?
}
```

"Dragged correctly" is judged by the difference between `targetX` and the landing point, with `tolerance` as slack. **The handle copy is not part of the payload**.

### `dragLabel` is the **handle's accessible name** (`aria-label`), not the drag hint

The default is the literal `'>'`. The visual hint is the hardcoded "Drag the slider to complete the puzzle"; `dragLabel` only affects what screen readers announce. **The default is a poor accessible name** — pass a real word explicitly when you need accessibility support (e.g. `dragLabel="Slide to verify"`).

The other `*Label` props are likewise **UI copy** (`retryLabel` / `cancelLabel` / `loadingLabel` / `emptyLabel` / `expiredLabel` / `errorLabel` / `label`).

### `payload.image` must be a **value CSS `url()` accepts**

It is written into `background-image: url(…)` — so it must be a **dataURL or path**, **never a node**. The example uses an SVG dataURL; a bitmap dataURL works too.

### The submission is more than the landing point: `trail` and `analysis` are part of the protocol

`SliderCaptchaResult` = `{ x, y, trail, duration, analysis, deviceSignals? }`.

**The server can use the trail for bot detection** (constant-speed straight line = machine). So:

- do not send only `x`/`y` and drop the rest
- do **not** artificially insert/smooth points during dragging — that destroys the analysis basis
- `deviceSignals` is only omitted when `collectDeviceSignals: false`

## API

| Signature | Description |
| --- | --- |
| `Captcha<Challenge>(props?: CaptchaProps<Challenge>)` | Challenge host. `renderChallenge(context)` draws the challenge and receives `submit(answer)`. Options: `keepChallengeOnError`/`keepChallengeOnLoading`/`keepChallengeOnVerifying`, `messagePlacement` (`'challenge' \| 'footer' \| 'none'`), custom `retryLabel`/`cancelLabel`/`expiredLabel`/..., `retryIcon`, `showRetry`/`showCancel`. |
| `SliderCaptcha(props?: SliderCaptchaProps)` | Puzzle slider with target notch, optional `decoys`, and a draggable handle or piece. On drop it calls `onSubmit(result, challenge)` with `{ x, y, trail, duration, analysis, deviceSignals? }`. Keeps the piece position and shows an overlay error on failure, disables dragging and refresh while loading, shows a check on the handle after `verified`, and dismisses the component `successDuration` ms (default 1000) later via `onSuccessDismiss`. |
| `analyzeSliderTrail(trail)` | Behavior features of a drag trail: `pointCount`, `duration`, `distance`, `directionChanges`, `verticalTravel`, `looksHuman`. |
| `collectCaptchaDeviceSignals()` | Basic device signals (including a `sessionId`) attached to slider submissions; disable with `collectDeviceSignals: false`. |

## Types

CaptchaStatus, CaptchaAnswer, CaptchaValue, CaptchaChallenge, CaptchaSubmitContext, CaptchaChallengeRenderer, CaptchaProps, SliderShape, SliderTrailPoint, SliderTrailAnalysis, CaptchaDeviceSignals, SliderCaptchaResult, SliderCaptchaProps, SliderCaptchaValue, SliderCaptchaChallenge, SliderCaptchaPayload, SliderCaptchaDecoy
