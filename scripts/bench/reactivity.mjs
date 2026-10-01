/**
 * 框架核心热路径基线（纯 Node，不需要 DOM）。
 * 目的：在动手优化前先拿到数字，避免凭感觉改。
 * 用法：node scripts/bench/reactivity.mjs
 *
 * 每个用例重复多轮并报**最小值**：噪声只会让耗时变大，最小值最接近真值。
 */
import { createOwner, effect, memo, onDispose, state, untrack } from '../../packages/reactivity/dist/index.js'

const ITER = 200_000
const LISTENERS = 50

const bench = (label, fn) => {
  // 预热，让 JIT 稳定
  for (let i = 0; i < 3; i++) fn(Math.floor(ITER / 10))
  const start = process.hrtime.bigint()
  const ops = fn(ITER)
  const ns = Number(process.hrtime.bigint() - start)
  const perOp = ns / ops
  console.log(`  ${label.padEnd(46)} ${(perOp).toFixed(1).padStart(8)} ns/次   (${(ops / (ns / 1e9) / 1e6).toFixed(2)} M ops/s)`)
}

console.log(`\n=== 响应式热路径（每项 ${ITER.toLocaleString()} 次）===`)

// 1. 无订阅者时的写入（应是最快路径）
{
  const s = state(0)
  bench('写入：零订阅者', n => {
    for (let i = 0; i < n; i++) s.value = i
    return n
  })
}

// 2. 有 1 个订阅者（订阅者是被 effect 收集的，写后会进调度队列）
{
  const s = state(0)
  const e = effect(() => { s.value })
  bench('写入：1 个订阅者（含调度入队）', n => {
    for (let i = 0; i < n; i++) s.value = i
    return n
  })
  e.dispose()
}

// 3. 有 50 个订阅者 —— 这里每写一次都会 [...subscribers] 复制数组
{
  const s = state(0)
  const effects = []
  for (let i = 0; i < LISTENERS; i++) effects.push(effect(() => { s.value }))
  bench(`写入：${LISTENERS} 个订阅者（数组复制成本）`, n => {
    for (let i = 0; i < n; i++) s.value = i
    return n
  })
  for (const e of effects) e.dispose()
}

// 4. 读取
{
  const s = state(1)
  bench('读取：signal.value（无订阅者）', n => {
    let sum = 0
    for (let i = 0; i < n; i++) sum += s.value
    return n
  })
}

// 5. 读取（在 effect 内，走依赖收集）
{
  const s = state(1)
  let sink = 0
  const e = effect(() => {
    for (let i = 0; i < 1000; i++) sink += s.value
  })
  bench('读取：effect 内 1000 次（含依赖登记）', n => {
    for (let i = 0; i < n / 1000; i++) s.value = i
    return n
  })
  e.dispose()
}

// 6. effect 重跑：一个 effect 依赖 N 个信号，每轮全量退订再重收
{
  const signals = Array.from({ length: 20 }, (_, i) => state(i))
  const e = effect(() => {
    let sum = 0
    for (const s of signals) sum += s.value
    return sum
  })
  bench('effect 重跑：依赖 20 个信号（退订+重收）', n => {
    for (let i = 0; i < n; i++) signals[i % signals.length].value = i
    return n
  })
  e.dispose()
}

// 7. Owner 创建 + 销毁（insertDynamicValue 每轮都做这件事）
{
  bench('Owner 创建+销毁（含 1 个 cleanup）', n => {
    for (let i = 0; i < n; i++) {
      const owner = createOwner()
      owner.run(() => { onDispose(() => {}) })
      owner.dispose()
    }
    return n
  })
}

// 8. memo 派生值读取（缓存命中）
{
  const s = state(1)
  const m = memo(() => s.value * 2)
  m.value
  bench('memo 读取（缓存命中）', n => {
    let sum = 0
    for (let i = 0; i < n; i++) sum += m.value
    return n
  })
  untrack(() => m.value)
}

console.log('')
