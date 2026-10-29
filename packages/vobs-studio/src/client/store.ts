/**
 * Module-level Studio state.
 *
 * The view is only rendered when the panel opens, while `setup(ctx)` runs as soon as the
 * plugin loads — so the signals live here and the data source (created in setup) drives
 * them; the component body reads them in dynamic positions and runs exactly once.
 */
import { state } from '@vobs/vobs'
import { createSourceBrowser, type SourceSignals } from './source'
import { createStudioSource, type StudioSource, type StudioState } from './manifest'

export const studioState = state<StudioState>(
  { status: 'loading', message: 'Waiting for the plugin setup…' },
  'studio.state'
)

export const activePageId = state('', 'studio.activePage')

/**
 * Whether the user dismissed the per-session preview-server hint. The static server
 * binds on each `design_preview_build` call and dies with the harness — after a DSH
 * restart the panel is "ready" (manifest still on disk) with blank frames, which reads
 * like a bug unless the reason is stated once.
 */
export const serverNoticeDismissed = state(false, 'studio.serverNoticeDismissed')

/** Left-rail mode: rendered-page preview vs project source browser. */
export const railMode = state<'pages' | 'files'>('pages', 'studio.railMode')

let source: StudioSource | undefined
let sourceBrowser: SourceSignals | undefined
/** The plugin setup ctx — the only place services are reachable; captured for the source browser. */
let pluginCtx: unknown

function ensureSourceBrowser(): SourceSignals {
  if (sourceBrowser === undefined) {
    sourceBrowser = createSourceBrowser(pluginCtx, {
      projectDir: {
        get value(): string {
          return String(studioState.value.manifest?.project?.dir ?? '')
        }
      },
      sessionId: {
        get value(): string {
          return String(studioState.value.sessionId ?? '')
        }
      }
    })
  }
  return sourceBrowser
}

export function sourceBrowserOf(): SourceSignals {
  return ensureSourceBrowser()
}

export function startStudioSource(ctx: Parameters<typeof createStudioSource>[0]): void {
  pluginCtx = ctx
  source?.dispose()
  source = createStudioSource(ctx, { sink: studioState })
}

export function refreshStudio(): void {
  source?.refresh()
}

export function disposeStudio(): void {
  source?.dispose()
  source = undefined
  sourceBrowser?.reset()
  sourceBrowser = undefined
  pluginCtx = undefined
  railMode.value = 'pages'
}
