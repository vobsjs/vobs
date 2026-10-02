// @vitest-environment jsdom
/*
 * runtime 核心不变量检查。
 *
 *   I2 Owner 作用域 —— 节点/子树离开文档树后，它建立的 effect 必须停止运行；
 *                      结构块被替换时，被丢弃那轮的 effect 必须整体释放
 *   I4 通道语义     —— attribute 与 property 两条通道的语义必须与声明一致
 *   I3 节点身份     —— 无关更新不得重建节点
 *
 * 判据一律用**可观察行为**（effect 还跑不跑、DOM 变没变），不读内部字段。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { createOwner, effect, state, type Owner } from '@vobs/reactivity'
import { createDOMRenderer } from '@vobs/dom'
import { setRenderer } from '@vobs/vobs'
import {
  bindAttribute,
  bindProperty,
  bindText,
  clear,
  createElement,
  createText,
  insertBefore,
  insertDynamic,
  insertDynamicValue,
  insertList,
  removeAttribute,
  setAttribute,
  setStaticProps
} from './index'

setRenderer(createDOMRenderer())

const flush = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await Promise.resolve()
}

let liveOwners: Owner[] = []
const makeOwner = (): Owner => { const o = createOwner(); liveOwners.push(o); return o }
afterEach(() => {
  for (const o of liveOwners) { try { o.dispose() } catch { /* 已销毁 */ } }
  liveOwners = []
})

describe('I2 · 结构 effect 与内层 effect 的订阅边界', () => {
  /*
   * ⚠️ 记录一条**被证伪的假设**，避免以后有人重新"发现"它：
   *
   * 曾经怀疑 `insertDynamic` 的 `next === current` 早退会留下孤儿 block Owner
   * （审计报告也这么写过）。实测证伪：工厂里 `effect(…)` 的调用是**同步执行**的，
   * 此刻 current subscriber 已经是那个内层 effect 本身，所以工厂体内读到的信号
   * **只被内层 effect 订阅**，外层结构 effect 根本不订阅它
   * → 信号变化时外层不重跑 → 也就不会新建 block。
   * 调试钩子确认：一次求值只产生一条 `dependencyTracked(内层 effect)`，
   * 写入后只有内层被 invalidated。
   *
   * 这是 run-once 模型的正确行为，不是缺陷。下面用行为把它钉住。
   */
  it('结构 effect 不得订阅"只被内层 effect 读取"的信号', async () => {
    const owner = makeOwner()
    const parent = document.createElement('div')
    const stable = createElement('span')
    const inner = state(0)
    let factoryCalls = 0
    let innerRuns = 0

    owner.run(() => {
      insertDynamic(parent, null, () => {
        factoryCalls += 1
        effect(() => { inner.value; innerRuns += 1 })
        return stable
      })
    })
    await flush()
    expect(factoryCalls).toBe(1)
    expect(innerRuns).toBe(1)

    for (let i = 1; i <= 3; i++) { inner.value = i; await flush() }

    // 内层每轮都跑；结构 effect 一次都不该重跑（否则白白重建结构块）
    expect(innerRuns).toBe(4)
    expect(factoryCalls).toBe(1)
  })

  it('工厂**自己**读的信号必须让结构 effect 重跑（对照组）', async () => {
    const owner = makeOwner()
    const parent = document.createElement('div')
    const which = state('a')
    let factoryCalls = 0

    owner.run(() => {
      insertDynamic(parent, null, () => {
        factoryCalls += 1
        return createElement(which.value === 'a' ? 'span' : 'b')
      })
    })
    await flush()
    expect(factoryCalls).toBe(1)
    which.value = 'b'
    await flush()
    expect(factoryCalls).toBe(2)
  })

  it('insertDynamicValue 替换时，被丢弃那轮建立的 effect 必须停止', async () => {
    const owner = makeOwner()
    const parent = document.createElement('div')
    const which = state(1)
    const noise = state(0)
    const runsByRound = [0, 0]

    owner.run(() => {
      insertDynamicValue(parent, null, () => {
        const round = which.value - 1
        effect(() => { noise.value; runsByRound[round] += 1 })
        return createElement('span')
      })
    })
    await flush()
    expect(runsByRound).toEqual([1, 0])

    which.value = 2          // 换成第 2 轮 → 第 1 轮的 block 必须被 dispose
    await flush()
    expect(runsByRound[1]).toBe(1)

    // 关键判据：第 1 轮的 effect 不得再被唤醒（否则就是幽灵订阅）
    const round1Before = runsByRound[0]
    noise.value = 1
    await flush()
    expect(runsByRound[0]).toBe(round1Before)
    expect(runsByRound[1]).toBe(2)
  })
})

describe('I2 · 卸载必须停止该子树建立的 effect', () => {
  it('owner.dispose() 后，子树里的 effect 不得再运行', async () => {
    const owner = makeOwner()
    const parent = document.createElement('div')
    const value = state(0)
    let runs = 0
    owner.run(() => {
      const el = createElement('div')
      insertBefore(parent, el, null)
      const text = createText('')
      bindText(text, () => { value.value; runs += 1; return 'x' })
      insertBefore(el, text, null)
    })
    await flush()
    value.value = 1
    await flush()
    const before = runs
    owner.dispose()
    value.value = 2
    await flush()
    expect(runs).toBe(before)
  })

  it('clear() 不得抛错，且清空容器', () => {
    const owner = makeOwner()
    const parent = document.createElement('div')
    owner.run(() => {
      insertBefore(parent, createElement('section'), null)
    })
    expect(parent.children.length).toBe(1)
    expect(() => clear(parent)).not.toThrow()
    expect(parent.children.length).toBe(0)
  })
})

describe('I4 · attribute 与 property 两条通道的语义', () => {
  it('attribute 的 false 不设置属性', () => {
    const el = createElement('div')
    setStaticProps(el, { title: false, draggable: false })
    expect(el.hasAttribute('title')).toBe(false)
    expect(el.hasAttribute('draggable')).toBe(false)
  })

  it('property 的 false 清除 property（disabled/checked）', () => {
    const input = createElement('input') as HTMLInputElement
    setStaticProps(input, { disabled: true, checked: true })
    expect(input.disabled).toBe(true)
    expect(input.checked).toBe(true)
    setStaticProps(input, { disabled: false, checked: false })
    expect(input.disabled).toBe(false)
    expect(input.checked).toBe(false)
  })

  it('绑定 attribute 为 null/undefined 时不写入字面量 "undefined"', async () => {
    const owner = makeOwner()
    const el = createElement('input')
    const value = state<string | undefined>(undefined)
    owner.run(() => { bindAttribute(el, 'placeholder', () => value.value) })
    await flush()
    expect(el.hasAttribute('placeholder')).toBe(false)
    value.value = 'hi'
    await flush()
    expect(el.getAttribute('placeholder')).toBe('hi')
  })

  it('removeAttribute 真的摘掉属性', () => {
    const el = createElement('div')
    setAttribute(el, 'title', 'x')
    expect(el.hasAttribute('title')).toBe(true)
    removeAttribute(el, 'title')
    expect(el.hasAttribute('title')).toBe(false)
  })
})

describe('I3 · 节点身份：无关更新不得重建节点', () => {
  it('bindProperty 只改值，不换节点', async () => {
    const owner = makeOwner()
    const input = createElement('input') as HTMLInputElement
    const value = state('a')
    owner.run(() => { bindProperty(input, 'value', () => value.value) })
    await flush()
    const identity = input
    value.value = 'b'
    await flush()
    expect(input).toBe(identity)
    expect(input.value).toBe('b')
  })

  it('insertList 追加时不得重建已有行（keyed）', async () => {
    const owner = makeOwner()
    const parent = document.createElement('div')
    const rows = state([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
    owner.run(() => {
      insertList(
        parent,
        null,
        () => rows.value,
        (item: { id: string }) => {
          const el = createElement('div')
          setAttribute(el, 'data-id', item.id)
          return el
        },
        (item: { id: string }) => item.id
      )
    })
    await flush()
    const before = [...parent.children]
    expect(before).toHaveLength(3)

    rows.value = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]
    await flush()
    const after = [...parent.children]
    expect(after).toHaveLength(4)
    // 前三行身份必须保持（只有新增行是新的）
    expect(after[0]).toBe(before[0])
    expect(after[1]).toBe(before[1])
    expect(after[2]).toBe(before[2])
  })
})
