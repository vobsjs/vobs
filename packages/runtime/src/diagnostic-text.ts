/**
 * 诊断文案的**单一来源**。
 *
 * ## 为什么需要它
 *
 * `VOBS_C210`（effect 自订阅）有**两个实现**，分别在两个通道上出现：
 *
 * | 实现 | 位置 | 通道 |
 * |---|---|---|
 * | 静态规则 | `@vobs/compiler` 的 `analyze.ts` | `vobs check` / `vite dev` / `vite build` |
 * | 运行时护栏 | `@vobs/vobs` 的 `dev.ts` | 浏览器控制台 / `check:runtime` |
 *
 * 它们**曾经给出不同的建议**：1.8.5 把运行时那份改成「先教结构（`on()`）、`untrack` 降为兜底」，
 * 而静态规则那份**还是旧文案（只教 `untrack`）** —— 于是用户在 `vite dev` 里看到的建议是过时的。
 * 那是我当时的疏漏（改 `dev.ts` 时 `analyze.ts` 还在 `@vobs/cli` 里，没意识到是同一份文案）。
 *
 * 两边都依赖 `@vobs/runtime`，所以文案放这里 → **结构上不可能再漂移**，
 * 比"两边各写一份 + 加个测试比对"更彻底。
 *
 * ## 文案的原则（踩坑得来的）
 *
 * **先教结构，再教补丁。** 只给 `untrack` 是局部补丁：它让这次写入不再触发重跑，
 * 但没有回答"这个 effect 为什么订阅了它"，所以同类问题反复复发
 * （真实项目反馈：用 LLM 开发时 C210 非常频繁）。
 */
export const VOBS_C210 = 'VOBS_C210'

/**
 * `VOBS_C210` 的修法文案。`name` 是信号名（不带引号）。
 *
 * 顺序：① 显式声明依赖 `on()` ② 改用派生值/memo ③ 兜底才是 `untrack`。
 */
export function vobsC210Fix(name: string): string {
  return '首选：显式声明依赖 `effect(on(deps, () => { … }))`'
    + '（on 让回调里的读取不订阅，结构上不会形成自订阅）；'
    + '或者这次写入本可以改成派生值 / memo（最常见的是「读 A 写 A」其实想问「派生出新值」）。'
    + ` 兜底：只给这一次写入断开订阅 untrack(() => { ${name}.value = next })；`
    + '如果这个 effect 本来就只该做副作用，检查是不是误读了不该读的信号。'
}

/** `VOBS_C210` 的示例代码。 */
export function vobsC210Example(name: string): string {
  return `effect(on(deps, () => {\n  // 这里的读取不订阅\n  ${name}.value = next\n}))`
}
