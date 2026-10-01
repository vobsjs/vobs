/**
 * 端到端基准：真实 DOM 更新循环，jsdom + 真实渲染器。
 *
 * **每轮必须显式 scheduler.flush()**：vobs 的更新是微任务批处理的，同步循环里写信号
 * 只做了「入队 + notify」，真正的 flush 要等循环结束。第一版没注意这点，测出「200 行调和
 * 只要 0.02µs」这种荒谬数字 —— 测的是入队不是更新。方法论完整说明见 bench/README.mjs。
 *
 * 数字要与 jsdom-control.mjs 对照着看：jsdom 的 DOM 操作比真实浏览器慢一个数量级，
 * 不剥离就会把 jsdom 的慢算到框架头上。
 *
 * 每个用例重复 7 轮报**最小值**与中位数；被测 step 里不做额外分配；挂载一次只测更新。
 *
 * 用法：node scripts/bench/e2e.mjs
 */
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true })
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.HTMLElement = dom.window.HTMLElement
globalThis.Element = dom.window.Element
globalThis.Node = dom.window.Node
globalThis.Text = dom.window.Text
globalThis.Comment = dom.window.Comment

const {
  createVobs, createDOMRenderer, createElement, createText,
  insertBefore, insertList, bindText, bindAttribute, state
} = await import('../../packages/vobs/dist/index.js')
const { scheduler } = await import('../../packages/reactivity/dist/index.js')

const REPEATS = 7

function runCase(label, setup, iterations) {
  const samples = []
  for (let round = 0; round < REPEATS; round++) {
    const { app, step } = setup()
    for (let i = 0; i < Math.max(3, Math.floor(iterations / 10)); i++) { step(i); scheduler.flush() }   // 预热
    const start = process.hrtime.bigint()
    for (let i = 0; i < iterations; i++) { step(i); scheduler.flush() }
    samples.push(Number(process.hrtime.bigint() - start) / iterations)
    app.destroy()
  }
  samples.sort((a, b) => a - b)
  const min = samples[0]
  const median = samples[Math.floor(samples.length / 2)]
  const spread = (samples[samples.length - 1] / min)
  console.log(
    `  ${label.padEnd(44)} 最小 ${(min / 1000).toFixed(2).padStart(8)} µs   中位 ${(median / 1000).toFixed(2).padStart(8)} µs   抖动 ${spread.toFixed(1)}×`
  )
  return min
}

const mount = render => {
  const host = document.createElement('div')
  const app = createVobs({ renderer: createDOMRenderer(), render })
  app.mount(host)
  return { app, host }
}

console.log(`\n=== 端到端更新（每用例 ${REPEATS} 轮取最小/中位）===`)

// 文本：100 个绑定共享一个信号
{
  const s = state(0)
  runCase('文本：100 绑定共享 1 个信号', () => {
    const { app } = mount(() => {
      const root = createElement('div')
      for (let i = 0; i < 100; i++) {
        const p = createElement('p')
        const text = createText('')
        insertBefore(p, text, null)
        bindText(text, () => s.value)
        insertBefore(root, p, null)
      }
      return root
    })
    return { app, step: i => { s.value = i } }
  }, 2000)
}

// 文本：100 个独立信号，只改一个
{
  const signals = Array.from({ length: 100 }, () => state(0))
  let cursor = 0
  runCase('文本：100 个独立信号，只改 1 个', () => {
    const { app } = mount(() => {
      const root = createElement('div')
      for (const s of signals) {
        const p = createElement('p')
        const text = createText('')
        insertBefore(p, text, null)
        bindText(text, () => s.value)
        insertBefore(root, p, null)
      }
      return root
    })
    return { app, step: () => { signals[cursor++ % signals.length].value++ } }
  }, 2000)
}

// 属性：100 个 class 绑定
{
  const cls = state('a')
  runCase('属性：100 个 class 绑定', () => {
    const { app } = mount(() => {
      const root = createElement('div')
      for (let i = 0; i < 100; i++) {
        const p = createElement('p')
        bindAttribute(p, 'class', () => cls.value)
        insertBefore(root, p, null)
      }
      return root
    })
    return { app, step: i => { cls.value = `c${i}` } }
  }, 2000)
}

const ROWS = 200

// 列表：两数组交替（身份变、内容不变）—— 纯调和开销，且 step 零分配
{
  const a = Array.from({ length: ROWS }, (_, i) => ({ id: i, label: `r${i}` }))
  const b = Array.from({ length: ROWS }, (_, i) => ({ id: i, label: `r${i}` }))
  const items = state(a)
  let toggle = false
  runCase(`列表：${ROWS} 行，身份变内容不变（零分配）`, () => {
    const { app } = mount(() => {
      const ul = createElement('ul')
      insertList(ul, null, () => items.value,
        item => {
          const li = createElement('li')
          const text = createText('')
          insertBefore(li, text, null)
          bindText(text, () => item.label)
          return li
        },
        item => item.id)
      return ul
    })
    return { app, step: () => { toggle = !toggle; items.value = toggle ? b : a } }
  }, 500)
}

// 列表：同一个数组引用反复赋值（应被 Object.is 拦掉，测信号判等短路）
{
  const a = Array.from({ length: ROWS }, (_, i) => ({ id: i, label: `r${i}` }))
  const items = state(a)
  runCase(`列表：同引用反复赋值（应被判等拦掉）`, () => {
    const { app } = mount(() => {
      const ul = createElement('ul')
      insertList(ul, null, () => items.value,
        item => {
          const li = createElement('li')
          const text = createText('')
          insertBefore(li, text, null)
          bindText(text, () => item.label)
          return li
        },
        item => item.id)
      return ul
    })
    return { app, step: () => { items.value = a } }
  }, 500)
}

// 列表：只改一行内容（预建好的数组，step 零分配）
{
  const a = Array.from({ length: ROWS }, (_, i) => ({ id: i, label: `r${i}` }))
  const variants = [0, 1].map(v => a.map((item, i) => (i === 100 ? { id: item.id, label: `v${v}` } : item)))
  const items = state(a)
  let toggle = false
  runCase(`列表：${ROWS} 行只改 1 行内容`, () => {
    const { app } = mount(() => {
      const ul = createElement('ul')
      insertList(ul, null, () => items.value,
        item => {
          const li = createElement('li')
          const text = createText('')
          insertBefore(li, text, null)
          bindText(text, () => item.label)
          return li
        },
        item => item.id)
      return ul
    })
    return { app, step: () => { toggle = !toggle; items.value = toggle ? variants[1] : variants[0] } }
  }, 500)
}

// 列表：只有一项的列表（隔离固定开销）
{
  const one = [{ id: 1, label: 'a' }]
  const oneB = [{ id: 1, label: 'a' }]
  const items = state(one)
  let toggle = false
  runCase('列表：1 行，身份变内容不变（固定开销）', () => {
    const { app } = mount(() => {
      const ul = createElement('ul')
      insertList(ul, null, () => items.value,
        item => {
          const li = createElement('li')
          const text = createText('')
          insertBefore(li, text, null)
          bindText(text, () => item.label)
          return li
        },
        item => item.id)
      return ul
    })
    return { app, step: () => { toggle = !toggle; items.value = toggle ? oneB : one } }
  }, 2000)
}

// 列表：空数组交替（隔离"每行"以外的固定成本）
{
  const emptyA = []
  const emptyB = []
  const items = state(emptyA)
  let toggle = false
  runCase('列表：0 行，身份变（纯固定开销）', () => {
    const { app } = mount(() => {
      const ul = createElement('ul')
      insertList(ul, null, () => items.value,
        item => {
          const li = createElement('li')
          insertBefore(li, createText('x'), null)
          return li
        },
        item => item.id)
      return ul
    })
    return { app, step: () => { toggle = !toggle; items.value = toggle ? emptyB : emptyA } }
  }, 2000)
}

console.log('')
