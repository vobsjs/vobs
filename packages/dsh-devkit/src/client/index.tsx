/**
 * dsh-plugin-vobs-devkit —— Client 半侧入口。
 *
 * 用 `defineDshPanel` 一次注册两处：主区域整页面板（keyed `main` slot）与左侧栏入口
 * （`sidebar.panellist`，id 与 key 一致即互相关联）。两处 label 保持一致 ——
 * 侧栏写简称、面板写全称会让人对不上是哪个面板。
 */
import { defineDshPanel } from '@vobs/dsh'
import { state } from '@vobs/vobs'
import { VobsDevKit, type DevKitTab } from './devkit'
import { DevKitIcon } from './icons'
import { DEVKIT_CSS } from './styles'

/** 面板状态放在模块级：组件体只执行一次，signal 才是驱动更新的东西。 */
const tab = state<DevKitTab>('guardrails')
const apiName = state('state')

export default defineDshPanel(
  {
    key: 'vobs-devkit',
    label: 'Vobs 开发台',
    styles: DEVKIT_CSS,
    sidebarEntry: {
      label: 'Vobs 开发台',
      order: 8,
      renderIcon: () => <DevKitIcon />
    },
    setup() {
      // 这一版是纯静态参考内容，没有订阅、没有定时器，所以没有需要清理的东西。
      return undefined
    }
  },
  () => <VobsDevKit tab={tab} apiName={apiName} />
)
