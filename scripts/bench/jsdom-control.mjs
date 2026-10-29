/**
 * Control: how long the same DOM operations take in plain jsdom, bypassing vobs.
 * Used to separate "vobs overhead" from "jsdom is just slow".
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
  console.log(`  ${label.padEnd(46)} min ${(samples[0] / 1000).toFixed(2).padStart(8)} µs`)
  return samples[0]
}

console.log('\n=== Plain jsdom control ===')

// 100 text node rewrites (ultimately what a vobs text update boils down to)
{
  const texts = []
  for (let i = 0; i < 100; i++) {
    const p = document.createElement('p')
    const t = document.createTextNode('')
    p.appendChild(t)
    texts.push(t)
  }
  run('100 text node rewrites (nodeValue)', i => {
    const v = String(i)
    for (const t of texts) t.nodeValue = v
  }, 2000)
}

// 100 setAttribute calls
{
  const els = []
  for (let i = 0; i < 100; i++) els.push(document.createElement('p'))
  run('100 setAttribute(class) calls', i => {
    for (const el of els) el.setAttribute('class', `c${i}`)
  }, 2000)
}

// 200 rows: full rebuild (create 200 li + text nodes)
{
  run('200 rows: build 200 li + text and replace', () => {
    const ul = document.createElement('ul')
    for (let i = 0; i < 200; i++) {
      const li = document.createElement('li')
      li.appendChild(document.createTextNode(`r${i}`))
      ul.appendChild(li)
    }
  }, 300)
}

// 200 rows: change only 1 text node
{
  const texts = []
  for (let i = 0; i < 200; i++) {
    const li = document.createElement('li')
    const t = document.createTextNode(`r${i}`)
    li.appendChild(t)
    texts.push(t)
  }
  run('200 rows: change only 1 text node', i => { texts[100].nodeValue = `v${i}` }, 300)
}

// 200 rows: move all 200 rows to the end (simulates the minimal moves after LIS)
{
  const ul = document.createElement('ul')
  for (let i = 0; i < 200; i++) ul.appendChild(document.createElement('li'))
  run('200 rows: reorder every node (appendChild)', () => {
    for (const li of Array.from(ul.childNodes)) ul.appendChild(li)
  }, 300)
}

// Map building + lookups for 200 rows (pure JS, no DOM) — the counterpart of vobs reconciliation overhead
{
  const items = Array.from({ length: 200 }, (_, i) => ({ id: i }))
  run('200 items: build Map + per-item lookup (pure JS)', () => {
    const map = new Map()
    for (const item of items) map.set(item.id, item)
    let n = 0
    for (const item of items) if (map.get(item.id)) n++
  }, 300)
}
console.log('')
