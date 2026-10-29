// Runtime DOM benchmark: list reconciliation, dynamic branches, text bindings
// Run: pnpm bench benchmarks/runtime.bench.ts (jsdom environment)

// @vitest-environment jsdom
import { describe, test } from 'vitest'
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

// vitest 5's module runner wraps module exports in getters; calling module imports
// directly inside hot loops repeatedly goes through the getter and skews benchmarks
// (benchmarking#module-runner-overhead), so hot paths take local references first.
const _state = state
const _batch = batch
const _createText = createText
const _insertList = insertList
const _insertDynamic = insertDynamic
const _bindText = bindText

interface Row { id: number; name: string; score: number }

function makeRows(count: number, tag = ''): Row[] {
  return Array.from({ length: count }, (_, i) => ({ id: i, name: `row-${tag}${i}`, score: i }))
}

/** List row: div.row > span > text node (name updated via fine-grained bindText), close to compiled output shape. */
function renderRow(item: { name: string }): Node {
  const el = document.createElement('div')
  el.className = 'row'
  const span = document.createElement('span')
  const text = _createText('')
  span.appendChild(text)
  el.appendChild(span)
  _bindText(text, () => item.name)
  return el
}

const MOUNT_OPTIONS = { iterations: 20, time: 20000 } as const

describe('runtime: list mount', () => {
  test('mount 1000 rows (keyed)', async ({ bench }) => {
    await bench('mount 1000 rows (keyed)', () => {
      const container = document.createElement('div')
      const source = _state(makeRows(1000))
      _insertList(container, null, () => source.value, renderRow, row => row.id)
      container.replaceChildren()
    }).run(MOUNT_OPTIONS)
  })

  test('mount 1000 rows (no key)', async ({ bench }) => {
    await bench('mount 1000 rows (no key)', () => {
      const container = document.createElement('div')
      const source = _state(makeRows(1000))
      _insertList(container, null, () => source.value, renderRow)
      container.replaceChildren()
    }).run(MOUNT_OPTIONS)
  })
})

describe('runtime: keyed list updates (1000 rows)', () => {
  const container = document.createElement('div')
  const source = state(makeRows(1000), 'source')
  insertList(container, null, () => source.value, renderRow, row => row.id)

  const reversed = [...source.value].reverse()
  let toggle = false

  test('full reverse', async ({ bench }) => {
    await bench('full reverse (worst case: everything moves)', () => {
      toggle = !toggle
      _batch(() => { source.value = toggle ? reversed : [...reversed].reverse() })
    }).run()
  })

  const list = source.value
  const swapped = [...list]
  ;[swapped[0], swapped[swapped.length - 1]] = [swapped[swapped.length - 1], swapped[0]]
  let swapToggle = false

  test('swap first/last two rows', async ({ bench }) => {
    await bench('swap first/last two rows (best case: only 2 moves)', () => {
      swapToggle = !swapToggle
      _batch(() => { source.value = swapToggle ? swapped : [...list] })
    }).run()
  })

  let patchRound = 0
  test('patch 100/1000 rows', async ({ bench }) => {
    await bench('patch 100/1000 row contents', () => {
      patchRound++
      const next = source.value.map((row, index) =>
        index % 10 === 0 ? { ...row, name: `patch-${patchRound}-${index}` } : row
      )
      _batch(() => { source.value = next })
    }).run()
  })
})

describe('runtime: dynamic and text bindings', () => {
  test('dynamic branch switch ×1000', async ({ bench }) => {
    await bench('dynamic branch switch ×1000 (between two elements)', () => {
      const parent = document.createElement('div')
      const condition = _state(true)
      _insertDynamic(parent, null, () =>
        condition.value ? createLeaf('A') : createLeaf('B')
      )
      let i = 0
      _batch(() => { condition.value = (++i % 2 === 0) })
    }).run()
  })

  test('text update ×1000 (bindText)', async ({ bench }) => {
    await bench('text update ×1000 (bindText)', () => {
      const node = document.createTextNode('')
      const source = _state('t0')
      _bindText(node, () => source.value)
      let i = 0
      _batch(() => { source.value = `t${++i}` })
    }).run()
  })
})

function createLeaf(label: string): Node {
  const el = document.createElement('span')
  el.textContent = label
  return el
}
