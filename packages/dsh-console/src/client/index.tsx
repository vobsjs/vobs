/**
 * dsh-plugin-vobs-console — Client-side entry.
 *
 * Uses `defineDshPanel` to register both places at once: the full-page panel in the main area
 * (keyed `main` slot) and the entry icon in the left sidebar (`sidebar.panellist`; id matching
 * key links the two).
 *
 * The data source is decided in `setup(ctx)`: if DSH's `sessions` / `uiSession` services are
 * detected, connect real data; otherwise use demo data, labeled honestly — the UI never
 * disguises data it does not have as real run states.
 */
import { defineDshPanel } from '@vobs/dsh'
import { state } from '@vobs/vobs'
import { VobsConsole } from './console'
import { ConsoleIcon } from './icons'
import { createConsoleStore, createSwitchableSource, createSyntheticSource, selectConsoleSource } from './data'
import { CONSOLE_CSS } from './styles'

/** Demo data source: deterministic (fixed seed); the same input always yields the same result. */
const demo = createSyntheticSource({ seed: 20260101 })

/** Hot-swappable: the store starts on demo data and switches wholesale once real services are detected. */
const source = createSwitchableSource(demo)
const store = createConsoleStore(source)

const note = state(demo.note, 'note')
const live = state(false, 'live')

/** Advance interval for the demo data (milliseconds). Never started once real data is connected. */
const DEMO_TICK_MS = 900

export default defineDshPanel(
  {
    key: 'vobs-console',
    label: 'Vobs Console',
    styles: CONSOLE_CSS,
    sidebarEntry: {
      // Same as the panel title: "Console" alone in the sidebar would blur into DSH's own ecosystem
      // and leave people unsure which panel it is.
      label: 'Vobs Console',
      order: 9,
      renderIcon: () => <ConsoleIcon />
    },
    setup(ctx) {
      const selection = selectConsoleSource(ctx, demo)
      note.value = selection.note

      if (selection.source.kind === 'dsh') {
        live.value = true
        source.switchTo(selection.source)
        // The real source's subscription must be released with the plugin lifecycle,
        // otherwise it would keep hanging off DSH's session catalog.
        return () => source.dispose()
      }

      live.value = false
      const timer = setInterval(() => demo.tick(), DEMO_TICK_MS)
      return () => clearInterval(timer)
    }
  },
  () => <VobsConsole store={store} note={note} live={live} />
)
