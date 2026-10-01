/**
 * 开发期护栏 —— 把 vobs 里「静默失效」的两类写法变成明确报错。
 *
 * 为什么需要它：模型（和人）最容易在 vobs 上犯的错，恰恰是**不发声**的错。
 * 最典型的是 effect 自订阅 —— `effect(() => { count.value++ })` 会自己把自己
 * 重新调度，实测能连续重跑上百轮，期间不报错、不崩溃，只是变慢，最后被别的问题
 * 掩盖掉。AI 拿到这种反馈只会照错的写法再改一遍。
 *
 * 实现方式：**完全建立在 `@vobs/reactivity` 已有的 debug 钩子上**，不改热路径、
 * 不引入运行时开销（没人装 hooks 时 `hasDebugHooks()` 直接短路）。代价是护栏
 * 只能**报告**，不能中断 —— 钩子里的异常会被 `invokeDebug` 吞掉，这是刻意的
 * 保证（调试工具绝不改变应用行为）。
 *
 * 用法：
 * ```ts
 * import { installDevGuardrails } from '@vobs/vobs/dev'
 *
 * if (import.meta.env.DEV) {
 *   installDevGuardrails({ onDiagnostic: d => devkit.report(d) })
 * }
 * ```
 */

import {
  getDebugHooks,
  getSignalDebugName,
  setDebugHooks,
  type Dependency,
  type Effect,
  type Owner,
  type ReactivityDebugHooks,
  type ReadableSignal
} from '@vobs/reactivity'

/** 单条诊断。字段刻意做窄，方便直接渲染成开发台的问题卡片或输出成 JSON。 */
export interface VobsDiagnostic {
  /** 稳定错误码，AI 与文档按它检索。 */
  code: string
  severity: 'error' | 'warning'
  /** 发生了什么。 */
  message: string
  /** 该怎么改 —— 护栏必须给出正确写法，只报错对 AI 没有价值。 */
  hint: string
  /** 调用点（尽力而为：从 stack 里取第一个像用户源码的帧），形如 `Counter.tsx:12:5`。 */
  site?: string
  /** 累计命中次数（同一位置合并计数，避免刷屏）。 */
  count: number
}

export interface DevGuardrailOptions {
  /** 每产生一条诊断为调用一次；合并计数时重复调用，count 递增。 */
  onDiagnostic?: (diagnostic: VobsDiagnostic) => void
  /**
   * 时间窗内同一个 effect 连跑超过这个次数即判定为循环。默认 50。
   * 为什么用时间窗而不是 flush：调度器可能每次写入都开一次刷新，循环会跨 flush，
   * 按 flush 计数会漏；而真正的循环一定在极短时间内连跑很多次。
   */
  effectRerunLimit?: number
  /** 连跑统计的时间窗（毫秒）。默认 100。 */
  rerunWindowMs?: number
  /** 是否同时打到 console.error（默认 true）。设 false 只走 onDiagnostic。 */
  console?: boolean
  /** 最多报告多少个不同位置（防循环把内存刷爆）。默认 50。 */
  maxSites?: number
}

/** effect 写入了自己依赖的信号 —— 最常见的自订阅。 */
export const VOBS_C210 = 'VOBS_C210'
/** 时间窗内同一个 effect 连跑次数异常 —— 跨 effect 互相触发的循环兜底。 */
export const VOBS_C211 = 'VOBS_C211'

let active: (() => void) | null = null

/** 从 stack 里取第一个看起来像用户源码的帧。尽力而为。 */
function captureSite(): string | undefined {
  const stack = new Error().stack
  if (stack === undefined) return undefined
  for (const line of stack.split('\n').slice(1)) {
    const match = /\(?((?:[a-zA-Z]:)?[^()\s]+?\.(?:tsx|jsx|ts|js|mjs|cjs)):(\d+):(\d+)\)?$/u.exec(line.trim())
    if (match === null) continue
    const [, file, row, column] = match
    // 跳过依赖与框架自身 —— 否则报出来的是护栏内部的位置
    if (file.includes('node_modules')) continue
    if (/\/(?:reactivity|vobs|runtime)\/(?:src|dist)\//u.test(file) || file.includes('dev.')) continue
    return `${file.split(/[/\\]/u).slice(-2).join('/')}:${row}:${column}`
  }
  return undefined
}

function signalLabel(signal: ReadableSignal<unknown>): string {
  const name = getSignalDebugName(signal)
  return name === undefined ? '(未命名信号)' : `"${name}"`
}

/**
 * 装上开发期护栏，返回卸载函数。重复调用幂等（返回同一个卸载函数）。
 */
export function installDevGuardrails(options: DevGuardrailOptions = {}): () => void {
  if (active !== null) return active

  const report = options.onDiagnostic
  const toConsole = options.console !== false
  const rerunLimit = options.effectRerunLimit ?? 50
  const rerunWindowMs = options.rerunWindowMs ?? 100
  const maxSites = options.maxSites ?? 50

  /** 正在运行的 effect 栈（effect 可以嵌套）。 */
  const running: Effect[] = []
  /** 每个 effect 在当前时间窗内的连跑次数。WeakMap：effect 被释放时不持有引用。 */
  const bursts = new WeakMap<Effect, { runs: number; startedAt: number }>()
  /**
   * 每个 effect 的**创建位置**。
   *
   * 必须在 `effectCreated` 时抓一次并记住：重跑发生在调度器的微任务里，
   * 那时候的调用栈根本没有用户代码 —— 每次重跑都现抓，同一个 effect 会报出
   * 好几个不同位置，反而找不到源头。
   */
  const sites = new WeakMap<Effect, string | undefined>()
  /** 同一个位置只报一次，之后只累加计数。 */
  const seen = new Map<string, VobsDiagnostic>()

  const emit = (
    code: string,
    severity: VobsDiagnostic['severity'],
    message: string,
    hint: string,
    site: string | undefined
  ): void => {
    const key = `${code}@${site ?? '?'}`
    const existing = seen.get(key)
    if (existing !== undefined) {
      existing.count += 1
      // 传快照而不是内部对象：调用方存下来之后不该被后续命中改掉
      report?.({ ...existing })
      return
    }
    if (seen.size >= maxSites) return
    const diagnostic: VobsDiagnostic = { code, severity, message, hint, site, count: 1 }
    seen.set(key, diagnostic)
    if (toConsole) {
      const where = site === undefined ? '' : ` (${site})`
      console.error(`[vobs] ${code} ${message}${where}\n  → ${hint}`)
    }
    report?.({ ...diagnostic })
  }

  const previous = getDebugHooks()

  const hooks: ReactivityDebugHooks = {
    ...previous,

    effectCreated(effect: Effect, owner: Owner | null): void {
      // 唯一一次能拿到用户代码栈的时机
      sites.set(effect, captureSite())
      previous?.effectCreated?.(effect, owner)
    },

    effectRunStart(effect: Effect): void {
      running.push(effect)

      // 读侧兜底：依赖检测漏掉的（典型是两个 effect 互相触发）在这里现形
      const now = Date.now()
      const burst = bursts.get(effect)
      if (burst === undefined || now - burst.startedAt > rerunWindowMs) {
        bursts.set(effect, { runs: 1, startedAt: now })
      } else {
        burst.runs += 1
        if (burst.runs === rerunLimit) {
          emit(
            VOBS_C211,
            'error',
            `同一个 effect 在 ${rerunWindowMs}ms 内连跑了 ${burst.runs} 次 —— 大概率是自订阅，或两个 effect 在互相触发`,
            '检查这些 effect 对信号的写入：写自己读过的信号要用 untrack 包住；' +
              '由其它信号派生的值改用 memo，而不是「读 A 写 B」。',
            sites.get(effect)
          )
        }
      }

      previous?.effectRunStart?.(effect)
    },

    effectRunEnd(effect: Effect, error?: unknown, handled?: boolean): void {
      const index = running.lastIndexOf(effect)
      if (index >= 0) running.splice(index, 1)
      previous?.effectRunEnd?.(effect, error, handled)
    },

    signalChanged(signal: ReadableSignal<unknown>, previousValue: unknown, nextValue: unknown): void {
      previous?.signalChanged?.(signal, previousValue, nextValue)

      const current = running[running.length - 1]
      if (current === undefined || current.disposed) return
      // 这个 effect 现在就订着这个信号：这次写入会把它重新调度 → 自订阅
      if (!current.dependencies.has(signal as unknown as Dependency)) return

      emit(
        VOBS_C210,
        'error',
        `effect 写入了它自己依赖的信号 ${signalLabel(signal)} —— 这次写入会把它重新调度，形成自订阅循环`,
        '把这次写入包进 untrack：untrack(() => { signal.value = next })；' +
          '如果这个 effect 本来就只该做副作用，检查是不是误读了不该读的信号。',
        sites.get(current)
      )
    }
  }

  setDebugHooks(hooks)

  const uninstall = (): void => {
    setDebugHooks(previous)
    running.length = 0
    seen.clear()
    active = null
  }
  active = uninstall
  return uninstall
}

/** 当前是否已装护栏。 */
export function isDevGuardrailsInstalled(): boolean {
  return active !== null
}
