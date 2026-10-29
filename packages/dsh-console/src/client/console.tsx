import { state, memo, type ReadableSignal } from '@vobs/vobs'
import {
  buildSparkline,
  formatClock,
  formatDuration,
  formatTokens,
  type ConsoleEvent,
  type ConsoleStore,
  type SessionState,
  type ToolStat
} from './data'
import { PauseIcon, PlayIcon, TrashIcon } from './icons'

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'stream', label: 'Event Stream' },
  { id: 'tools', label: 'Tool Analysis' },
  { id: 'artifacts', label: 'Artifacts' }
] as const

type TabId = (typeof TABS)[number]['id']

/** How many rows of the event stream to render at most; beyond that they only live in memory (5000-entry ring buffer). */
const STREAM_RENDER_LIMIT = 300

const ARTIFACT_TOOLS: readonly string[] = ['write', 'edit', 'present']

export interface VobsConsoleProps {
  store: ConsoleStore
  /** Data-source status note. */
  note: ReadableSignal<string>
  /** Whether DSH's live services were detected. */
  live: ReadableSignal<boolean>
}

/**
 * Console root component.
 *
 * The component body executes once; every `{…}` below is compiled by the vobs compiler into
 * an independent DOM binding, so when hundreds of events are injected per second only the
 * changed text nodes and new rows are touched.
 */
export function VobsConsole(props: VobsConsoleProps) {
  const tab = state<TabId>('overview', 'tab')
  const range = state<'15m' | '1h' | '24h'>('1h', 'range')

  return (
    <div class="vc">
      <div class="vc-head">
        <div>
          <div class="vc-title">
            Vobs Console
            {props.live.value ? (
              <span class="vc-badge vc-badge--live">DSH live data</span>
            ) : (
              <span class="vc-badge vc-badge--demo">Demo data</span>
            )}
          </div>
          <div class="vc-sub">{props.note.value}</div>
        </div>
        <div class="vc-head__actions">
          <div class="vc-seg">
            {(['15m', '1h', '24h'] as const).map(item => (
              <span
                key={item}
                class={range.value === item ? 'vc-seg__item vc-seg__item--on' : 'vc-seg__item'}
                onClick={() => {
                  range.value = item
                }}
              >
                {item}
              </span>
            ))}
          </div>
          <button
            class={props.store.paused.value ? 'vc-btn vc-btn--on' : 'vc-btn'}
            onClick={() => {
              if (props.store.paused.value) props.store.resume()
              else props.store.pause()
            }}
          >
            {props.store.paused.value ? <PlayIcon /> : <PauseIcon />}
            {props.store.paused.value ? 'Resume' : 'Pause'}
          </button>
          <button
            class="vc-btn"
            onClick={() => {
              props.store.clear()
            }}
          >
            <TrashIcon />
            Clear
          </button>
        </div>
      </div>

      <div class="vc-tabs">
        {TABS.map(item => (
          <span
            key={item.id}
            class={tab.value === item.id ? 'vc-tab vc-tab--on' : 'vc-tab'}
            onClick={() => {
              tab.value = item.id
            }}
          >
            {item.label}
            {item.id === 'stream' ? <span class="vc-tab__count">{props.store.events.value.length}</span> : null}
          </span>
        ))}
      </div>

      {tab.value === 'overview' ? (
        <Overview store={props.store} />
      ) : tab.value === 'stream' ? (
        <Stream store={props.store} />
      ) : tab.value === 'tools' ? (
        <Tools store={props.store} />
      ) : (
        <Artifacts store={props.store} />
      )}
    </div>
  )
}

/* ---------------------------------------------------------------- Event row */

/** One event row. Shared by Overview and Event Stream to keep the two renderings from drifting. */
function EventRow(props: { event: ConsoleEvent }) {
  return (
    <div class="vc-ev">
      <span class="vc-ev__t">{formatClock(props.event.time)}</span>
      <span class="vc-ev__sid">{props.event.sessionTitle}</span>
      <span class={kindClass(props.event)}>
        {props.event.tool === undefined ? props.event.kind : `${props.event.kind} · ${props.event.tool}`}
      </span>
      <span class="vc-ev__detail">{props.event.detail}</span>
      <span class="vc-ev__ms">{props.event.durationMs === undefined ? '—' : formatDuration(props.event.durationMs)}</span>
    </div>
  )
}

/* ------------------------------------------------------------------ Overview */

function stateLabel(value: SessionState): string {
  if (value === 'run') return 'Running'
  if (value === 'wait') return 'Awaiting approval'
  if (value === 'ok') return 'Completed'
  return 'Idle'
}

function Overview(props: { store: ConsoleStore }) {
  return (
    <div class="vc-body">
      <div class="vc-kpis">
        <div class="vc-kpi">
          <div class="vc-kpi__label">Running sessions</div>
          <div class="vc-kpi__value">{props.store.sessions.value.filter(item => item.state === 'run').length}</div>
        </div>
        <div class="vc-kpi">
          <div class="vc-kpi__label">Awaiting approval</div>
          <div class="vc-kpi__value" style="color:#f7ad31">{props.store.sessions.value.filter(item => item.state === 'wait').length}</div>
        </div>
        <div class="vc-kpi">
          <div class="vc-kpi__label">Total sessions</div>
          <div class="vc-kpi__value">{props.store.sessions.value.length}</div>
        </div>
        <div class="vc-kpi">
          <div class="vc-kpi__label">Tool calls</div>
          <div class="vc-kpi__value">{props.store.tools.value.length === 0 ? '—' : props.store.totals.value.calls}</div>
        </div>
      </div>

      <div class="vc-grid2">
        <div class="vc-card">
          <div class="vc-card__head">
            Recent events
            <span class="vc-card__hint">Live · vobs only updates the rows that change</span>
          </div>
          <div class="vc-card__body" style="padding:6px 8px 8px">
            <div class="vc-stream">
              {props.store.events.value.slice(0, 8).map(event => (
                <EventRow key={event.seq} event={event} />
              ))}
            </div>
          </div>
        </div>

        <div class="vc-card">
          <div class="vc-card__head">
            Top 5 tools
            <span class="vc-card__hint">by call count</span>
          </div>
          <div class="vc-card__body">
            {props.store.tools.value.slice(0, 5).map(stat => (
              <div class="vc-bar" key={stat.name}>
                <span class="vc-bar__name">{stat.name}</span>
                <span class="vc-bar__track">
                  <span class="vc-bar__fill" style={barWidth(stat, props.store.tools.value)} />
                </span>
                <span class="vc-bar__val">{stat.calls}</span>
              </div>
            ))}
            {props.store.tools.value.length === 0 ? (
              <div class="vc-empty">No tool-level events in the current data source.</div>
            ) : null}
          </div>
        </div>
      </div>

      <div class="vc-card">
        <div class="vc-card__head">
          Session run states
          <span class="vc-card__hint">tokens and durations come from the current data source</span>
        </div>
        <div class="vc-card__body" style="padding:8px 14px">
          <div class="vc-sessions">
            {props.store.sessions.value.map(session => (
              <div class="vc-session" key={session.id}>
                <span class={`vc-dot vc-dot--${session.state}`} />
                <span class="vc-name">{session.title}</span>
                <span class="vc-note">{stateLabel(session.state)}</span>
                <span class="vc-ev__ms">{session.tokens === 0 ? '—' : formatTokens(session.tokens)}</span>
                <span class="vc-ev__ms">{session.durationMs === 0 ? '—' : formatDuration(session.durationMs)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- Event stream */

function matchesFilter(event: ConsoleEvent, filter: string): boolean {
  if (filter === '') return true
  const haystack = `${event.kind} ${event.detail} ${event.sessionTitle} ${event.tool ?? ''}`.toLowerCase()
  return haystack.includes(filter)
}

function Stream(props: { store: ConsoleStore }) {
  const filter = state('', 'filter')

  return (
    <div class="vc-body">
      <div class="vc-toolbar">
        <input
          class="vc-input"
          placeholder="Filter events (kind / session / tool / detail)…"
          value={filter.value}
          onInput={event => {
            filter.value = (event.target as HTMLInputElement).value
          }}
        />
        <span class="vc-note">
          {props.store.paused.value
            ? `Paused · dropped ${props.store.droppedWhilePaused.value}`
            : `Buffer ${props.store.events.value.length} / 5000`}
        </span>
      </div>

      <div class="vc-card">
        <div class="vc-card__body" style="padding:6px 8px 8px">
          <div class="vc-stream">
            {props.store.events.value
              .filter(event => matchesFilter(event, filter.value))
              .slice(0, STREAM_RENDER_LIMIT)
              .map(event => (
                <EventRow key={event.seq} event={event} />
              ))}
          </div>
        </div>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------- Tool analysis */

function Tools(props: { store: ConsoleStore }) {
  /*
   * This must be a memo-derived value; `const hasTools = props.store.tools.value.length > 0`
   * directly would freeze the boolean captured at first mount — after switching to this tab
   * and waiting for tool events to arrive, the KPIs would show "—" forever (the verify script
   * missed this once, because it filled data before switching tabs).
   */
  const hasTools = memo(() => props.store.tools.value.length > 0)

  return (
    <div class="vc-body">
      <div class="vc-kpis">
        <div class="vc-kpi">
          <div class="vc-kpi__label">Total calls</div>
          <div class="vc-kpi__value">{hasTools.value ? props.store.totals.value.calls : '—'}</div>
        </div>
        <div class="vc-kpi">
          <div class="vc-kpi__label">Failed / cancelled</div>
          <div class="vc-kpi__value" style="color:#f7ad31">{hasTools.value ? props.store.totals.value.failures : '—'}</div>
        </div>
        <div class="vc-kpi">
          <div class="vc-kpi__label">Median duration</div>
          <div class="vc-kpi__value">{hasTools.value ? formatDuration(props.store.totals.value.p50) : '—'}</div>
        </div>
        <div class="vc-kpi">
          <div class="vc-kpi__label">P95 slowest</div>
          <div class="vc-kpi__value">{hasTools.value ? formatDuration(props.store.totals.value.p95) : '—'}</div>
        </div>
      </div>

      {hasTools.value ? (
        <div class="vc-card">
          <table class="vc-table">
            <thead>
              <tr>
                <th>Tool</th>
                <th class="vc-num">Calls</th>
                <th class="vc-num">Success</th>
                <th class="vc-num">P50</th>
                <th class="vc-num">P95</th>
                <th class="vc-num">Total time</th>
                <th>Trend</th>
              </tr>
            </thead>
            <tbody>
              {props.store.tools.value.map(stat => (
                <tr key={stat.name}>
                  <td class="vc-name vc-mono">{stat.name}</td>
                  <td class="vc-num">{stat.calls}</td>
                  <td class="vc-num" style={successStyle(stat)}>
                    {(((stat.calls - stat.failures) / Math.max(1, stat.calls)) * 100).toFixed(1)}%
                  </td>
                  <td class="vc-num">{formatDuration(stat.p50)}</td>
                  <td class="vc-num">{formatDuration(stat.p95)}</td>
                  <td class="vc-num">{formatDuration(stat.totalMs)}</td>
                  <td>
                    <svg class="vc-spark" width="90" height="22" viewBox="0 0 90 22">
                      <path d={buildSparkline(stat.trend, 90, 22)} fill="none" stroke="#5686fe" stroke-width="1.5" stroke-linejoin="round" />
                    </svg>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div class="vc-card">
          <div class="vc-card__head">Tool analysis unavailable</div>
          <div class="vc-card__body" style="display:grid;gap:8px">
            <div class="vc-note">
              The current data source is <strong>session-level</strong>: it reads DSH's session catalog
              (`sessions.list`) and run states (`uiSession.sessionStatus`), which contain no per-call tool data.
            </div>
            <div class="vc-note">
              Tool-level events are history inside each session; collecting them would mean calling
              <code>retain()</code> on every session and following its event stream — which DSH itself
              deliberately avoids ("opening cold sessions just to list them"). This version does not cross that line.
            </div>
            <div class="vc-note">This page is fully functional when connected to the demo data source (for previewing table and trend-line behavior).</div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ---------------------------------------------------------------- Artifacts */

function Artifacts(props: { store: ConsoleStore }) {
  return (
    <div class="vc-body">
      <div class="vc-card">
        <div class="vc-card__head">
          Deliverable timeline
          <span class="vc-card__hint">derived from write / edit / present tool events</span>
        </div>
        <div class="vc-card__body" style="padding:4px 14px">
          {props.store.events.value
            .filter(event => event.tool !== undefined && ARTIFACT_TOOLS.includes(event.tool))
            .slice(0, 60)
            .map(event => (
              <div class="vc-artifact" key={event.seq}>
                <span class="vc-artifact__icon">{(event.tool ?? '').slice(0, 3).toUpperCase()}</span>
                <span style="flex:1;min-width:0">
                  <span class="vc-artifact__name">{event.detail}</span>
                  <br />
                  <span class="vc-artifact__meta">
                    {formatClock(event.time)} · {event.sessionTitle}
                  </span>
                </span>
                <span class="vc-ev__ms">{event.durationMs === undefined ? '—' : formatDuration(event.durationMs)}</span>
              </div>
            ))}
        </div>
        {props.store.events.value.filter(event => event.tool !== undefined && ARTIFACT_TOOLS.includes(event.tool)).length === 0 ? (
          <div class="vc-empty" style="padding:14px">No artifact events yet.</div>
        ) : null}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ Utilities */

function kindClass(event: ConsoleEvent): string {
  if (event.status === 'err') return 'vc-ev__kind vc-ev__kind--err'
  if (event.status === 'warn') return 'vc-ev__kind vc-ev__kind--warn'
  return 'vc-ev__kind'
}

function barWidth(stat: ToolStat, all: readonly ToolStat[]): string {
  const max = Math.max(...all.map(item => item.calls), 1)
  return `width:${Math.round((stat.calls / max) * 100)}%`
}

function successStyle(stat: ToolStat): string {
  const rate = (stat.calls - stat.failures) / Math.max(1, stat.calls)
  if (rate >= 0.99) return 'color:#4ed17e'
  if (rate >= 0.9) return 'color:#f7ad31'
  return 'color:#f25a5a'
}
