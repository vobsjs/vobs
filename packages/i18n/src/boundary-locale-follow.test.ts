// @vitest-environment jsdom
/*
 * 不传 `locale` 的 `I18nBoundary` 必须**跟随父级**语言。
 *
 * 原来 `defaultLocale: props.locale ?? parent.locale.value` 只在**创建那一刻读一次** ——
 * 之后父级 `setLocale('zh-CN')`，边界子树里的文案仍是旧语言（对比 `messages` 早就有同步 effect）。
 * 而不传 `locale` 的边界恰恰就是"我想继承父级"的那种用法。
 *
 * 反向也要锁住：边界内**显式** `setLocale` 之后必须**停止跟随** ——
 * 那是它的显式决定，不能被父级随时覆盖。
 */
import { describe, expect, it } from 'vitest'
import { scheduler } from '@vobs/reactivity'
import { bindText, createComponent, createText, createVobs } from '@vobs/vobs'
import type { VobsNode } from '@vobs/vobs'
import { createI18n, I18nBoundary, i18nPlugin, useI18n, type I18nContext } from './index'

// effect/信号写入是异步调度的：断言前必须 flush，否则看到的是上一帧
const settle = (): void => { scheduler.flush() }

const Inner = (): VobsNode => {
  const i18n = useI18n()
  const text = createText('')
  bindText(text, () => i18n.t('greeting'))
  return text
}

/** 不传 `locale`：边界应当继承并跟随父级。 */
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

describe('I18nBoundary 不传 locale 时跟随父级', () => {
  it('父级 setLocale 之后，边界子树里的文案跟着变', () => {
    const i18n = makeI18n()
    const view = mountInheriting(i18n)
    expect(view.container.textContent).toBe('Hello')

    i18n.setLocale('zh-CN')

    settle()
    expect(view.container.textContent, '父级切语言后边界没有跟随').toBe('你好')

    i18n.setLocale('en-US')

    settle()
    expect(view.container.textContent).toBe('Hello')

    view.app.destroy()
    i18n.dispose()
  })

  it('创建时不传 locale，初始语言取自父级当前值', () => {
    const i18n = makeI18n()
    i18n.setLocale('zh-CN')            // 先切，再挂载
    const view = mountInheriting(i18n)
    expect(view.container.textContent).toBe('你好')

    view.app.destroy()
    i18n.dispose()
  })

  it('边界内显式 setLocale 之后停止跟随父级', () => {
    const i18n = makeI18n()
    const view = mountInheriting(i18n)
    expect(view.container.textContent).toBe('Hello')

    view.local().setLocale('zh-CN')     // 边界的显式决定

    settle()
    expect(view.container.textContent).toBe('你好')

    i18n.setLocale('en-US')             // 父级再切：不该覆盖边界的选择
    settle()
    /*
     * 同时断言**机制**与展示：只断言文字会漏掉"本地 locale 被写脏、只是没人重渲染"这种情况
     * （突变验证时正是如此：文字没变，但 local.locale 已被父级写成 en-US）。
     */
    expect(view.local().locale.value, '父级把边界内的 locale 信号写脏了').toBe('zh-CN')
    expect(view.container.textContent, '父级覆盖了边界内的显式选择').toBe('你好')

    view.app.destroy()
    i18n.dispose()
  })

  it('传了 locale 的边界不跟随父级（本地覆盖语义不变）', () => {
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

  it('父级 setLocale 不会打死边界（不产生 100 轮循环）', () => {
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
