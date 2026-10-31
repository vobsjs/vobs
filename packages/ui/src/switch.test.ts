// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createDOMRenderer, createVobs, state } from '@vobs/vobs'
import { createComponent } from '@vobs/runtime'
import { scheduler } from '@vobs/reactivity'
import { Switch } from './index'

/*
 * Switch interactivity (2026-10-31).
 *
 * Measured defect: the real `<input>` was `display: none`, while `change` was the only event wired
 * to `onChange`. Users click the visual track (label / thumb); the hidden control never receives
 * that click, so `change` never fires — the switch rendered correctly, refused to move, and printed
 * nothing in the console. Two different callers were tried (getter+setter value object, and
 * `on` + `onChange`) and both stayed inert: the primitive itself was the problem.
 *
 * Two locks here:
 * - behaviour: a click on the control (which now covers the track) toggles the value and fires `onChange`;
 * - contract: the CSS rule must keep the input as the hit area (`position: absolute` + `opacity: 0`,
 *   never `display: none`). jsdom does not apply package CSS, so the behaviour test alone would also
 *   pass on the broken version — the CSS assertion is what actually pins the fix.
 */
const flush = (): void => { scheduler.flush(); scheduler.flush() }

type SwitchInput = NonNullable<Parameters<typeof Switch>[0]>

function mount(props: SwitchInput) {
  const host = document.createElement('div')
  // Must be attached to the document: jsdom runs an input's activation behaviour (checked toggle
  // + `change` dispatch) only for attached elements (measured — a detached element flips `checked`
  // but stays silent, which would make this test pass vacuously on a broken click path).
  document.body.appendChild(host)
  const app = createVobs({ renderer: createDOMRenderer(), render: () => createComponent(Switch, props) })
  app.mount(host)
  flush()
  return {
    host,
    cleanup: () => {
      app.destroy()
      host.remove()
    }
  }
}

describe('Switch is interactive', () => {
  it('clicking the hit area toggles bind and fires onChange', () => {
    const checked = state(false)
    const seen: boolean[] = []
    const { host, cleanup } = mount({
      bind: checked,
      onChange: (event: Event) => seen.push((event.target as HTMLInputElement).checked)
    })
    const input = host.querySelector('input[type=checkbox]') as HTMLInputElement
    input.click()
    flush()
    expect(checked.value).toBe(true)
    expect(seen).toEqual([true])

    input.click()
    flush()
    expect(checked.value).toBe(false)
    expect(seen).toEqual([true, false])
    cleanup()
  })

  it('controlled checked + onChange: a click reports the new state to the owner', () => {
    const seen: boolean[] = []
    const { host, cleanup } = mount({
      checked: false,
      onChange: (event: Event) => seen.push((event.target as HTMLInputElement).checked)
    })
    const input = host.querySelector('input[type=checkbox]') as HTMLInputElement
    input.click()
    flush()
    // The controlled contract here is "report, don't write": the owner decides what `checked`
    // becomes (it snaps back only when the owner re-renders with a different value).
    expect(seen).toEqual([true])
    cleanup()
  })

  it('clicking the label track reaches the control too', () => {
    const checked = state(false)
    const { host, cleanup } = mount({ bind: checked })
    const track = host.querySelector('.vui-switch') as HTMLLabelElement
    track.click()
    flush()
    expect(checked.value).toBe(true)
    cleanup()
  })

  it('disabled switches swallow clicks', () => {
    const seen: boolean[] = []
    const { host, cleanup } = mount({
      checked: false,
      disabled: true,
      onChange: (event: Event) => seen.push((event.target as HTMLInputElement).checked)
    })
    const input = host.querySelector('input[type=checkbox]') as HTMLInputElement
    input.click()
    flush()
    expect(seen).toEqual([])
    cleanup()
  })
})

describe('Switch CSS contract (hit area, not a hidden control)', () => {
  /*
   * Resolved via cwd, not `import.meta.url`: the `dom` pool runs in vmThreads, where
   * `import.meta.url` is not a `file:` URL and `readFileSync(new URL(...))` throws
   * "The URL must be of scheme file" (measured). Two candidates cover both entry points:
   * running inside the package (`pnpm --filter @vobs/ui test`) and from the repo root.
   */
  const cssFile = ['src/styles/components.css', 'packages/ui/src/styles/components.css']
    .map(rel => path.resolve(rel))
    .find(file => existsSync(file))
  const rule = cssFile === undefined ? '' : (readFileSync(cssFile, 'utf8').match(/\.vui-switch input\s*\{([^}]*)\}/)?.[1] ?? '')

  it('the rule exists and never hides the control', () => {
    expect(cssFile).toBeDefined()
    expect(rule).not.toBe('')
    expect(rule).not.toMatch(/display\s*:\s*none/)
  })

  it('the control covers the track as a transparent overlay', () => {
    expect(rule).toMatch(/position\s*:\s*absolute/)
    expect(rule).toMatch(/inset\s*:\s*0/)
    expect(rule).toMatch(/opacity\s*:\s*0/)
  })
})
