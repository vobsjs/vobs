// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createOwner } from '@vobs/reactivity'
import { createDOMRenderer, setRenderer } from '@vobs/vobs'
import { addEventListener, bindSpreadProps, createElement, removeEventListener, setStaticProps } from './index'

setRenderer(createDOMRenderer())

const flush = async () => { await Promise.resolve(); await Promise.resolve() }

/*
 * `Owner.cleanups` 是**只 push 的数组**（reactivity/src/owner.ts:57,84）。
 * 事件重绑此前在**每次** `addEventListener` 里无条件 `owner.onDispose(...)`，
 * 于是换一次 handler 就多一条永不执行的清理项，旧 handler 闭包被一并扣住。
 *
 * 实测（.artifacts/reports/runtime.supplement.md 缺点 4 与既有报告缺点 1，两轮独立复现）：
 * 500 次替换 → `cleanups.length === 500`；一轮 `{...props}` 换 onClick → 202。
 * 组件 effect 每次重跑都会重绑事件，所以这是热路径上的**无界增长**
 * （长寿命页面里等价于内存泄漏）。
 *
 * 判据用 `owner.mark()` 前后的 cleanups 计数差 —— `mark()` 是 Owner 公开接口，
 * 不依赖 `cleanups` 是私有字段。
 */
describe('事件重绑不会让 Owner.cleanups 无界增长', () => {
  it('同一 (node,event) 换 200 次 handler，清理槽只涨 1', () => {
    const owner = createOwner()
    const el = createElement('button')
    owner.run(() => {
      const before = owner.mark().cleanups
      for (let index = 0; index < 200; index += 1) {
        addEventListener(el, 'click', () => { void index })
      }
      const after = owner.mark().cleanups
      // 修复前这里是 200
      expect(after - before).toBe(1)
    })
  })

  it('不同事件名各占一个槽（不是共用）', () => {
    const owner = createOwner()
    const el = createElement('button')
    owner.run(() => {
      const before = owner.mark().cleanups
      addEventListener(el, 'click', () => {})
      addEventListener(el, 'keydown', () => {})
      addEventListener(el, 'focus', () => {})
      expect(owner.mark().cleanups - before).toBe(3)
    })
  })

  it('同一事件名在不同节点上各占一个槽', () => {
    const owner = createOwner()
    const a = createElement('button')
    const b = createElement('button')
    owner.run(() => {
      const before = owner.mark().cleanups
      addEventListener(a, 'click', () => {})
      addEventListener(b, 'click', () => {})
      // 同一事件名但节点不同：必须各占一槽（用 per-node 数字 id 拼 key 就是为了这个）
      expect(owner.mark().cleanups - before).toBe(2)
    })
  })

  it('{...props} 反复重绑 onClick 200 轮，清理槽不随重绑增长', async () => {
    const owner = createOwner()
    let handler = (): void => {}
    await owner.run(async () => {
      const el = createElement('button')
      const before = owner.mark().cleanups
      bindSpreadProps(el, () => ({ onClick: handler }))
      // 建立一次之后的基线：含绑定自己的 effect 清理 + 事件槽各 1
      const baseline = owner.mark().cleanups

      for (let index = 0; index < 200; index += 1) {
        handler = () => { void index }
        await flush()
      }

      const after = owner.mark().cleanups
      // 判据是"重绑 200 轮**没有增长**"（而不是某个绝对数）：
      // 修复前每轮各 +1 → 这里会是 202 级别的差；现在必须为 0。
      expect(after - baseline).toBe(0)
      // 且建立阶段只多了一小段固定开销（effect 清理 + 事件槽），不是 200
      expect(baseline - before).toBeLessThanOrEqual(3)
    })
  })

  it('Owner 销毁时仍能摘掉**最新**那个监听（槽没被换绑弄失效）', () => {
    const owner = createOwner()
    const el = createElement('button')
    const hits: string[] = []
    owner.run(() => {
      addEventListener(el, 'click', () => hits.push('old'))
      addEventListener(el, 'click', () => hits.push('new'))
    })
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(hits).toEqual(['new'])

    owner.dispose()
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    // 销毁后必须彻底解绑 —— 槽里存的要是最新 handle，不能指向已摘掉的旧 handle
    expect(hits).toEqual(['new'])
  })

  it('removeEventListener 之后再重新挂，仍然只占一个槽', () => {
    const owner = createOwner()
    const el = createElement('button')
    owner.run(() => {
      const before = owner.mark().cleanups
      const first = (): void => {}
      addEventListener(el, 'click', first)
      removeEventListener(el, 'click', first)
      addEventListener(el, 'click', () => {})
      // 摘掉再挂：槽被覆盖，不再新增
      expect(owner.mark().cleanups - before).toBe(1)
    })
  })

  it('setStaticProps 的事件不占清理槽（静态事件不走 addEventListener）', () => {
    const owner = createOwner()
    const el = createElement('button')
    owner.run(() => {
      const before = owner.mark().cleanups
      setStaticProps(el, { onClick: () => {} })
      expect(owner.mark().cleanups - before).toBe(0)
    })
  })
})
