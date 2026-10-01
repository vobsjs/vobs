/**
 * dsh-plugin-vobs-devkit —— Host 半侧。
 *
 * 与另外两个插件一样，Host 侧的唯一职责是「被挂载」：DSH 的客户端模块扫描已启用的
 * Loader 条目，读取本包的 `dsh.client` 声明，把 `exports['./client']` 作为浏览器
 * bundle 提供给页面。开发台的全部逻辑都在浏览器半侧。
 *
 * 注意一个架构事实：**浏览器半侧看不到你应用的运行时**（开发台跑在 DSH 里，
 * 应用跑在它自己的 dev server 里）。所以这一版的内容是构建期打进来的静态参考，
 * 只有工作区级别的数据接入后才会出现活数据。
 */
export const name = 'vobs-devkit'

export const inject: readonly string[] = []

export function apply(_ctx: unknown): void {
  // 有意留空。
}
