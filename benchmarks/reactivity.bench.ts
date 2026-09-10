// 响应式内核基准：信号读写、effect 调度、memo、批处理
// 运行：pnpm bench benchmarks/reactivity.bench.ts
//
// 注意：所有 signal/effect/memo 的创建都在 bench 外完成，
// bench 函数体只包含被测量的热路径本身。
// vitest 5：bench 不再是顶层导出，而是 test 上下文的 fixture。

import { describe, test } from 'vitest'
import { state, effect, memo, batch } from '@vobs/reactivity'

// vitest 5 的 module runner 把模块导出包装为 getter；热循环内直接调用
// 模块导入会反复穿透 getter 拖慢基准（benchmarking#module-runner-overhead），
// 因此热路径先取本地引用。
const _state = state
const _memo = memo
const _batch = batch

describe('reactivity: 读取路径', () => {
  const plain = state(0)

  test('signal 读取 ×10000（未追踪）', async ({ bench }) => {
    await bench('signal 读取 ×10000（未追踪）', () => {
      let sum = 0
      for (let i = 0; i < 10000; i++) sum += plain.value
      void sum
    }).run()
  })

  const memoHit = memo(() => 42)
  test('memo 读取 ×10000（命中缓存）', async ({ bench }) => {
    await bench('memo 读取 ×10000（命中缓存）', () => {
      let sum = 0
      for (let i = 0; i < 10000; i++) sum += memoHit.value
      void sum
    }).run()
  })
})

describe('reactivity: 写入与调度', () => {
  test('signal 写入 ×1000（无订阅者）', async ({ bench }) => {
    await bench('signal 写入 ×1000（无订阅者）', () => {
      const source = _state(0)
      for (let i = 0; i < 1000; i++) source.value = i
    }).run()
  })

  {
    const source = state(0)
    let runs = 0
    effect(() => { runs = source.value })
    let i = 0
    test('写入 → 1 个 effect 重跑（batch 同步 flush）', async ({ bench }) => {
      await bench('写入 → 1 个 effect 重跑（batch 同步 flush）', () => {
        _batch(() => { source.value = ++i })
        void runs
      }).run()
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
    test('batch 写 100 个信号 → 100 个脏 effect 一轮 flush', async ({ bench }) => {
      await bench('batch 写 100 个信号 → 100 个脏 effect 一轮 flush', () => {
        _batch(() => {
          source.value = ++i
          for (const s of siblings) s.value = i
        })
      }).run()
    })
  }
})

describe('reactivity: memo 链式失效', () => {
  {
    const base = state(0)
    const derived = _memo(() => base.value * 2)
    effect(() => { void derived.value })
    let i = 0
    test('signal → memo → effect 链式失效并重算（batch）', async ({ bench }) => {
      await bench('signal → memo → effect 链式失效并重算（batch）', () => {
        _batch(() => { base.value = ++i })
      }).run()
    })
  }
})
