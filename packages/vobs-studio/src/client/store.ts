/**
 * Module-level Studio state.
 *
 * The view is only rendered when the panel opens, while `setup(ctx)` runs as soon as the
 * plugin loads — so the signals live here and the data source (created in setup) drives
 * them; the component body reads them in dynamic positions and runs exactly once.
 *
 * Panel scope (owner call): the panel is a WORKFLOW-STATUS page, not a file browser —
 * source browsing belongs to DSH's built-in sidebar, page rendering to DSH's browser.
 */
import { state } from '@vobs/vobs'
import { createStudioSource, type StudioSource, type StudioState } from './manifest'

export const studioState = state<StudioState>(
  { status: 'loading', message: 'Waiting for the plugin setup…' },
  'studio.state'
)

let source: StudioSource | undefined

export function startStudioSource(ctx: Parameters<typeof createStudioSource>[0]): void {
  source?.dispose()
  source = createStudioSource(ctx, { sink: studioState })
}

export function refreshStudio(): void {
  source?.refresh()
}

export function disposeStudio(): void {
  source?.dispose()
  source = undefined
}
