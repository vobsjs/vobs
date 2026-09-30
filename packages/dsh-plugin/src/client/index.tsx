/**
 * dsh-plugin-vobs —— Client 半侧入口。
 *
 * 这个文件会被 `dshBundle()` 构建成 `lib/client.js`：
 *   window.__ModuleLoader__.load({ id: 'dsh-plugin-vobs', factory: function (require) { … } })
 *
 * 适配层（@vobs/dsh）替我们处理了：React 绑定、shadow root 宿主、slot 注册、
 * 配色跟随、生命周期清理。这里只剩「挂到哪个 slot」和「渲染什么」两件事。
 */
import { defineDshOverlay } from '@vobs/dsh'
import { VobsPanel } from './panel'
import { PANEL_CSS } from './styles'

/**
 * `shell.overlay` 是 @deepseek-ai/dsh-client-ui-layout 声明的 list slot（scope: root），
 * DSH 自家的配额提示、插件管理器 toast 都挂在这里。
 */
export default defineDshOverlay(
  {
    id: 'vobs-panel',
    order: 120,
    styles: PANEL_CSS
  },
  () => <VobsPanel />
)
