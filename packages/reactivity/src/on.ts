import { untrack, type ReadableSignal } from './signal'

/** 可以喂给 `on` 的依赖来源：单个信号、信号数组，或取值函数。 */
export type OnDependency<T> =
  | ReadableSignal<T>
  | readonly ReadableSignal<unknown>[]
  | (() => T)

export interface OnOptions {
  /**
   * 首次求值只**记录**依赖值、不调用回调（Solid 的 `{ defer: true }`）。
   *
   * 用途：只想在依赖**变化**时干活，不想在挂载时就跑一遍。
   */
  readonly defer?: boolean
}

/**
 * **显式声明 effect 的依赖**——解决了细粒度响应式里一类结构性坑。
 *
 * ```ts
 * effect(on(session, () => { void syncEnterpriseTemplates() }))
 * ```
 *
 * ## 为什么需要它（真实项目 2026-10-02 踩坑 3）
 *
 * `effect` 的依赖是**自动收集**的：回调体内读到的任何信号都会变成依赖。
 * 而**「effect 只调了个函数」不等于没依赖** —— 被调函数在**首个 `await` 之前**的代码
 * 是同步执行的，所以它读/写的信号全都算在 effect 头上：
 *
 * ```ts
 * // ❌ 守卫读 + 状态机写都在 sync() 的首个 await 之前
 * effect(() => { if (session.value) void sync() })
 * //   → effect 订阅了 ent.sync（sync() 里读的）
 * //   → sync() 里写 ent.sync → 再次触发 effect → 无限重同步（C210 + C211）
 * ```
 *
 * 对策此前只有 `untrack`：
 *
 * ```ts
 * effect(() => { if (session.value) untrack(() => { void sync() }) })
 * ```
 *
 * **能用，但靠人记得。** `on` 把它变成**结构上写不出来**：回调在 `untrack`
 * 作用域里执行，于是它调用的函数碰什么信号都不会反向订阅。
 *
 * ## 与 async 无关
 *
 * 它管的是「effect 不该被它调用的函数碰到的信号牵着走」，**不管那个函数是不是 async**。
 * 踩坑 3 只是它的一个实例。
 *
 * ## 语义（对齐 SolidJS 的 `on()`）
 *
 * - **只在声明的依赖变化时触发**：回调体内的读取不建立订阅
 * - `previous` 是**上一次**的依赖值（首次为 `undefined`）
 * - `defer: true` 时首次求值只记录、不调用
 * - 依赖本身仍被正常追踪 —— 它**不是** `untrack` 的替代品，是"依赖清单"的显式化
 */
export function on<T, R>(
  deps: OnDependency<T>,
  fn: (value: T, previous: T | undefined) => R,
  options: OnOptions = {}
): () => R | undefined {
  const readDeps = createDepsReader(deps)
  let previous: T | undefined
  let primed = false

  return (): R | undefined => {
    // 依赖读取在**追踪作用域内** —— 这是唯一该订阅的东西
    const value = readDeps()

    if (!primed) {
      primed = true
      previous = value
      if (options.defer) return undefined
    } else {
      const last = previous
      previous = value
      /*
       * 回调在 untrack 里跑：它内部读到的信号不会反向订阅。
       * 返回值原样透出（effect 支持返回值作为 cleanup）。
       */
      return untrack(() => fn(value, last))
    }
    return untrack(() => fn(value, undefined))
  }
}

function createDepsReader<T>(deps: OnDependency<T>): () => T {
  if (typeof deps === 'function') return deps as () => T
  if (Array.isArray(deps)) {
    const list = deps as readonly ReadableSignal<unknown>[]
    return () => list.map(signal => signal.value) as unknown as T
  }
  const signal = deps as ReadableSignal<T>
  if (signal && typeof signal === 'object' && 'value' in signal) return () => signal.value
  throw new Error(
    'Vobs on(): 第一个参数必须是信号（有 .value）、信号数组，或取值函数。'
    + '传普通值不会建立订阅 —— 那样 effect 永远不会被触发。'
  )
}
