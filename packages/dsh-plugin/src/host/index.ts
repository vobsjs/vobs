/**
 * dsh-plugin-vobs —— Host 半侧。
 *
 * DSH 的组合包（bundle）在 profile 的 cordis 树里插入一行 `vobs-panel`，
 * 这一行指向本模块。`@deepseek-ai/dsh-client-modules` 扫描**已启用的 Loader 条目**，
 * 读取该条目所属包的 `dsh.client` 声明，把 `exports['./client']`（lib/client.js）
 * 作为浏览器 bundle 提供给页面。也就是说：
 *
 *   - Host 侧负责「被挂载」，从而让客户端 bundle 进入启动图；
 *   - 真正的 UI 全部在 Client 半侧，由 vobs 渲染（见 src/client/）。
 *
 * 因此这里不向 Agent 注册任何工具、不订阅任何事件、不占用任何服务，
 * 只声明一个合法的 cordis 插件，让宿主知道这个包处于启用状态。
 */

/** cordis 插件名，用于服务与调试命名空间；与 npm 包名无关。 */
export const name = 'vobs-panel'

/**
 * 不做任何注入：面板不依赖 Host 侧服务。
 * 客户端半侧自己声明 `inject: ['slots']`，那是浏览器 cordis 树里的事。
 */
export const inject: readonly string[] = []

export function apply(_ctx: unknown): void {
  // 有意留空：本插件的可观察行为全部发生在浏览器半侧。
}
