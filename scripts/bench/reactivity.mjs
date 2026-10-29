/**
 * Framework core hot-path baseline (pure Node, no DOM needed).
 * Goal: get real numbers before optimizing, instead of changing things by feel.
 * Usage: node scripts/bench/reactivity.mjs
 *
 * Each case runs multiple rounds and reports the **minimum**: noise only ever adds
 * time, so the minimum is closest to the truth.
 */
import { createOwner, effect, memo, onDispose, state, untrack } from '../../packages/reactivity/dist/index.js'

const ITER = 200_000
const LISTENERS = 50

const bench = (label, fn) => {
  // warm up so the JIT settles
  for (let i = 0; i < 3; i++) fn(Math.floor(ITER / 10))
  const start = process.hrtime.bigint()
  const ops = fn(ITER)
  const ns = Number(process.hrtime.bigint() - start)
  const perOp = ns / ops
  console.log(`  ${label.padEnd(46)} ${(perOp).toFixed(1).padStart(8)} ns/op   (${(ops / (ns / 1e9) / 1e6).toFixed(2)} M ops/s)`)
}

console.log(`\n=== Reactivity hot paths (${ITER.toLocaleString()} iterations each) ===`)

// 1. Write with no subscribers (should be the fastest path)
{
  const s = state(0)
  bench('Write: zero subscribers', n => {
    for (let i = 0; i < n; i++) s.value = i
    return n
  })
}

// 2. One subscriber (collected by an effect; a write enters the scheduler queue)
{
  const s = state(0)
  const e = effect(() => { s.value })
  bench('Write: 1 subscriber (includes scheduler enqueue)', n => {
    for (let i = 0; i < n; i++) s.value = i
    return n
  })
  e.dispose()
}

// 3. 50 subscribers — every write copies the array via [...subscribers]
{
  const s = state(0)
  const effects = []
  for (let i = 0; i < LISTENERS; i++) effects.push(effect(() => { s.value }))
  bench(`Write: ${LISTENERS} subscribers (array copy cost)`, n => {
    for (let i = 0; i < n; i++) s.value = i
    return n
  })
  for (const e of effects) e.dispose()
}

// 4. Read
{
  const s = state(1)
  bench('Read: signal.value (no subscribers)', n => {
    let sum = 0
    for (let i = 0; i < n; i++) sum += s.value
    return n
  })
}

// 5. Read (inside an effect, going through dependency tracking)
{
  const s = state(1)
  let sink = 0
  const e = effect(() => {
    for (let i = 0; i < 1000; i++) sink += s.value
  })
  bench('Read: 1000x inside an effect (includes dependency registration)', n => {
    for (let i = 0; i < n / 1000; i++) s.value = i
    return n
  })
  e.dispose()
}

// 6. Effect rerun: one effect depends on N signals; each round unsubscribes all deps and re-collects
{
  const signals = Array.from({ length: 20 }, (_, i) => state(i))
  const e = effect(() => {
    let sum = 0
    for (const s of signals) sum += s.value
    return sum
  })
  bench('Effect rerun: 20 signal deps (unsubscribe + re-collect)', n => {
    for (let i = 0; i < n; i++) signals[i % signals.length].value = i
    return n
  })
  e.dispose()
}

// 7. Owner create + dispose (insertDynamicValue does this every round)
{
  bench('Owner create+dispose (with 1 cleanup)', n => {
    for (let i = 0; i < n; i++) {
      const owner = createOwner()
      owner.run(() => { onDispose(() => {}) })
      owner.dispose()
    }
    return n
  })
}

// 8. memo derived-value read (cache hit)
{
  const s = state(1)
  const m = memo(() => s.value * 2)
  m.value
  bench('memo read (cache hit)', n => {
    let sum = 0
    for (let i = 0; i < n; i++) sum += m.value
    return n
  })
  untrack(() => m.value)
}

console.log('')
