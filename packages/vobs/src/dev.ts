/**
 * 开发期护栏 —— 把 vobs 里「静默失效」的两类写法变成结构化报错。
 *
 * 为什么需要它：模型（和人）最容易在 vobs 上犯的错，恰恰是**不发声**的错。
 * 最典型的是 effect 自订阅 —— `effect(() => { count.value++ })` 会自己把自己
 * 重新调度，实测能连续重跑上百轮，期间不报错、不崩溃，只是变慢，最后被别的问题
 * 掩盖掉。AI 拿到这种反馈只会照错的写法再改一遍。
 *
 * 产出的是框架里既有的 `VobsError`（`layer: 'constraint'`），不是另造一套形状 ——
 * 这样终端/DevTools/开发台面板都能复用 `formatVobsError` 与同一组字段：
 * `code` / `severity` / `fix` / `location` / `example`。
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
 *   installDevGuardrails({ onViolation: v => devkit.report(v) })
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
import { VobsError, formatVobsError, type VobsErrorLocation } from '@vobs/runtime/error'
import { vobsC210Example, vobsC210Fix } from '@vobs/runtime'

/** effect 写入了自己依赖的信号 —— 最常见的自订阅。 */
export const VOBS_C210 = 'VOBS_C210'
/** 时间窗内同一个 effect 连跑次数异常 —— 跨 effect 互相触发的循环兜底。 */
export const VOBS_C211 = 'VOBS_C211'

/** 一次护栏命中：结构化错误 + 该位置累计命中次数。 */
export interface GuardrailViolation {
  readonly error: VobsError
  /** 同一位置第几次命中。首报为 1。 */
  readonly count: number
}

export interface DevGuardrailOptions {
  /** 每产生一条违规调用一次；同一位置合并计数时会重复调用，count 递增。 */
  onViolation?: (violation: GuardrailViolation) => void
  /**
   * 时间窗内同一个 effect 连跑超过这个次数即判定为循环。默认 50。
   * 为什么用时间窗而不是 flush 边界：调度器可能每次写入都开一次刷新，循环会跨 flush，
   * 按 flush 计数会漏；而真正的循环一定在极短时间内连跑很多次。
   */
  effectRerunLimit?: number
  /** 连跑统计的时间窗（毫秒）。默认 100。 */
  rerunWindowMs?: number
  /** 是否同时用 `formatVobsError` 打到 console.error（默认 true）。 */
  console?: boolean
  /** 最多报告多少个不同位置（防循环把内存刷爆）。默认 50。 */
  maxSites?: number
}

let active: (() => void) | null = null

/**
 * 内部栈帧的函数名。**按函数名跳过而不是按目录跳过** —— 目录过滤会误伤用户自己的
 * 文件（项目里叫 `src/effect.ts` 很正常），而函数名是框架自己的实现细节。
 */
const INTERNAL_FRAMES = /^(?:captureLocation|effectCreated|effectRunStart|effectRunEnd|signalChanged|invokeDebug|trackDependency|effect|renderEffect|run)$/u

/** 从 stack 里找第一个用户代码帧，转成框架统一的位置结构。 */
function captureLocation(): VobsErrorLocation | undefined {
  const stack = new Error().stack
  if (stack === undefined) return undefined
  for (const raw of stack.split('\n').slice(1)) {
    const text = raw.trim()
    if (!text.startsWith('at ')) continue
    const body = text.slice(3)
    const named = /^(\S+?)\s+\((.+)\)$/u.exec(body)
    const frameName = named?.[1]
    const where = named?.[2] ?? body
    if (frameName !== undefined && INTERNAL_FRAMES.test(frameName)) continue
    if (where.includes('node_modules')) continue
    if (/[/\\]dev\.(?:ts|js|cjs|mjs)$/u.test(where)) continue
    const match = /^(.+?):(\d+):(\d+)$/u.exec(where)
    if (match === null) continue
    return { file: match[1], line: Number(match[2]), column: Number(match[3]) }
  }
  return undefined
}

function signalLabel(signal: ReadableSignal<unknown>): string {
  const name = getSignalDebugName(signal)
  return name === undefined ? '(未命名信号)' : `"${name}"`
}

/**
 * 信号没有名字时，补一句**为什么**以及**怎么修**。
 *
 * ## 实测出来的成因（不是推测）
 *
 * 编译器的 `inferStateDebugName` 只在 `state` 是**直接从 `@vobs/reactivity` /
 * `@vobs/vobs` 引入**时才从变量名推断。实测四种形态：
 *
 * ```
 * 有名字   .tsx 直接 import
 * 有名字   .ts  直接 import          ← 与文件扩展名无关
 * 无名字   .ts  经自己的 barrel 再导出引入
 * 无名字   .tsx 经自己的 barrel 再导出引入
 * ```
 *
 * 真凶是 **barrel 再导出**，不是「.ts 文件没被编译」（我最初的推测是错的）。
 * 识别 barrel 需要跨文件模块解析，而编译器的 transform 是**逐文件**的，做不到。
 *
 * ## 为什么要在这里说
 *
 * 看到 `(未命名信号)` 时不知道该改什么，只能手工回溯 —— 实测反馈里这是最贵的一环。
 * 而修法只是**一行 import 改动**（或显式传状态名），所以必须让报错本身讲出来。
 */
function unnamedSignalHint(signal: ReadableSignal<unknown>): string {
  if (getSignalDebugName(signal) !== undefined) return ""
  return "\n  该信号没有名字 —— 常见原因：`state` 是经**自己的 barrel / 再导出**引入的"
    + "（编译器只对直接从 `@vobs/reactivity` / `@vobs/vobs` 引入的 `state` 自动命名）。"
    + "改成直接引入，或显式传名：`state(initial, \"entSync\")`。有了名字，这条报错会直接点名。"
}

/**
 * 装上开发期护栏，返回卸载函数。重复调用幂等（返回同一个卸载函数）。
 */
export function installDevGuardrails(options: DevGuardrailOptions = {}): () => void {
  if (active !== null) return active

  const notify = options.onViolation
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
  const sites = new WeakMap<Effect, VobsErrorLocation | undefined>()
  /** 同一个位置只留一条，之后只累加计数。 */
  const seen = new Map<string, GuardrailViolation>()

  const emit = (error: VobsError): void => {
    const key = `${error.code}@${error.location?.file ?? '?'}:${error.location?.line ?? '?'}`
    const existing = seen.get(key)
    if (existing !== undefined) {
      const merged: GuardrailViolation = { error: existing.error, count: existing.count + 1 }
      seen.set(key, merged)
      notify?.({ error: merged.error, count: merged.count })
      return
    }
    if (seen.size >= maxSites) return
    const violation: GuardrailViolation = { error, count: 1 }
    seen.set(key, violation)
    if (toConsole) console.error(formatVobsError(error, { environment: 'development' }))
    notify?.({ error, count: 1 })
  }

  const previous = getDebugHooks()

  const hooks: ReactivityDebugHooks = {
    ...previous,

    effectCreated(effect: Effect, owner: Owner | null): void {
      // 唯一一次能拿到用户代码栈的时机
      sites.set(effect, captureLocation())
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
          emit(new VobsError({
            code: VOBS_C211,
            severity: 'error',
            layer: 'constraint',
            location: sites.get(effect),
            message: `同一个 effect 在 ${rerunWindowMs}ms 内连跑了 ${burst.runs} 次 —— 大概率是自订阅，或两个 effect 在互相触发`,
            fix: '首选：显式声明依赖 `effect(on(deps, () => { … }))`（on 让回调里的读取不订阅）；'
              + '由其它信号派生的值改用 memo，而不是「读 A 写 B」；'
              + '兜底才是把写自己读过的信号用 untrack 包住。'
              + '注意被调函数在**首个 await 之前**的代码也是同步执行的 —— '
              + '「effect 里只调了个函数」不等于没依赖（编译期 VOBS_C106 会提示 async 回调）。',
            docs: 'https://github.com/vobsjs/vobs/blob/main/docs/dev-guardrails.md'
          }))
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

      const label = signalLabel(signal)
      const bare = label.replace(/"/gu, '')
      emit(new VobsError({
        code: VOBS_C210,
        severity: 'error',
        layer: 'constraint',
        location: sites.get(current),
        message: `effect 写入了它自己依赖的信号 ${label} —— 这次写入会把它重新调度，形成自订阅循环`
        + unnamedSignalHint(signal),
        /*
         * fix 的顺序很要紧：**先教结构，再教补丁**。
         *
         * 此前只写 `untrack(...)`。那是**局部补丁** —— 它让这次写入不再触发重跑，
         * 但没有回答"这个 effect 为什么订阅了它"。真实项目反馈里这类问题高频复发
         * （2026-10-02 用户报告：用 LLM 开发时 C210 非常频繁），而 `untrack` 是
         * 需要人记得的写法，不是结构。
         *
         * 首选是 `on()`（1.8.3 加入，对齐 SolidJS）：显式声明依赖，回调在 untrack
         * 作用域里跑，所以它调用的函数碰什么信号都不会反向订阅 —— **结构上写不出来**。
         * 其次是改用派生值 / memo。
         */
        // 与静态规则（@vobs/compiler 的 analyze）**共用同一份文案** —— 此前两处各写一份，
        // 1.8.5 只改了这里，静态规则那份还是旧文案，于是 vite 通道给出过时建议。
        fix: vobsC210Fix(bare),
        example: vobsC210Example(bare),
        docs: 'https://github.com/vobsjs/vobs/blob/main/docs/dev-guardrails.md'
      }))
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
