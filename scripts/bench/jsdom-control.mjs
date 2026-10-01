/**
 * 对照：同样的 DOM 操作，绕过 vobs 直接用 jsdom 做一遍要多久。
 * 用来把「vobs 的开销」和「jsdom 本来就慢」分开。
 */
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true })
globalThis.document = dom.window.document

const REPEATS = 7
const run = (label, fn, iterations) => {
  const samples = []
  for (let r = 0; r < REPEATS; r++) {
    for (let i = 0; i < Math.floor(iterations / 10); i++) fn(i)
    const start = process.hrtime.bigint()
    for (let i = 0; i < iterations; i++) fn(i)
    samples.push(Number(process.hrtime.bigint() - start) / iterations)
  }
  samples.sort((a, b) => a - b)
  console.log(`  ${label.padEnd(46)} 最小 ${(samples[0] / 1000).toFixed(2).padStart(8)} µs`)
  return samples[0]
}

console.log('\n=== 纯 jsdom 对照 ===')

// 100 个文本节点改写（vobs 的文本更新最终就是这一步）
{
  const texts = []
  for (let i = 0; i < 100; i++) {
    const p = document.createElement('p')
    const t = document.createTextNode('')
    p.appendChild(t)
    texts.push(t)
  }
  run('100 个文本节点改写（nodeValue）', i => {
    const v = String(i)
    for (const t of texts) t.nodeValue = v
  }, 2000)
}

// 100 个 setAttribute
{
  const els = []
  for (let i = 0; i < 100; i++) els.push(document.createElement('p'))
  run('100 个 setAttribute(class)', i => {
    for (const el of els) el.setAttribute('class', `c${i}`)
  }, 2000)
}

// 200 行：整体重建（新建 200 个 li + 文本）
{
  run('200 行：新建 200 个 li + 文本并替换', () => {
    const ul = document.createElement('ul')
    for (let i = 0; i < 200; i++) {
      const li = document.createElement('li')
      li.appendChild(document.createTextNode(`r${i}`))
      ul.appendChild(li)
    }
  }, 300)
}

// 200 行：只改其中 1 个文本节点
{
  const texts = []
  for (let i = 0; i < 200; i++) {
    const li = document.createElement('li')
    const t = document.createTextNode(`r${i}`)
    li.appendChild(t)
    texts.push(t)
  }
  run('200 行：只改其中 1 个文本节点', i => { texts[100].nodeValue = `v${i}` }, 300)
}

// 200 行：把 200 行全部移到末尾（模拟 LIS 之后的最小移动）
{
  const ul = document.createElement('ul')
  for (let i = 0; i < 200; i++) ul.appendChild(document.createElement('li'))
  run('200 行：把全部节点重排一遍（appendChild）', () => {
    for (const li of Array.from(ul.childNodes)) ul.appendChild(li)
  }, 300)
}

// 200 行的 Map 构建 + LIS（纯 JS，不碰 DOM）—— 对照 vobs 的调和开销
{
  const items = Array.from({ length: 200 }, (_, i) => ({ id: i }))
  run('200 项：建 Map + 逐项查表（纯 JS）', () => {
    const map = new Map()
    for (const item of items) map.set(item.id, item)
    let n = 0
    for (const item of items) if (map.get(item.id)) n++
  }, 300)
}
console.log('')
