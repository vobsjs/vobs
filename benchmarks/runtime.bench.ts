// 运行时 DOM 基准：列表调和、动态分支、文本绑定
// 运行：pnpm bench benchmarks/runtime.bench.ts（jsdom 环境）

// @vitest-environment jsdom
import { bench, describe } from 'vitest'
import { state, batch } from '@vobs/reactivity'
import {
  createDOMRenderer,
  setRenderer,
  createText,
  insertList,
  insertDynamic,
  bindText
} from '@vobs/vobs'

setRenderer(createDOMRenderer())

interface Row { id: number; name: string; score: number }

function makeRows(count: number, tag = ''): Row[] {
  return Array.from({ length: count }, (_, i) => ({ id: i, name: `row-${tag}${i}`, score: i }))
}

/** 列表行：div.row > span > 文本节点（名字走 bindText 细粒度更新），贴近编译产物形态。 */
function renderRow(item: { name: string }): Node {
  const el = document.createElement('div')
  el.className = 'row'
  const span = document.createElement('span')
  const text = createText('')
  span.appendChild(text)
  el.appendChild(span)
  bindText(text, () => item.name)
  return el
}

const MOUNT_OPTIONS = { iterations: 20, time: 20000 } as const

describe('runtime: 列表挂载', () => {
  bench('挂载 1000 行（keyed）', () => {
    const container = document.createElement('div')
    const source = state(makeRows(1000))
    insertList(container, null, () => source.value, renderRow, row => row.id)
    container.replaceChildren()
  }, MOUNT_OPTIONS)

  bench('挂载 1000 行（无 key）', () => {
    const container = document.createElement('div')
    const source = state(makeRows(1000))
    insertList(container, null, () => source.value, renderRow)
    container.replaceChildren()
  }, MOUNT_OPTIONS)
})

describe('runtime: keyed 列表更新（1000 行）', () => {
  const container = document.createElement('div')
  const source = state(makeRows(1000))
  insertList(container, null, () => source.value, renderRow, row => row.id)

  const reversed = [...source.value].reverse()
  let toggle = false

  bench('整体反转（最坏情况：全部移动）', () => {
    toggle = !toggle
    batch(() => { source.value = toggle ? reversed : [...reversed].reverse() })
  })

  const list = source.value
  const swapped = [...list]
  ;[swapped[0], swapped[swapped.length - 1]] = [swapped[swapped.length - 1], swapped[0]]
  let swapToggle = false

  bench('首尾交换两行（最好情况：仅 2 处移动）', () => {
    swapToggle = !swapToggle
    batch(() => { source.value = swapToggle ? swapped : [...list] })
  })

  let patchRound = 0
  bench('局部替换 100/1000 行内容', () => {
    patchRound++
    const next = source.value.map((row, index) =>
      index % 10 === 0 ? { ...row, name: `patch-${patchRound}-${index}` } : row
    )
    batch(() => { source.value = next })
  })
})

describe('runtime: 动态与文本绑定', () => {
  bench('动态分支切换 ×1000（两个元素间切换）', () => {
    const parent = document.createElement('div')
    const condition = state(true)
    insertDynamic(parent, null, () =>
      condition.value ? createLeaf('A') : createLeaf('B')
    )
    let i = 0
    batch(() => { condition.value = (++i % 2 === 0) })
  })

  bench('文本更新 ×1000（bindText）', () => {
    const node = document.createTextNode('')
    const source = state('t0')
    bindText(node, () => source.value)
    let i = 0
    batch(() => { source.value = `t${++i}` })
  })
})

function createLeaf(label: string): Node {
  const el = document.createElement('span')
  el.textContent = label
  return el
}
