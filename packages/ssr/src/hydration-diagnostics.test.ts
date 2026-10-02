// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createElement, createText, insertBefore } from '@vobs/dom'
import { hydrate, renderToString } from './index'

/*
 * 水合失败的诊断里 `kind: 'content'` 原来**不可达**：actual 取自 `container.querySelectorAll('*')`
 * （只含元素），而判据是 `actual?.nodeType === 3`。于是"期望某个文本、DOM 里却是别的文本"这种
 * 最典型的水合差异只会报 `missing-node` + `actual=<none>`，排查时看不到真实内容。
 */
describe('水合诊断：期望文本时的 content 分支', () => {
  const render = (value: string) => () => {
    const heading = createElement('h1')
    insertBefore(heading, createText(value), null)
    return heading
  }

  it('DOM 是别的文本时报 content 并带上真实文本', () => {
    document.body.innerHTML = renderToString(render('Bob'))
    let error: { vobsHydration?: { kind?: string; actual?: string } } | undefined
    try {
      hydrate(render('Ada'), document.body)
    } catch (reason) {
      error = reason as typeof error
    }

    expect(error?.vobsHydration?.kind).toBe('content')
    expect(error?.vobsHydration?.actual).toContain('Bob')
    document.body.innerHTML = ''
  })

  it('结构确实是缺节点时仍报 missing-node（没有把诊断改成永远 content）', () => {
    document.body.innerHTML = renderToString(() => createElement('h1'))
    let error: { vobsHydration?: { kind?: string; actual?: string } } | undefined
    try {
      hydrate(() => createElement('p'), document.body)
    } catch (reason) {
      error = reason as typeof error
    }

    expect(error?.vobsHydration?.kind).toBe('missing-node')
    expect(error?.vobsHydration?.actual).toContain('h1')
    document.body.innerHTML = ''
  })
})
