/**
 * Client half entry. Built by build-dsh-plugins.mjs into lib/client.js:
 *
 *   window.__ModuleLoader__.load({ id: 'dsh-plugin-vobs-studio', factory: function (require) { … } })
 *
 * Composes two registrations on one plugin:
 *   - the full-page Studio panel (`main` keyed slot + sidebar entry)
 *   - in-chat toolview rows for the Studio MCP tools (`tool.call.toolview`, key = tool name)
 *
 * `setup(ctx)` runs as soon as the plugin loads (before the panel is ever rendered) and
 * starts the preview-manifest data source; the view binds the module-level signals.
 */
import { createVobsPropsSlotHost, defineDshPlugin, defineDshPanel, type DshClientContext } from '@vobs/dsh'
import { Studio } from './panel'
import { STUDIO_CSS } from './styles'
import { disposeStudio, startStudioSource } from './store'
import { TOOLVIEW_CSS, TOOLVIEW_TOOLS, studioToolRow } from './toolview'

function StudioIcon() {
  // Fixed pixel size — the panellist host has no intrinsic constraint, so width="100%"
  // blows the icon up to fill the whole sidebar card (seen in a real install).
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" />
      <circle cx="18.5" cy="18.5" r="2" />
      <circle cx="5.5" cy="18" r="1.4" />
    </svg>
  )
}

const panelPlugin = defineDshPanel(
  {
    key: 'vobs-studio',
    label: 'Vobs Studio',
    order: 5,
    styles: STUDIO_CSS,
    // The preview-manifest data source reads sessions + remote.workspaceFiles. DSH's cordis
    // intercepts property access on injected services: sub-paths must be declared with their
    // dotted path ("cannot get property 'remote.workspaceFiles' without inject" — seen in a
    // real install).
    injectServices: ['sessions', 'remote', 'remote.workspaceFiles'],
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

export default defineDshPlugin({
  // "layout" is declared for the slash command's selectPanel: cordis THROWS on
  // property access of an undeclared service — optional chaining cannot guard it
  // (the same class of incident as the undeclared remote.workspaceFiles read).
  inject: [...panelPlugin.inject, 'layout'],
  setup(ctx) {
    panelPlugin.apply(ctx)
    for (const tool of TOOLVIEW_TOOLS) {
      ctx.slots.inject('tool.call.toolview', () =>
        ctx.slots.register(
          { name: 'tool.call.toolview', key: tool },
          createVobsPropsSlotHost(studioToolRow, { styles: TOOLVIEW_CSS })
        )
      )
    }
    registerSlashCommand(ctx)
  }
})

/**
 * `/vobs-studio` in the chat input's slash menu → opens the Studio panel, the same way
 * the sidebar rail does (`ctx.layout.selectPanel(id)` — recon'ed from the host's own
 * sidebar client). Registration rides the official `commandUi` service; any failure is
 * contained (the command disappears, the plugin keeps working).
 */
interface CommandUiScope {
  get?(name: string): { register?(contribution: unknown): unknown } | undefined
  effect?(callback: () => unknown, label?: string): unknown
}

function registerSlashCommand(ctx: DshClientContext): void {
  try {
    const host = ctx as unknown as {
      inject?: (services: string[], callback: (scope: CommandUiScope) => void) => void
      layout?: { selectPanel?: (id: string) => void }
    }
    if (typeof host.inject !== 'function') return
    host.inject(['commandUi'], scope => {
      const commandUi = scope.get?.('commandUi')
      if (commandUi?.register === undefined) return
      // bind the method to a const: property narrowing does not survive into the closure
      const register = commandUi.register
      scope.effect?.(() => register({
        name: 'vobs-studio',
        label: () => 'Vobs Studio',
        available: () => true,
        ui: {
          kind: 'action',
          run: () => {
            host.layout?.selectPanel?.('vobs-studio')
          }
        }
      }), 'vobs-studio: slash command')
    })
  } catch (error) {
    console.warn('[vobs-studio] slash command registration failed:', error)
  }
}
