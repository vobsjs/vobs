import { describe, expect, it } from 'vitest'
import { bindText, createElement, createText, insertBefore } from '@vobs/dom'
import { createResourceClient } from '@vobs/resource'
import { effect, state } from '@vobs/vobs'
import { renderToStringAsync } from './render'

/*
 * `renderToStringAsync` 原来在 `await prefetchAll()` 之后只 `app.update()` **一次**。
 * 数据到达只是第一跳：绑定 effect 里可能还有链式 promise（或本次写入又触发新的 effect），
 * 要再经过若干轮微任务才就绪 —— 单次 update 会让这些内容**静默缺失**，HTML 里留着旧值，
 * 既不报错也没有任何线索。这里把"冲刷到稳定"钉住。
 */
function createHarness() {
  const resources = createResourceClient()
  const profile = resources.resource({
    key: ['async-ssr-profile'],
    fetcher: async () => 'Ada'
  })
  const label = state('loading')
  /*
   * 数据到达后再排**一个宏任务**（模拟 effect 里的定时器/二次异步请求）。
   * 用微任务不够：`await prefetchAll()` 本身会让出微任务队列，链式 promise 往往在第一次
   * update 之前就完成了，那样"单次 update"也能渲染出来 —— 测试就不咬（我第一版就是这么写的）。
   */
  effect(() => {
    if (profile.data.value === null) return
    setTimeout(() => { label.value = `done:${profile.data.value}` }, 0)
  })

  const render = () => {
    const span = createElement('span')
    const text = createText('')
    insertBefore(span, text, null)
    bindText(text, () => label.value)
    return span
  }
  return { resources, render }
}

describe('renderToStringAsync 冲刷到稳定', () => {
  it('数据到达后再排一跳的异步写入也会进入最终 HTML', async () => {
    const { resources, render } = createHarness()
    const result = await renderToStringAsync(render, { resourceClient: resources })
    expect(result.html).toContain('done:Ada')
    resources.clear()
  })

  it('没有异步尾巴时也能收敛（不依赖定时器）', async () => {
    const resources = createResourceClient()
    const profile = resources.resource({ key: ['async-ssr-plain'], fetcher: async () => 'Ada' })
    const render = () => {
      const span = createElement('span')
      const text = createText('')
      insertBefore(span, text, null)
      bindText(text, () => profile.data.value ?? 'loading')
      return span
    }
    const result = await renderToStringAsync(render, { resourceClient: resources })
    expect(result.html).toContain('Ada')
    resources.clear()
  })
})
