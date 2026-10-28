// @vitest-environment jsdom
/*
 * An `I18nBoundary` without a `locale` prop must **follow the parent's** locale.
 *
 * `defaultLocale: props.locale ?? parent.locale.value` used to be read **only once, at creation** —
 * after the parent called `setLocale('zh-CN')`, the copy in the boundary subtree stayed in the old
 * language (in contrast to `messages`, which already had a sync effect). And a boundary without a
 * `locale` prop is precisely the "I want to inherit from the parent" usage.
 *
 * The reverse must be locked too: after an **explicit** `setLocale` inside the boundary it must
 * **stop following** — that's its explicit decision and must not be overwritten by the parent at
 * any time.
 */
import { describe, expect, it } from 'vitest'
import { scheduler } from '@vobs/reactivity'
import { bindText, createComponent, createText, createVobs } from '@vobs/vobs'
import type { VobsNode } from '@vobs/vobs'
import { createI18n, I18nBoundary, i18nPlugin, useI18n, type I18nContext } from './index'

// effect/signal writes are scheduled asynchronously: flush before asserting, otherwise you see the previous frame
const settle = (): void => { scheduler.flush() }

const Inner = (): VobsNode => {
  const i18n = useI18n()
  const text = createText('')
  bindText(text, () => i18n.t('greeting'))
  return text
}

/** No `locale` prop: the boundary should inherit and follow the parent. */
function mountInheriting(i18n: I18nContext) {
  const container = document.createElement('main')
  let seen: I18nContext | undefined
  const Probe = (): VobsNode => { seen = useI18n(); return createComponent(Inner, {}) }
  const app = createVobs({
    render: () => createComponent(I18nBoundary, { children: () => createComponent(Probe, {}) }),
    plugins: [i18nPlugin({ i18n })]
  })
  app.mount(container)
  return { container, app, local: () => seen! }
}

function makeI18n(): I18nContext {
  return createI18n({
    defaultLocale: 'en-US',
    messages: { 'en-US': { greeting: 'Hello' }, 'zh-CN': { greeting: '你好' } }
  })
}

describe('I18nBoundary follows the parent when no locale is passed', () => {
  it('after the parent setLocale, the copy in the boundary subtree follows', () => {
    const i18n = makeI18n()
    const view = mountInheriting(i18n)
    expect(view.container.textContent).toBe('Hello')

    i18n.setLocale('zh-CN')

    settle()
    expect(view.container.textContent, 'the boundary did not follow the parent locale switch').toBe('你好')

    i18n.setLocale('en-US')

    settle()
    expect(view.container.textContent).toBe('Hello')

    view.app.destroy()
    i18n.dispose()
  })

  it('when created without a locale, the initial locale comes from the current parent value', () => {
    const i18n = makeI18n()
    i18n.setLocale('zh-CN')            // Switch first, then mount
    const view = mountInheriting(i18n)
    expect(view.container.textContent).toBe('你好')

    view.app.destroy()
    i18n.dispose()
  })

  it('after an explicit setLocale inside the boundary, it stops following the parent', () => {
    const i18n = makeI18n()
    const view = mountInheriting(i18n)
    expect(view.container.textContent).toBe('Hello')

    view.local().setLocale('zh-CN')     // The boundary's explicit decision

    settle()
    expect(view.container.textContent).toBe('你好')

    i18n.setLocale('en-US')             // The parent switches again: it must not override the boundary's choice
    settle()
    /*
     * Assert both the **mechanism** and the display: asserting only the text would miss the case
     * "the local locale was dirtied but nothing re-rendered" (exactly what happened during mutation
     * verification: the text was unchanged, but local.locale had already been written to en-US by
     * the parent).
     */
    expect(view.local().locale.value, 'the parent dirtied the boundary locale signal').toBe('zh-CN')
    expect(view.container.textContent, 'the parent overrode the explicit boundary choice').toBe('你好')

    view.app.destroy()
    i18n.dispose()
  })

  it('a boundary with an explicit locale does not follow the parent (local-override semantics unchanged)', () => {
    const i18n = makeI18n()
    const container = document.createElement('main')
    const app = createVobs({
      render: () => createComponent(I18nBoundary, {
        locale: 'zh-CN',
        children: () => createComponent(Inner, {})
      }),
      plugins: [i18nPlugin({ i18n })]
    })
    app.mount(container)
    expect(container.textContent).toBe('你好')

    i18n.setLocale('en-US')

    settle()
    expect(container.textContent).toBe('你好')

    app.destroy()
    i18n.dispose()
  })

  it('a parent setLocale does not kill the boundary (no 100-round loop)', () => {
    const i18n = makeI18n()
    const view = mountInheriting(i18n)
    expect(() => {
      for (const locale of ['zh-CN', 'en-US', 'zh-CN', 'en-US']) i18n.setLocale(locale)
    }).not.toThrow()
    expect(view.container.textContent).toBe('Hello')
    view.app.destroy()
    i18n.dispose()
  })
})
