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

## SliderCaptcha 契约（名字容易误解的几处）

这几个 prop 的名字与实际作用**不一致**，实战里踩过（详见 `docs/dev/` 的踩坑统计 Q 条）。
按实际语义使用：

### `payload` 是**拼图几何**，不是滑块数据

服务端下发的 `SliderCaptchaChallenge.payload`：

```ts
{
  image?: string          // 底图（见下）
  width, height           // 拼图区尺寸（px）
  targetX, targetY        // 缺口位置（px，相对拼图区左上角）
  pieceWidth, pieceHeight // 拼图块尺寸
  startX?, tolerance?, shape?, decoys?, decoyX/Y/Rotation?
}
```

判定"拖对了"比的是 `targetX` 与落点的差值，容差是 `tolerance`。**手柄文案不在 payload 里**。

### `dragLabel` 是**手柄的无障碍名字**（`aria-label`），不是拖动提示

默认值是字面量 `'>'`。视觉提示是硬编码的「向右拖动滑块完成拼图」，
`dragLabel` 只影响读屏器念什么。**默认值作为可读名字并不好** ——
需要无障碍支持时请显式给一个词（如 `dragLabel="拖动验证"`）。

其余 `*Label` 同理是**界面文案**（`retryLabel` / `cancelLabel` / `loadingLabel` /
`emptyLabel` / `expiredLabel` / `errorLabel` / `label`）。

### `payload.image` 必须是 **CSS `url()` 能吃的值**

它会被写进 `background-image: url(…)` —— 所以是 **dataURL 或路径**，
**不能是节点**。示例用 SVG dataURL；位图 dataURL 也可以。

### 提交内容不只是落点：`trail` 与 `analysis` 也在协议里

`SliderCaptchaResult` = `{ x, y, trail, duration, analysis, deviceSignals? }`。

**服务端可用轨迹做人机判定**（匀速直线 = 机器）。所以：

- 不要把 `x`/`y` 发上去就丢掉其余字段
- 拖动过程中**不要人为插点/平滑**，那会毁掉分析依据
- `collectDeviceSignals: false` 时 `deviceSignals` 才会缺省

## API

| Signature | Description |
| --- | --- |
| `Captcha<Challenge>(props?: CaptchaProps<Challenge>)` | Challenge host. `renderChallenge(context)` draws the challenge and receives `submit(answer)`. Options: `keepChallengeOnError`/`keepChallengeOnLoading`/`keepChallengeOnVerifying`, `messagePlacement` (`'challenge' \| 'footer' \| 'none'`), custom `retryLabel`/`cancelLabel`/`expiredLabel`/..., `retryIcon`, `showRetry`/`showCancel`. |
| `SliderCaptcha(props?: SliderCaptchaProps)` | Puzzle slider with target notch, optional `decoys`, and a draggable handle or piece. On drop it calls `onSubmit(result, challenge)` with `{ x, y, trail, duration, analysis, deviceSignals? }`. Keeps the piece position and shows an overlay error on failure, disables dragging and refresh while loading, shows a check on the handle after `verified`, and dismisses the component `successDuration` ms (default 1000) later via `onSuccessDismiss`. |
| `analyzeSliderTrail(trail)` | Behavior features of a drag trail: `pointCount`, `duration`, `distance`, `directionChanges`, `verticalTravel`, `looksHuman`. |
| `collectCaptchaDeviceSignals()` | Basic device signals (including a `sessionId`) attached to slider submissions; disable with `collectDeviceSignals: false`. |

## Types

CaptchaStatus, CaptchaAnswer, CaptchaValue, CaptchaChallenge, CaptchaSubmitContext, CaptchaChallengeRenderer, CaptchaProps, SliderShape, SliderTrailPoint, SliderTrailAnalysis, CaptchaDeviceSignals, SliderCaptchaResult, SliderCaptchaProps, SliderCaptchaValue, SliderCaptchaChallenge, SliderCaptchaPayload, SliderCaptchaDecoy
