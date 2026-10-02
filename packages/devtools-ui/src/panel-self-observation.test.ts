// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createDevTools } from '@vobs/devtools'
import { hydrate, renderToString } from '@vobs/ssr'
import { bindText, createDOMRenderer, createElement, createText, createVobs, insertBefore, state } from '@vobs/vobs'
import { DevToolsPanel, DevToolsToolbar } from './panel'
import { DevToolsWidget } from './widget'

/*
 * 面板**观测自己**：它的 19 个局部 `state()` 与副作用都建在自己的 owner 下，
 * 而 devtools 判定"内部"的唯一依据是**祖先 owner 名字以 `DevTools` 开头**
 * （devtools/src/index.ts 的 isInternalOwnerId → debugComponentName(name).startsWith('DevTools')）。
 * 面板从来没给自己的 owner 命名 → 它那一份信号/副作用全被当成应用数据记录，再喂回自己的清单。
 * 实测（修复前）：`getSignals()` 有 20 条（只有 1 条是应用真正建的），空 devtools 上每来一次广播
 * 就 updates +1 / effects +1 / DOM +80，6 轮 93→521 节点，50 条更新时单次刷新 546ms。
 */
describe('DevToolsPanel 不自观测', () => {
  function mountPanel(devtools: ReturnType<typeof createDevTools>) {
    const host = document.createElement('div')
    const app = createVobs({
      renderer: createDOMRenderer(),
      render: () => DevToolsPanel({ api: devtools })
    })
    app.mount(host)
    return { host, app }
  }

  const settle = async (): Promise<void> => { await Promise.resolve(); await Promise.resolve() }

  it('挂载面板本身不往被观测数据里添任何东西', async () => {
    const devtools = createDevTools({ expose: false })
    // 预热：让 @vobs/ui 的模块级信号（图标注册表版本）等一次性副作用先发生，
    // 免得把它们算成"面板带来的"
    const warmup = mountPanel(devtools)
    await settle()
    warmup.app.destroy()
    await settle()

    const before = {
      signals: devtools.getSignals().length,
      effects: devtools.getEffects().length,
      updates: devtools.getUpdates().length
    }
    const view = mountPanel(devtools)
    await settle()

    expect(devtools.getSignals().length).toBe(before.signals)
    expect(devtools.getEffects().length).toBe(before.effects)
    expect(devtools.getUpdates().length).toBe(before.updates)

    // 外部信号照常被观测（没有把面板变成瞎子），而且只多这一条更新
    const external = state(0)
    external.value = 1
    await settle()
    expect(devtools.getUpdates().length).toBe(before.updates + 1)

    view.app.destroy()
    devtools.dispose()
  })

  it('单独挂载 DevToolsWidget 同样不往被观测数据里添东西', async () => {
    const devtools = createDevTools({ expose: false })
    const warmup = mountPanel(devtools)
    await settle()
    warmup.app.destroy()
    await settle()

    const before = {
      signals: devtools.getSignals().length,
      effects: devtools.getEffects().length
    }
    const host = document.createElement('div')
    const app = createVobs({
      renderer: createDOMRenderer(),
      render: () => DevToolsWidget({ api: devtools })
    })
    app.mount(host)
    await settle()

    expect(devtools.getSignals().length).toBe(before.signals)
    expect(devtools.getEffects().length).toBe(before.effects)

    app.destroy()
    devtools.dispose()
  })

  it('单独挂载 DevToolsToolbar 同样不往被观测数据里添东西', async () => {
    const devtools = createDevTools({ expose: false })
    const warmup = mountPanel(devtools)
    await settle()
    warmup.app.destroy()
    await settle()

    const before = {
      signals: devtools.getSignals().length,
      effects: devtools.getEffects().length
    }
    const host = document.createElement('div')
    const app = createVobs({
      renderer: createDOMRenderer(),
      render: () => DevToolsToolbar({ api: devtools, query: { value: '' } })
    })
    app.mount(host)
    await settle()

    expect(devtools.getSignals().length).toBe(before.signals)
    expect(devtools.getEffects().length).toBe(before.effects)

    app.destroy()
    devtools.dispose()
  })

  /*
   * devtools-ui 的"渲染 hydration-provisional-text"这一项**不需要改代码**：
   * `renderLifecycleTimeline`（panel.tsx:1207-1209）把 `event.type` 当**文本**直接渲染，
   * 既没有标签表也没有穷尽 switch。这条用例是防它以后被改成"按键名查表"而静默漏掉新类型。
   */
  it('生命周期里有 hydration-provisional-text 时面板照常渲染', async () => {
    const devtools = createDevTools({ expose: false })
    const view = mountPanel(devtools)
    await settle()

    const render = () => {
      const span = createElement('span')
      const text = createText('')
      insertBefore(span, text, null)
      bindText(text, () => 'count: 42')
      return span
    }
    document.body.innerHTML = renderToString(render)
    const app = hydrate(render, document.body)
    await settle()

    expect(devtools.getLifecycleEvents().some(event => event.type === 'hydration-provisional-text')).toBe(true)
    // 面板没被这个新类型搞崩（仍挂着内容）
    expect(view.host.childNodes.length).toBeGreaterThan(0)

    app.destroy()
    view.app.destroy()
    devtools.dispose()
    document.body.innerHTML = ''
  })

  /*
   * §18.67 留下的"未验证"：上一条只证明**事件被记录 + 面板没崩**，
   * 没有人断言过那个类型**真的出现在面板可见文本里**。这条补上。
   *
   * 驱动方式（都在 jsdom 里可用，不是 class 驱动的哑列表）：
   * - 分区：SectionNav 的每项是真实 `<button>`，带 `aria-label=<分区名>`
   *   （panel.tsx:414-423，click → activeSection.value = section）。
   * - 子标签：@vobs/ui 的 Tabs 每项是 `<button role="tab" data-tab-id=...>`
   *   （ui/src/tabs.ts:120-137，click → onChange → activeComponentsTab）。
   * 面板默认分区是 updates；Lifecycle 列表在 components → lifecycle 子标签下，所以要点两次。
   * 刷新走 scheduler 的微任务批处理（reactivity/src/scheduler.ts:28-36），`settle()` 足够。
   */
  it('切到 components → lifecycle 后，面板可见文本里真的出现该事件类型', async () => {
    const devtools = createDevTools({ expose: false })
    const view = mountPanel(devtools)
    await settle()

    const render = () => {
      const span = createElement('span')
      const text = createText('')
      insertBefore(span, text, null)
      bindText(text, () => 'count: 42')
      return span
    }
    document.body.innerHTML = renderToString(render)
    const app = hydrate(render, document.body)
    await settle()

    // 前提：devtools 里确实有这条 lifecycle 事件（否则下面的断言是空转）
    const recorded = devtools.getLifecycleEvents().filter(event => event.type === 'hydration-provisional-text')
    expect(recorded).toHaveLength(1)

    const visibleText = (): string => view.host.textContent ?? ''
    const click = (selector: string): void => {
      const target = view.host.querySelector<HTMLElement>(selector)
      if (!target) throw new Error(`面板里找不到可点击节点：${selector}`)
      target.click()
    }

    // 对照：默认分区是 updates，这个类型不该出现在可见文本里
    expect(visibleText()).not.toContain('hydration-provisional-text')

    click('button[aria-label="components"]')
    await settle()
    // components 分区默认落在 tree 子标签上，Lifecycle 列表这时还没渲染
    expect(view.host.querySelector('[data-tab-id="lifecycle"]')).not.toBeNull()
    expect(visibleText()).not.toContain('hydration-provisional-text')

    click('[data-tab-id="lifecycle"]')
    await settle()

    // 正题：renderLifecycleTimeline 把 event.type 当文本渲染，所以类型名必须可见
    expect(view.host.querySelector('.vobs-devtools-lifecycle-list')).not.toBeNull()
    expect(visibleText()).toContain('hydration-provisional-text')

    app.destroy()
    view.app.destroy()
    devtools.dispose()
    document.body.innerHTML = ''
  })
})
