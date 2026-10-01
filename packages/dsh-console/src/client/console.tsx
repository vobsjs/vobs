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
  { id: 'overview', label: '总览' },
  { id: 'stream', label: '事件流' },
  { id: 'tools', label: '工具分析' },
  { id: 'artifacts', label: '产物' }
] as const

type TabId = (typeof TABS)[number]['id']

/** 事件流最多渲染多少行；再多也只在内存里（环形缓冲 5000 条）。 */
const STREAM_RENDER_LIMIT = 300

const ARTIFACT_TOOLS: readonly string[] = ['write', 'edit', 'present']

export interface VobsConsoleProps {
  store: ConsoleStore
  /** 数据来源状态说明。 */
  note: ReadableSignal<string>
  /** 是否已探测到 DSH 的实时服务。 */
  live: ReadableSignal<boolean>
}

/**
 * Console 根组件。
 *
 * 组件体只执行一次；下方所有 `{…}` 都由 vobs 编译器编译成独立的 DOM binding，
 * 因此每秒几百条事件注入时，只有变化的文本节点与新增的行被触碰。
 */
export function VobsConsole(props: VobsConsoleProps) {
  const tab = state<TabId>('overview')
  const range = state<'15m' | '1h' | '24h'>('1h')

  return (
    <div class="vc">
      <div class="vc-head">
        <div>
          <div class="vc-title">
            Vobs Console
            {props.live.value ? (
              <span class="vc-badge vc-badge--live">DSH 实时数据</span>
            ) : (
              <span class="vc-badge vc-badge--demo">演示数据</span>
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
            {props.store.paused.value ? '继续' : '暂停'}
          </button>
          <button
            class="vc-btn"
            onClick={() => {
              props.store.clear()
            }}
          >
            <TrashIcon />
            清空
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

/* ---------------------------------------------------------------- 事件行 */

/** 事件行。总览与事件流共用，避免两处渲染逻辑漂移。 */
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

/* ------------------------------------------------------------------ 总览 */

function stateLabel(value: SessionState): string {
  if (value === 'run') return '运行中'
  if (value === 'wait') return '等待审批'
  if (value === 'ok') return '已完成'
  return '空闲'
}

function Overview(props: { store: ConsoleStore }) {
  return (
    <div class="vc-body">
      <div class="vc-kpis">
        <div class="vc-kpi">
          <div class="vc-kpi__label">运行中会话</div>
          <div class="vc-kpi__value">{props.store.sessions.value.filter(item => item.state === 'run').length}</div>
        </div>
        <div class="vc-kpi">
          <div class="vc-kpi__label">等待审批</div>
          <div class="vc-kpi__value" style="color:#f7ad31">{props.store.sessions.value.filter(item => item.state === 'wait').length}</div>
        </div>
        <div class="vc-kpi">
          <div class="vc-kpi__label">会话总数</div>
          <div class="vc-kpi__value">{props.store.sessions.value.length}</div>
        </div>
        <div class="vc-kpi">
          <div class="vc-kpi__label">工具调用</div>
          <div class="vc-kpi__value">{props.store.tools.value.length === 0 ? '—' : props.store.totals.value.calls}</div>
        </div>
      </div>

      <div class="vc-grid2">
        <div class="vc-card">
          <div class="vc-card__head">
            最近事件
            <span class="vc-card__hint">实时 · vobs 只更新变化的行</span>
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
            工具 Top 5
            <span class="vc-card__hint">按调用次数</span>
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
              <div class="vc-empty">当前数据源没有工具级事件。</div>
            ) : null}
          </div>
        </div>
      </div>

      <div class="vc-card">
        <div class="vc-card__head">
          会话运行态
          <span class="vc-card__hint">token 与耗时来自当前数据源</span>
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

/* ---------------------------------------------------------------- 事件流 */

function matchesFilter(event: ConsoleEvent, filter: string): boolean {
  if (filter === '') return true
  const haystack = `${event.kind} ${event.detail} ${event.sessionTitle} ${event.tool ?? ''}`.toLowerCase()
  return haystack.includes(filter)
}

function Stream(props: { store: ConsoleStore }) {
  const filter = state('')

  return (
    <div class="vc-body">
      <div class="vc-toolbar">
        <input
          class="vc-input"
          placeholder="过滤事件（类型 / 会话 / 工具 / 详情）…"
          value={filter.value}
          onInput={event => {
            filter.value = (event.target as HTMLInputElement).value
          }}
        />
        <span class="vc-note">
          {props.store.paused.value
            ? `已暂停 · 丢弃 ${props.store.droppedWhilePaused.value} 条`
            : `缓冲 ${props.store.events.value.length} / 5000`}
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

/* -------------------------------------------------------------- 工具分析 */

function Tools(props: { store: ConsoleStore }) {
  /*
   * 必须是 memo 派生，不能直接 `const hasTools = props.store.tools.value.length > 0`：
   * 组件体只执行一次，那样会把初次挂载时的布尔值冻住 —— 先切到本页、再等工具事件到达时，
   * KPI 会一直显示「—」（校验脚本之前没抓到，因为它先灌数据再切 tab）。
   */
  const hasTools = memo(() => props.store.tools.value.length > 0)

  return (
    <div class="vc-body">
      <div class="vc-kpis">
        <div class="vc-kpi">
          <div class="vc-kpi__label">总调用</div>
          <div class="vc-kpi__value">{hasTools.value ? props.store.totals.value.calls : '—'}</div>
        </div>
        <div class="vc-kpi">
          <div class="vc-kpi__label">失败 / 取消</div>
          <div class="vc-kpi__value" style="color:#f7ad31">{hasTools.value ? props.store.totals.value.failures : '—'}</div>
        </div>
        <div class="vc-kpi">
          <div class="vc-kpi__label">中位耗时</div>
          <div class="vc-kpi__value">{hasTools.value ? formatDuration(props.store.totals.value.p50) : '—'}</div>
        </div>
        <div class="vc-kpi">
          <div class="vc-kpi__label">P95 最慢</div>
          <div class="vc-kpi__value">{hasTools.value ? formatDuration(props.store.totals.value.p95) : '—'}</div>
        </div>
      </div>

      {hasTools.value ? (
        <div class="vc-card">
          <table class="vc-table">
            <thead>
              <tr>
                <th>工具</th>
                <th class="vc-num">调用</th>
                <th class="vc-num">成功率</th>
                <th class="vc-num">P50</th>
                <th class="vc-num">P95</th>
                <th class="vc-num">总耗时</th>
                <th>趋势</th>
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
          <div class="vc-card__head">工具分析暂不可用</div>
          <div class="vc-card__body" style="display:grid;gap:8px">
            <div class="vc-note">
              当前数据源是<strong>会话级</strong>的：它读的是 DSH 的会话目录（`sessions.list`）与运行状态
              （`uiSession.sessionStatus`），里面没有逐条工具调用。
            </div>
            <div class="vc-note">
              工具级事件属于会话内部的历史，要采集就得对每个会话 <code>retain()</code> 并跟随它的事件流 ——
              而 DSH 自己刻意避免「为了列表去打开冷会话」。这一版不越这条线。
            </div>
            <div class="vc-note">接演示数据源时这一页是完整的（用于预览表格与趋势线的行为）。</div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ---------------------------------------------------------------- 产物 */

function Artifacts(props: { store: ConsoleStore }) {
  return (
    <div class="vc-body">
      <div class="vc-card">
        <div class="vc-card__head">
          交付物时间线
          <span class="vc-card__hint">由写入 / 编辑 / 交付类工具事件推导</span>
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
          <div class="vc-empty" style="padding:14px">还没有产物事件。</div>
        ) : null}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ 工具函数 */

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
