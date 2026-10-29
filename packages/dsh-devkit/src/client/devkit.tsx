/**
 * Devkit panel. Five tabs:
 *   Project  · reads .vobs/check.json from the workspace (produced by vobs check --write), showing the real issue list
 *   Guardrails · explains the two patterns that fail silently (content from the implemented @vobs/vobs/dev)
 *   API      · index of APIs that really exist in the repo (every signature checked against source)
 *   Patterns · copy-ready code patterns
 *   Status   · honestly lists which capabilities are done and which are not
 *
 * vobs's two hard constraints apply here too, and were deliberately followed while writing:
 *   1. The component body executes once — all mutable state is a signal passed in from outside
 *   2. Lists must be **direct** child expressions (`{items.map(...)}`), never inside a ternary branch
 */
import { memo, type Signal } from '@vobs/vobs'
import {
  API_GROUPS,
  CAPABILITIES,
  GUARDRAIL_RULES,
  PATTERNS,
  type ApiEntry,
  type Capability
} from './catalog'
import { REPORT_PATH, type CheckDiagnostic, type ProjectState } from './project'

export type DevKitTab = 'project' | 'guardrails' | 'api' | 'patterns' | 'status'

export interface VobsDevKitProps {
  readonly tab: Signal<DevKitTab>
  readonly apiName: Signal<string>
  readonly project: Signal<ProjectState>
  readonly onRefreshProject: () => void
}

const TABS: readonly { readonly key: DevKitTab; readonly label: string }[] = [
  { key: 'project', label: 'Project' },
  { key: 'guardrails', label: 'Guardrails' },
  { key: 'api', label: 'API' },
  { key: 'patterns', label: 'Patterns' },
  { key: 'status', label: 'Status' }
]

/** One check result. */
function IssueRow(props: { readonly item: CheckDiagnostic }) {
  // props is a getter (recomputed on every read); storing it in a const is a run-once snapshot —
  // the first true positive of C118: when a keyed row is reused, its props may be swapped for a new
  // object (the report is re-read), and a snapshot would render stale content
  const item = () => props.item
  const isError = () => item().severity === 'error'
  return (
    <div class="vk-card">
      <div class="vk-card__head">
        <span class={isError() ? 'vk-sev vk-sev--err' : 'vk-sev vk-sev--warn'}>
          {isError() ? 'Error' : 'Warning'}
        </span>
        <span class="vk-mono" style="font-size:11.5px">{item().code}</span>
        <span class="vk-card__hint vk-mono">{item().file}:{item().line}:{item().column}</span>
      </div>
      <div class="vk-card__body">
        <div class="vk-desc">{item().message}</div>
        {item().snippet === undefined || item().snippet === ''
          ? null
          : <pre class="vk-code" style="margin-top:8px">{item().snippet}</pre>}
        <div class="vk-why" style="padding:9px 0 0">→ {item().fix}</div>
      </div>
    </div>
  )
}

/**
 * Project page: reads the check report from the workspace.
 *
 * The report is produced by `vobs check --write` (run by the AI or a human). The panel is
 * **read-only** — DSH's workspace-files Remote cannot write, and the panel cannot start
 * processes. When the file is missing, say what to run instead of showing an empty table.
 */
function Project(props: { readonly project: Signal<ProjectState>; readonly onRefresh: () => void }) {
  const status = memo(() => props.project.value.status)
  const message = memo(() => props.project.value.message)
  const issues = memo(() => props.project.value.report?.diagnostics ?? [])
  const summary = memo(() => {
    const report = props.project.value.report
    if (report === undefined) return undefined
    const errors = report.diagnostics.filter(item => item.severity === 'error').length
    return {
      files: report.files,
      skipped: report.skippedTests,
      errors,
      warnings: report.diagnostics.length - errors
    }
  })

  return (
    <div>
      <div class="vk-card">
        <div class="vk-card__head">
          Project checks
          <span class="vk-card__hint">reads {REPORT_PATH} from the workspace</span>
          <span class="vk-spacer" />
          <span class="vk-btn" onClick={props.onRefresh}>Refresh</span>
        </div>
        <div class="vk-card__body">
          <div class="vk-desc">{message.value}</div>

          {status.value === 'missing' ? (
            <div style="margin-top:10px">
              <div class="vk-label">Run this once (your AI or you) and the report will show up here:</div>
              <pre class="vk-code">vobs check --write</pre>
            </div>
          ) : null}

          {summary.value === undefined ? null : (
            <div class="vk-chips">
              {/* Template strings instead of `{x} files`: vobs JSX eats the whitespace before an expression */}
              <span class="vk-chip">{`${summary.value.files} files`}</span>
              <span class="vk-chip">{`${summary.value.errors} errors`}</span>
              <span class="vk-chip">{`${summary.value.warnings} warnings`}</span>
              {summary.value.skipped > 0
                ? <span class="vk-chip">{`${summary.value.skipped} test files skipped`}</span>
                : null}
            </div>
          )}
        </div>
      </div>

      {issues.value.map(item => (
        <IssueRow item={item} key={`${item.code}:${item.file}:${item.line}:${item.column}`} />
      ))}

      {status.value === 'ready' && issues.value.length === 0 ? (
        <div class="vk-card">
          <div class="vk-card__body">
            <div class="vk-empty" style="padding:6px 0">All checks passed; no issues found.</div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function findEntry(name: string): { entry: ApiEntry; origin: string } | undefined {
  for (const group of API_GROUPS) {
    const entry = group.entries.find(candidate => candidate.name === name)
    if (entry !== undefined) return { entry, origin: group.origin }
  }
  return undefined
}

/** Guardrails page: before/after comparison of the two rules. */
function Guardrails() {
  return (
    <div>
      <div class="vk-card">
        <div class="vk-card__head">
          Dev-time guardrails
          <span class="vk-card__hint">
            Report only, never interrupt — exceptions thrown inside the hooks are swallowed; that is a
            deliberate guarantee: a debugging tool must never change app behavior
          </span>
        </div>
        <div class="vk-card__body">
          <div class="vk-desc">
            Apps built with <span class="vk-mono">vobsPlugin()</span> install it automatically in dev and
            report violations to the dev server terminal and the browser console. The two patterns below
            are the easiest to get wrong in vobs — and they fail **silently** when wrong.
          </div>
        </div>
      </div>

      {GUARDRAIL_RULES.map(rule => (
        <div class="vk-card" key={rule.code}>
          <div class="vk-card__head">
            <span class="vk-sev vk-sev--err">{rule.code}</span>
            {rule.name}
          </div>
          <div class="vk-card__body">
            <div class="vk-pair">
              <div>
                <div class="vk-label">The broken pattern</div>
                <pre class="vk-code vk-code--bad">{rule.before}</pre>
              </div>
              <div>
                <div class="vk-label">Guardrail fix</div>
                <pre class="vk-code vk-code--good">{rule.after}</pre>
              </div>
            </div>
          </div>
          <div class="vk-why">{rule.why}</div>
        </div>
      ))}
    </div>
  )
}

/**
 * API detail.
 *
 * `memo` is deliberately used here to turn "the currently selected entry" into a derived value —
 * **never read a signal in the component body**: the body executes once, and anything read there
 * is the value at that moment, never updated afterwards.
 */
function ApiDetail(props: { readonly name: Signal<string> }) {
  const current = memo(() => findEntry(props.name.value))
  const related = memo(() => {
    const found = current.value
    if (found === undefined) return []
    return API_GROUPS
      .flatMap(group => group.entries)
      .filter(entry => entry.name !== found.entry.name)
      .slice(0, 4)
      .map(entry => entry.name)
  })

  return (
    <div class="vk-api__doc">
      <div class="vk-api__origin">{current.value?.origin ?? ''}</div>
      <div class="vk-sig">{current.value?.entry.signature ?? ''}</div>
      <div class="vk-desc">{current.value?.entry.summary ?? ''}</div>
      <div class="vk-label" style="margin-top:14px">Example</div>
      <pre class="vk-code">{current.value?.entry.example ?? ''}</pre>
      <div class="vk-chips">
        {related.value.map(name => (
          <span class="vk-chip" key={name} onClick={() => { props.name.value = name }}>
            {name}
          </span>
        ))}
      </div>
    </div>
  )
}

/** API page: group tree on the left + detail on the right. */
function ApiIndex(props: { readonly apiName: Signal<string> }) {
  return (
    <div class="vk-api">
      <div class="vk-api__nav">
        {API_GROUPS.map(group => (
          <div key={group.group}>
            <div class="vk-api__group">{group.group}</div>
            {group.entries.map(entry => (
              <div
                class={entry.name === props.apiName.value ? 'vk-api__item vk-api__item--active' : 'vk-api__item'}
                key={entry.name}
                onClick={() => { props.apiName.value = entry.name }}
              >
                {entry.name}
              </div>
            ))}
          </div>
        ))}
      </div>
      <ApiDetail name={props.apiName} />
    </div>
  )
}

/** Patterns page: copy-ready code patterns. */
function Patterns() {
  return (
    <div>
      <div class="vk-card">
        <div class="vk-card__head">
          Code patterns
          <span class="vk-card__hint">copy-ready · deliberately "patterns" rather than a repo file index, which would drift as the directory changes</span>
        </div>
      </div>
      <div class="vk-patterns" style="margin-top:12px">
        {PATTERNS.map(pattern => (
          <div class="vk-pattern" key={pattern.title}>
            <div class="vk-pattern__title">{pattern.title}</div>
            <div class="vk-pattern__summary">{pattern.summary}</div>
            <pre class="vk-code">{pattern.code}</pre>
          </div>
        ))}
      </div>
    </div>
  )
}

const STATUS_LABEL: Record<Capability['status'], string> = {
  done: 'Done',
  partial: 'Partial',
  todo: 'Not yet'
}

const STATUS_CLASS: Record<Capability['status'], string> = {
  done: 'vk-sev vk-sev--ok',
  partial: 'vk-sev vk-sev--warn',
  todo: 'vk-sev vk-sev--dim'
}

/** Status page: honestly lists capability boundaries. */
function Status() {
  return (
    <div>
      <div class="vk-card">
        <div class="vk-card__head">
          Capability status
          <span class="vk-card__hint">this page is deliberately honest — the panel must not pretend to have everything</span>
        </div>
        <div class="vk-card__body">
          {CAPABILITIES.map(capability => (
            <div class="vk-cap" key={capability.name}>
              <span class={STATUS_CLASS[capability.status]}>{STATUS_LABEL[capability.status]}</span>
              <span class="vk-cap__name">{capability.name}</span>
              <span class="vk-cap__note">{capability.note}</span>
            </div>
          ))}
        </div>
      </div>

      <div class="vk-card">
        <div class="vk-card__head">Why this panel is static</div>
        <div class="vk-card__body">
          <div class="vk-desc">
            The devkit runs inside DSH while your app runs in its own dev server — <strong>they are not
            the same page</strong>. So the panel cannot see your app's runtime (including runtime-guardrail
            warnings). Showing live data requires wiring up DSH's Host side (reading the workspace, running
            vobs check); that step has not been done yet.
          </div>
        </div>
      </div>
    </div>
  )
}

export function VobsDevKit(props: VobsDevKitProps) {
  return (
    <div class="vk-root">
      <div class="vk-head">
        <div>
          <div class="vk-title">
            Vobs Devkit
            <span class="vk-tag">rendered by vobs</span>
          </div>
          <div class="vk-sub">
            A reference panel for "people who write vobs code" and "AIs that help write vobs code":
            guardrail rules, an API index, copy-ready patterns, and the toolchain's current capability
            boundaries.
          </div>
        </div>
      </div>

      <div class="vk-tabs">
        {TABS.map(item => (
          <div
            class={item.key === props.tab.value ? 'vk-tab vk-tab--active' : 'vk-tab'}
            key={item.key}
            onClick={() => { props.tab.value = item.key }}
          >
            {item.label}
          </div>
        ))}
      </div>

      <div class="vk-body">
        {props.tab.value === 'project' ? <Project project={props.project} onRefresh={props.onRefreshProject} /> : null}
        {props.tab.value === 'guardrails' ? <Guardrails /> : null}
        {props.tab.value === 'api' ? <ApiIndex apiName={props.apiName} /> : null}
        {props.tab.value === 'patterns' ? <Patterns /> : null}
        {props.tab.value === 'status' ? <Status /> : null}
      </div>
    </div>
  )
}
