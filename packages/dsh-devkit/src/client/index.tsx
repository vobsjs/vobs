/**
 * dsh-plugin-vobs-devkit —— Client 半侧入口。
 *
 * 用 `defineDshPanel` 一次注册两处：主区域整页面板（keyed `main` slot）与左侧栏入口
 * （`sidebar.panellist`，id 与 key 一致即互相关联）。两处 label 保持一致 ——
 * 侧栏写简称、面板写全称会让人对不上是哪个面板。
 *
 * 数据面：
 * - 「项目」页读工作区里的 `.vobs/check.json`，走 DSH 内置的 workspace-files Remote
 *   （客户端就能读工作区文件，**不需要本插件的 Host 半侧**）。报告由
 *   `vobs check --write` 产出，面板只读。
 * - 其余页面是构建期打进来的静态参考。
 */
import { defineDshPanel } from '@vobs/dsh'
import { state } from '@vobs/vobs'
import { VobsDevKit, type DevKitTab } from './devkit'
import { DevKitIcon } from './icons'
import { createProjectSource, type ProjectState } from './project'
import { DEVKIT_CSS } from './styles'

/** 面板状态放在模块级：组件体只执行一次，signal 才是驱动更新的东西。 */
const tab = state<DevKitTab>('project')
const apiName = state('state')
/**
 * 检查报告的状态。模块级存在是因为 render 在 setup 之前就装配好了 ——
 * `setup(ctx)` 里把同一个信号交给数据源去驱动（与 Console 同一套模式）。
 */
const project = state<ProjectState>({ status: 'loading', message: '正在读取检查报告…' })

let refreshProject: () => void = () => {}

export default defineDshPanel(
  {
    key: 'vobs-devkit',
    label: 'Vobs 开发台',
    styles: DEVKIT_CSS,
    // 读工作区文件需要这两项：会话列表决定「哪个工作区」，remote 提供 workspaceFiles。
    injectServices: ['sessions', 'remote'],
    sidebarEntry: {
      label: 'Vobs 开发台',
      order: 8,
      renderIcon: () => <DevKitIcon />
    },
    setup(ctx) {
      const source = createProjectSource(ctx, { sink: project })
      refreshProject = source.refresh
      return () => source.dispose()
    }
  },
  () => (
    <VobsDevKit
      tab={tab}
      apiName={apiName}
      project={project}
      onRefreshProject={() => { refreshProject() }}
    />
  )
)
