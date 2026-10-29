/**
 * dsh-plugin-vobs — Client-side entry.
 *
 * This file is built by `dshBundle()` into `lib/client.js`:
 *   window.__ModuleLoader__.load({ id: 'dsh-plugin-vobs', factory: function (require) { … } })
 *
 * The adapter (@vobs/dsh) handles for us: the React binding, the shadow root host, slot
 * registration, scheme following, and lifecycle cleanup. All that is left here is "which
 * slot to mount to" and "what to render".
 */
import { defineDshOverlay } from '@vobs/dsh'
import { VobsPanel } from './panel'
import { PANEL_CSS } from './styles'

/**
 * `shell.overlay` is a list slot declared by @deepseek-ai/dsh-client-ui-layout (scope: root);
 * DSH's own quota hints and plugin-manager toasts all mount here.
 */
export default defineDshOverlay(
  {
    id: 'vobs-panel',
    order: 120,
    styles: PANEL_CSS
  },
  () => <VobsPanel />
)
