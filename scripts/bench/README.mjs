/**
 * Framework benchmarks.
 *
 *   node scripts/bench/reactivity.mjs    Primitives only: signal read/write, effect reruns, Owner lifecycle
 *   node scripts/bench/e2e.mjs           End-to-end: real DOM update loop (jsdom + the real renderer)
 *   node scripts/bench/jsdom-control.mjs Control: the same DOM operations run without vobs
 *
 * ## Two methodology rules, both learned the hard way
 *
 * 1. **End-to-end must flush explicitly.** vobs updates are batched in microtasks:
 *    writing a signal inside a synchronous loop only "enqueues + notifies"; the actual
 *    flush waits until the loop ends. The first benchmark missed this and produced an
 *    absurd "200-row reconciliation in 0.02µs" — it measured enqueueing, not updating.
 *    Every round now calls `scheduler.flush()` explicitly to advance synchronously.
 *
 * 2. **Strip out jsdom's own cost.** jsdom DOM operations are an order of magnitude
 *    slower than a real browser; without stripping that out, jsdom's slowness gets
 *    blamed on the framework (of a 3.3ms mount, jsdom itself accounts for 1.1ms).
 *    So every e2e number must be read against the matching jsdom-control operation.
 *
 * 3. Each case runs multiple rounds and reports the **minimum** and median: noise only
 *    ever adds time, so the minimum is closest to the truth.
 *
 * ## Current baseline (run it yourself before changing anything; do not trust these numbers)
 *
 *   Signal write (zero subscribers)   6.3 ns        Owner create+dispose   194 ns
 *   Signal read                       6.4 ns        memo read              4.0 ns
 *
 *   End-to-end (min)                       Plain jsdom control    vobs own overhead
 *   100 bindings sharing 1 signal     62.7 µs      17.1 µs              45.6 µs (456 ns/op)
 *   100 class bindings                91.3 µs      34.5 µs              56.7 µs (567 ns/op)
 *   200 rows, changing 1              34.0 µs       0.2 µs              33.8 µs (170 ns/row)
 *
 * Two known targets (both backed by numbers):
 *   A. 456~567 ns per effect rerun — deep reading points at every round unsubscribing
 *      **all** deps and re-collecting them
 *      (cleanupDependencies + re-collect in `packages/reactivity/src/effect.ts`)
 *   B. Each list row costs 170 ns even when "nothing needs doing" — bookkeeping
 *      (Map/Set/seq/LIS + per-row checks); a hand-written Map + lookup over 200 rows
 *      takes only 4.9 µs
 */
console.log(`Run: node scripts/bench/reactivity.mjs / e2e.mjs / jsdom-control.mjs
See the methodology notes at the top of this file.`)
