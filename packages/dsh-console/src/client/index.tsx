/**
 * dsh-plugin-vobs-console —— Client 半侧入口。
 *
 * 用 `defineDshPanel` 一次注册两处：主区域的整页面板（keyed `main` slot）
 * 与左侧栏的入口图标（`sidebar.panellist`，id 与 key 一致即可互相关联）。
 *
 * 数据源在 `setup(ctx)` 里决定：探测到 DSH 的 `sessions` / `uiSession` 服务就接真实数据，
 * 否则用演示数据并如实标注 —— 界面永远不会把手头没有的数据伪装成真实运行态。
 */
import { defineDshPanel } from '@vobs/dsh'
import { state } from '@vobs/vobs'
import { VobsConsole } from './console'
import { ConsoleIcon } from './icons'
import { createConsoleStore, createSwitchableSource, createSyntheticSource, selectConsoleSource } from './data'
import { CONSOLE_CSS } from './styles'

/** 演示数据源：确定性（固定 seed），同一份输入每次结果一致。 */
const demo = createSyntheticSource({ seed: 20260101 })

/** 可热替换：先以演示数据建好商店，探测到真实服务后整体切过去。 */
const source = createSwitchableSource(demo)
const store = createConsoleStore(source)

const note = state(demo.note)
const live = state(false)

/** 演示数据的推进间隔（毫秒）。接真实数据后这段不会启动。 */
const DEMO_TICK_MS = 900

export default defineDshPanel(
  {
    key: 'vobs-console',
    label: 'Vobs Console',
    styles: CONSOLE_CSS,
    sidebarEntry: {
      label: 'Console',
      order: 9,
      renderIcon: () => <ConsoleIcon />
    },
    setup(ctx) {
      const selection = selectConsoleSource(ctx, demo)
      note.value = selection.note

      if (selection.source.kind === 'dsh') {
        live.value = true
        source.switchTo(selection.source)
        // 真实源的订阅必须跟着插件生命周期释放，否则会一直挂在 DSH 的会话目录上。
        return () => source.dispose()
      }

      live.value = false
      const timer = setInterval(() => demo.tick(), DEMO_TICK_MS)
      return () => clearInterval(timer)
    }
  },
  () => <VobsConsole store={store} note={note} live={live} />
)
