// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createDevTools } from '@vobs/devtools'
import { createDOMRenderer, createVobs, state } from '@vobs/vobs'
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
})
