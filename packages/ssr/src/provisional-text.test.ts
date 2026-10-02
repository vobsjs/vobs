// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { bindText, createElement, createText, insertBefore } from '@vobs/dom'
import { setRuntimeDebugHooks, type RuntimeProvisionalText } from '@vobs/runtime'
import { hydrate, renderToString } from './index'

/*
 * 水合时 `createText('')` 的兜底分支会认领**任意未认领文本**（服务端渲染了真实文本、
 * 客户端此刻要空文本：只能先认领、等绑定 effect 覆写）。这一步过去完全无声 ——
 * 服务端 "Ada" 遇上客户端忘传 state（会渲染 "loading"）就静默变成后者，既不报错也没线索。
 * 现在给出可观测出口 `hydrationProvisionalText`。
 */
describe('水合临时认领文本有可观测出口', () => {
  function render() {
    const span = createElement('span')
    const text = createText('')
    insertBefore(span, text, null)
    bindText(text, () => 'count: 42')
    return span
  }

  it('服务端非空文本 + 客户端空初值：触发一次 hydrationProvisionalText', () => {
    const events: RuntimeProvisionalText[] = []
    setRuntimeDebugHooks({ hydrationProvisionalText: event => events.push(event) })
    try {
      document.body.innerHTML = renderToString(render)
      const app = hydrate(render, document.body)

      expect(events).toHaveLength(1)
      expect(events[0]).toEqual({ expected: '动态文本节点', actual: '"count: 42"' })
      // 值本身照旧被绑定 effect 覆写（行为没变）
      expect(document.body.textContent).toBe('count: 42')
      app.destroy()
    } finally {
      setRuntimeDebugHooks(null)
      document.body.innerHTML = ''
    }
  })

  it('服务端空文本（占位注释）不走临时认领，不产生事件', () => {
    const events: RuntimeProvisionalText[] = []
    const renderEmpty = () => {
      const span = createElement('span')
      insertBefore(span, createText(''), null)
      return span
    }
    setRuntimeDebugHooks({ hydrationProvisionalText: event => events.push(event) })
    try {
      document.body.innerHTML = renderToString(renderEmpty)
      const app = hydrate(renderEmpty, document.body)
      expect(events).toHaveLength(0)
      app.destroy()
    } finally {
      setRuntimeDebugHooks(null)
      document.body.innerHTML = ''
    }
  })
})
