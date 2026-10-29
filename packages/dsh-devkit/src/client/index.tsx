/**
 * dsh-plugin-vobs-devkit — Client-side entry.
 *
 * Uses `defineDshPanel` to register both places at once: the full-page panel in the main area
 * (keyed `main` slot) and the sidebar entry (`sidebar.panellist`; id matching key links them).
 * The two labels stay identical — an abbreviation in the sidebar with a full name in the panel
 * leaves people unsure which panel it is.
 *
 * Data surface:
 * - The "Project" page reads `.vobs/check.json` from the workspace through DSH's built-in
 *   workspace-files Remote (the client can read workspace files, **the plugin's Host side is
 *   not needed**). The report is produced by `vobs check --write`; the panel is read-only.
 * - The other pages are static references baked in at build time.
 */
import { defineDshPanel } from '@vobs/dsh'
import { state } from '@vobs/vobs'
import { VobsDevKit, type DevKitTab } from './devkit'
import { DevKitIcon } from './icons'
import { createProjectSource, type ProjectState } from './project'
import { DEVKIT_CSS } from './styles'

/** Panel state lives at module level: the component body executes once, the signal is what drives updates. */
const tab = state<DevKitTab>('project', 'tab')
const apiName = state('state', 'apiName')
/**
 * State of the check report. It exists at module level because the render is assembled before
 * setup runs — `setup(ctx)` hands the same signal to the data source to drive (the same pattern
 * as the Console).
 */
const project = state<ProjectState>({ status: 'loading', message: 'Reading the check report…' }, 'project')

let refreshProject: () => void = () => {}

export default defineDshPanel(
  {
    key: 'vobs-devkit',
    label: 'Vobs Devkit',
    styles: DEVKIT_CSS,
    // Reading workspace files needs these two: the session list decides "which workspace", remote provides workspaceFiles.
    injectServices: ['sessions', 'remote'],
    sidebarEntry: {
      label: 'Vobs Devkit',
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
