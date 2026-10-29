/**
 * End-to-end benchmark: real DOM update loop, jsdom + the real renderer.
 *
 * **Every round must call scheduler.flush() explicitly**: vobs updates are batched in
 * microtasks, so writing a signal inside a synchronous loop only "enqueues + notifies";
 * the actual flush waits until the loop ends. The first version missed this and produced
 * an absurd "200-row reconciliation in 0.02µs" — it measured enqueueing, not updating.
 * See bench/README.mjs for the full methodology.
 *
 * Read the numbers alongside jsdom-control.mjs: jsdom DOM operations are an order of
 * magnitude slower than a real browser, and without stripping that out jsdom's slowness
 * gets blamed on the framework.
 *
 * Each case runs 7 rounds and reports the **minimum** and median; no extra allocations
 * inside the measured step; mount once and measure updates only.
 *
 * Usage: node scripts/bench/e2e.mjs
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
    for (let i = 0; i < Math.max(3, Math.floor(iterations / 10)); i++) { step(i); scheduler.flush() }   // warmup
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
    `  ${label.padEnd(44)} min ${(min / 1000).toFixed(2).padStart(8)} µs   median ${(median / 1000).toFixed(2).padStart(8)} µs   spread ${spread.toFixed(1)}×`
  )
  return min
}

const mount = render => {
  const host = document.createElement('div')
  const app = createVobs({ renderer: createDOMRenderer(), render })
  app.mount(host)
  return { app, host }
}

console.log(`\n=== End-to-end updates (${REPEATS} rounds per case, min/median) ===`)

// Text: 100 bindings sharing one signal
{
  const s = state(0)
  runCase('Text: 100 bindings sharing 1 signal', () => {
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

// Text: 100 independent signals, updating one
{
  const signals = Array.from({ length: 100 }, () => state(0))
  let cursor = 0
  runCase('Text: 100 independent signals, updating 1', () => {
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

// Attribute: 100 class bindings
{
  const cls = state('a')
  runCase('Attribute: 100 class bindings', () => {
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

// List: alternate two arrays (keys change, content unchanged) — pure reconciliation cost, zero-allocation step
{
  const a = Array.from({ length: ROWS }, (_, i) => ({ id: i, label: `r${i}` }))
  const b = Array.from({ length: ROWS }, (_, i) => ({ id: i, label: `r${i}` }))
  const items = state(a)
  let toggle = false
  runCase(`List: ${ROWS} rows, keys change content unchanged (zero allocation)`, () => {
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

// List: assign the same array reference repeatedly (should be short-circuited by Object.is; measures the signal equality shortcut)
{
  const a = Array.from({ length: ROWS }, (_, i) => ({ id: i, label: `r${i}` }))
  const items = state(a)
  runCase(`List: same reference reassigned (should be blocked by the equality check)`, () => {
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

// List: change one row's content (prebuilt arrays, zero-allocation step)
{
  const a = Array.from({ length: ROWS }, (_, i) => ({ id: i, label: `r${i}` }))
  const variants = [0, 1].map(v => a.map((item, i) => (i === 100 ? { id: item.id, label: `v${v}` } : item)))
  const items = state(a)
  let toggle = false
  runCase(`List: ${ROWS} rows, changing 1 row's content`, () => {
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

// List: single-item list (isolate the fixed overhead)
{
  const one = [{ id: 1, label: 'a' }]
  const oneB = [{ id: 1, label: 'a' }]
  const items = state(one)
  let toggle = false
  runCase('List: 1 row, keys change content unchanged (fixed overhead)', () => {
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

// List: alternate empty arrays (isolate the fixed cost beyond "per row")
{
  const emptyA = []
  const emptyB = []
  const items = state(emptyA)
  let toggle = false
  runCase('List: 0 rows, keys change (pure fixed overhead)', () => {
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
