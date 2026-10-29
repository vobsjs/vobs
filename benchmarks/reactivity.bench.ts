// Reactivity core benchmark: signal reads/writes, effect scheduling, memo, batching
// Run: pnpm bench benchmarks/reactivity.bench.ts
//
// Note: all signal/effect/memo creation happens outside the bench; the bench
// function body contains only the measured hot path itself.
// vitest 5: bench is no longer a top-level export; it is a test-context fixture.

import { describe, test } from 'vitest'
import { state, effect, memo, batch } from '@vobs/reactivity'

// vitest 5's module runner wraps module exports in getters; calling module imports
// directly inside hot loops repeatedly goes through the getter and skews benchmarks
// (benchmarking#module-runner-overhead), so hot paths take local references first.
const _state = state
const _memo = memo
const _batch = batch

describe('reactivity: read path', () => {
  const plain = state(0, 'plain')

  test('signal read ×10000 (untracked)', async ({ bench }) => {
    await bench('signal read ×10000 (untracked)', () => {
      let sum = 0
      for (let i = 0; i < 10000; i++) sum += plain.value
      void sum
    }).run()
  })

  const memoHit = memo(() => 42)
  test('memo read ×10000 (cache hit)', async ({ bench }) => {
    await bench('memo read ×10000 (cache hit)', () => {
      let sum = 0
      for (let i = 0; i < 10000; i++) sum += memoHit.value
      void sum
    }).run()
  })
})

describe('reactivity: writes and scheduling', () => {
  test('signal write ×1000 (no subscribers)', async ({ bench }) => {
    await bench('signal write ×1000 (no subscribers)', () => {
      const source = _state(0)
      for (let i = 0; i < 1000; i++) source.value = i
    }).run()
  })

  {
    const source = state(0, 'source')
    let runs = 0
    effect(() => { runs = source.value })
    let i = 0
    test('write → 1 effect re-run (batch synchronous flush)', async ({ bench }) => {
      await bench('write → 1 effect re-run (batch synchronous flush)', () => {
        _batch(() => { source.value = ++i })
        void runs
      }).run()
    })
  }

  {
    const source = state(0, 'source')
    const siblings = Array.from({ length: 99 }, () => {
      const s = state(0, 's')
      effect(() => { void (s.value + source.value) })
      return s
    })
    let i = 0
    test('batch-write 100 signals → 100 dirty effects, one flush', async ({ bench }) => {
      await bench('batch-write 100 signals → 100 dirty effects, one flush', () => {
        _batch(() => {
          source.value = ++i
          for (const s of siblings) s.value = i
        })
      }).run()
    })
  }
})

describe('reactivity: memo chained invalidation', () => {
  {
    const base = state(0, 'base')
    const derived = _memo(() => base.value * 2)
    effect(() => { void derived.value })
    let i = 0
    test('signal → memo → effect chained invalidation and recompute (batch)', async ({ bench }) => {
      await bench('signal → memo → effect chained invalidation and recompute (batch)', () => {
        _batch(() => { base.value = ++i })
      }).run()
    })
  }
})
