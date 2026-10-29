/**
 * Client half entry. Built by dshBundle() into lib/client.js:
 *
 *   window.__ModuleLoader__.load({ id: 'vobs-studio', factory: function (require) { … } })
 *
 * `setup(ctx)` runs as soon as the plugin loads (before the panel is ever rendered) and
 * starts the preview-manifest data source; the view binds the module-level signals.
 */
import { defineDshPanel } from '@vobs/dsh'
import { Studio } from './panel'
import { STUDIO_CSS } from './styles'
import { disposeStudio, startStudioSource } from './store'

function StudioIcon() {
  return (
    <svg viewBox="0 0 24 24" width="100%" height="100%">
      <path
        d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z"
        fill="currentColor"
      />
      <circle cx="18.5" cy="18.5" r="2" fill="currentColor" opacity="0.55" />
      <circle cx="5.5" cy="18" r="1.4" fill="currentColor" opacity="0.35" />
    </svg>
  )
}

export default defineDshPanel(
  {
    key: 'vobs-studio',
    label: 'Vobs Studio',
    order: 5,
    styles: STUDIO_CSS,
    sidebarEntry: {
      label: 'Vobs Studio',
      renderIcon: () => <StudioIcon />
    },
    setup(ctx) {
      startStudioSource(ctx)
      return () => {
        disposeStudio()
      }
    }
  },
  () => <Studio />
)
