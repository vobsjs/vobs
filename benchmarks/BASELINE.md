# Benchmark Baseline

- Date: running on **vitest 5** since 2026-09-10 (the bench DSL has moved to a test-context fixture).
- The "v4 baseline" column is data from the vitest 4 era (tinybench top-level `bench`), kept for historical reference only — vitest 5's module runner adds getters to module exports, systematically lowering absolute numbers on nanosecond-scale hot paths (especially reactivity reads/writes), so **columns across engines must not be compared directly**; relative comparisons within a single v5 run (the three template paths, before/after optimizations) remain valid.
- Run with `pnpm bench`; numbers from different machines must not be compared side by side — same-machine relative comparison only.

## reactivity

| Case | v4 baseline hz | v5 current hz | Change |
| --- | ---: | ---: | --- |
| signal read ×10000 (untracked) | 10,738 | 11,150 | flat |
| memo read ×10000 (cache hit) | 5,611 | 1,544 | getter overhead (measurement-scope loss, not a regression) |
| signal write ×1000 (no subscribers) | 10,196 | 7,383 | getter overhead (measurement-scope loss) |
| write → 1 effect re-run (batch synchronous flush) | 1,111,432 | 838,766 | getter overhead (measurement-scope loss) |
| batch-write 100 signals → 100 dirty effects, one flush | 12,884 | 9,592 | getter overhead (measurement-scope loss) |
| signal → memo → effect chained invalidation and recompute (batch) | 686,719 | 544,836 | getter overhead (measurement-scope loss) |

## runtime

| Case | v4 baseline hz | v5 current hz | Change |
| --- | ---: | ---: | --- |
| mount 1000 rows (keyed) | 39.91 | 41.23 | flat |
| mount 1000 rows (no key) | 40.79 | 44.75 | flat |
| keyed 1000 rows: full reverse (worst case) | 50.35 | 50.76 | flat |
| keyed 1000 rows: swap first/last two rows (best case) | 29.20 | 2,371.71 | **~75×** (LIS, retained) |
| keyed 1000 rows: patch 100/1000 rows | 28.90 | 1,760.05 | **~55×** (LIS, retained) |
| dynamic branch switch ×1000 (between two elements) | 23,440 | 39,074 | improved (under v5 sampling) |
| text update ×1000 (bindText) | 152,349 | 217,468 | improved (under v5 sampling) |

## compiler

| Case | v4 baseline hz | v5 current hz | Change |
| --- | ---: | ---: | --- |
| small component (static props + events + conditional + keyed list + component) | 322.94 | 394.47 | improved |
| 100-row keyed list component | 15.14 | 15.67 | flat |

## template (static template hoisting, three paths compared under v5)

| Case | old path hz | hoisted hz | Change |
| --- | ---: | ---: | --- |
| single card, 8 nodes (full hoist: cloneTemplate ×1) | 21,424 | 28,737 | **1.3×** |
| single card, 8 nodes (partial hoist: dynamic root + 3×cloneTemplate) | 21,424 | 20,847 | flat |
| 1000-card mount (full hoist) | 13.51 | 21.66 | **1.6×** |
| 1000-card mount (partial hoist) | 13.51 | 14.98 | flat |
