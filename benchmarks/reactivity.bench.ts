// 响应式内核基准：信号读写、effect 调度、memo、批处理
// 运行：pnpm bench benchmarks/reactivity.bench.ts
//
// 注意：所有 signal/effect/memo 的创建都在 bench 外完成，
// bench 函数体只包含被测量的热路径本身。

import { bench, describe } from 'vitest'
import { state, effect, memo, batch } from '@vobs/reactivity'

describe('reactivity: 读取路径', () => {
  const plain = state(0)

  bench('signal 读取 ×10000（未追踪）', () => {
    let sum = 0
    for (let i = 0; i < 10000; i++) sum += plain.value
    void sum
  })

  const memoHit = memo(() => 42)
  bench('memo 读取 ×10000（命中缓存）', () => {
    let sum = 0
    for (let i = 0; i < 10000; i++) sum += memoHit.value
    void sum
  })
})

describe('reactivity: 写入与调度', () => {
  bench('signal 写入 ×1000（无订阅者）', () => {
    const source = state(0)
    for (let i = 0; i < 1000; i++) source.value = i
  })

  {
    const source = state(0)
    let runs = 0
    effect(() => { runs = source.value })
    let i = 0
    bench('写入 → 1 个 effect 重跑（batch 同步 flush）', () => {
      batch(() => { source.value = ++i })
      void runs
    })
  }

  {
    const source = state(0)
    const siblings = Array.from({ length: 99 }, () => {
      const s = state(0)
      effect(() => { void (s.value + source.value) })
      return s
    })
    let i = 0
    bench('batch 写 100 个信号 → 100 个脏 effect 一轮 flush', () => {
      batch(() => {
        source.value = ++i
        for (const s of siblings) s.value = i
      })
    })
  }
})

describe('reactivity: memo 链式失效', () => {
  {
    const base = state(0)
    const derived = memo(() => base.value * 2)
    effect(() => { void derived.value })
    let i = 0
    bench('signal → memo → effect 链式失效并重算（batch）', () => {
      batch(() => { base.value = ++i })
    })
  }
})
