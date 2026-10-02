import { describe, expect, it } from 'vitest'
import {
  bindText,
  createComponent,
  createDOMRenderer,
  createText,
  createVobs,
  setRenderer,
  type VobsNode
} from '@vobs/vobs'
import { I18nBoundary, createI18n, i18nPlugin, useI18n, type I18nContext } from './index'

setRenderer(createDOMRenderer())

/**
 * `I18nBoundary` 原来是**死快照**（§12.2 #4）：父上下文的 messages/locale 在创建边界那一刻被取值拷走，
 * 之后父级 `setMessages`/`loadLocale` 边界里永远看不到；自定义 formatter 与 localeLoaders
 * **完全没有继承** —— 前者让 `{name, shout}` 这类占位符静默退化成 `String(value)`。
 */
const Inner = (props: { keyName: string; name?: string }): VobsNode => {
  const i18n = useI18n()
  const text = createText('')
  bindText(text, () => i18n.t(props.keyName, props.name === undefined ? undefined : { name: props.name }))
  return text
}

function mountBoundary(i18n: I18nContext, locale: string, innerProps: { keyName: string; name?: string }) {
  const container = document.createElement('main')
  let seen: I18nContext | undefined
  const Probe = (): VobsNode => { seen = useI18n(); return createComponent(Inner, innerProps) }
  const app = createVobs({
    render: () => createComponent(I18nBoundary, {
      locale,
      children: () => createComponent(Probe, {})
    }),
    plugins: [i18nPlugin({ i18n })]
  })
  app.mount(container)
  return { container, app, inner: () => seen! }
}

describe('@vobs/i18n I18nBoundary', () => {
  it('继承父上下文的自定义 formatter（不再静默退化成 String(value)）', () => {
    const i18n = createI18n({ defaultLocale: 'en-US', messages: { 'en-US': { hello: 'Hello {name, shout}' } } })
    i18n.registerFormatter('shout', value => String(value).toUpperCase())

    const view = mountBoundary(i18n, 'en-US', { keyName: 'hello', name: 'ada' })
    expect(view.container.textContent).toBe('Hello ADA')
    view.app.destroy()
    i18n.dispose()
  })

  it('父上下文之后追加的翻译在边界里可见（不再是死快照）', () => {
    const i18n = createI18n({ defaultLocale: 'en-US', messages: { 'en-US': { before: 'BEFORE' } } })
    const view = mountBoundary(i18n, 'en-US', { keyName: 'after' })
    expect(view.container.textContent).toBe('after')      // 缺 key 时返回 key 本身

    i18n.setMessages('en-US', { after: 'AFTER' })
    view.app.update()
    expect(view.container.textContent).toBe('AFTER')

    view.app.destroy()
    i18n.dispose()
  })

  it('继承父上下文的 localeLoaders', async () => {
    const i18n = createI18n({
      defaultLocale: 'en-US',
      messages: { 'en-US': { hi: 'Hi' } },
      localeLoaders: { 'de-DE': async () => ({ hi: 'Hallo' }) }
    })
    const view = mountBoundary(i18n, 'de-DE', { keyName: 'hi' })
    await expect(view.inner().loadLocale('de-DE')).resolves.toBeUndefined()
    await view.inner().loadLocale('de-DE')
    view.app.update()
    expect(view.container.textContent).toBe('Hallo')

    view.app.destroy()
    i18n.dispose()
  })
})
