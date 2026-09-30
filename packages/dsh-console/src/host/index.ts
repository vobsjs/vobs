/**
 * dsh-plugin-vobs-console —— Host 半侧。
 *
 * 与 dsh-plugin-vobs 一样，Host 侧的唯一职责是「被挂载」：DSH 的客户端模块扫描已启用的
 * Loader 条目，读取本包的 `dsh.client` 声明，把 `exports['./client']` 作为浏览器 bundle
 * 提供给页面。Console 的全部逻辑都在浏览器半侧。
 */
export const name = 'vobs-console'

export const inject: readonly string[] = []

export function apply(_ctx: unknown): void {
  // 有意留空。
}
