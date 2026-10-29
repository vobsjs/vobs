/**
 * In-chat toolview rows for the Studio MCP tools (slot `tool.call.toolview`, key = tool name).
 *
 * Props contract (reverse-engineered from the official rows in DSH's client bundles):
 * `{ t, phase, callId, block, inspect, ...injected }` — `phase` is "preparing" before the
 * call settles; `block` carries `argsRaw` while running and `call.argsRaw` (+ result
 * fields) once settled. Every read is defensive: the contract is unofficial and may drift.
 */
import type { VobsNode } from '@vobs/vobs'

const TOOL_LABELS: Record<string, string> = {
  design_contract: 'Design contract',
  design_scaffold: 'Scaffold project',
  design_check: 'Self-check snippet',
  design_preview_build: 'Build & preview'
}

/** Tool-specific one-line summary from the parsed input args. */
function summarizeInput(tool: string, args: Record<string, unknown>): string {
  const dir = typeof args.dir === 'string' ? args.dir : undefined
  if (tool === 'design_scaffold' || tool === 'design_preview_build') return dir ?? ''
  if (tool === 'design_check') {
    const filename = typeof args.filename === 'string' ? args.filename : 'snippet.tsx'
    const size = typeof args.code === 'string' ? `${args.code.split('\n').length} lines` : ''
    return `${filename}${size !== '' ? ` · ${size}` : ''}`
  }
  return ''
}

interface ParsedCall {
  readonly settled: boolean
  readonly args: Record<string, unknown>
  readonly outputText: string
}

function parseBlock(block: unknown): ParsedCall {
  const fallback: ParsedCall = { settled: false, args: {}, outputText: '' }
  if (block === null || typeof block !== 'object') return fallback
  const b = block as Record<string, unknown>
  const settled = typeof b.kind === 'string'
  const call = (settled && b.call !== null && typeof b.call === 'object' ? b.call : b) as Record<string, unknown>
  let args: Record<string, unknown> = {}
  try {
    const parsed: unknown = JSON.parse(typeof call.argsRaw === 'string' && call.argsRaw !== '' ? call.argsRaw : '{}')
    if (parsed !== null && typeof parsed === 'object') args = parsed as Record<string, unknown>
  } catch {
    args = {}
  }
  const rawOutput = call.output ?? call.result
  const outputText = typeof rawOutput === 'string'
    ? rawOutput
    : rawOutput !== null && rawOutput !== undefined && typeof rawOutput === 'object'
      ? JSON.stringify(rawOutput)
      : ''
  return { settled, args, outputText }
}

function Row(props: () => Record<string, unknown>): VobsNode {
  const p = props()
  const tool = typeof p.key === 'string' ? p.key : typeof p.tool === 'string' ? p.tool : ''
  const label = TOOL_LABELS[tool] ?? tool
  const preparing = p.phase === 'preparing'
  const call = parseBlock(p.block)
  const summary = summarizeInput(tool, call.args)
  const stateLabel = preparing ? 'running' : 'done'

  return (
    <div class="studio-row" data-tool={tool} data-state={stateLabel}>
      <span class="studio-row__dot" />
      <span class="studio-row__title">{label}</span>
      {summary !== '' ? <span class="studio-row__summary">{summary}</span> : null}
      <span class="studio-row__state">{preparing ? 'running…' : 'done'}</span>
      {call.outputText !== '' ? (
        <details class="studio-row__details">
          <summary>output</summary>
          <pre>{call.outputText.slice(0, 2000)}</pre>
        </details>
      ) : null}
    </div>
  )
}

export const TOOLVIEW_TOOLS = Object.keys(TOOL_LABELS)

export { Row as studioToolRow }

export const TOOLVIEW_CSS = `
.studio-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border: 1px solid var(--dsw-border-color, rgba(127,127,127,.25));
  border-radius: 8px;
  background: var(--dsw-bg-elevated, transparent);
  font: 400 12px/1.4 var(--dsw-font-family, -apple-system, "Segoe UI", sans-serif);
  color: var(--dsw-text-primary, inherit);
  max-width: 100%;
}
.studio-row__dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--dsw-text-tertiary, #8f8f96);
}
.studio-row[data-state="running"] .studio-row__dot {
  background: var(--dsw-brand-primary, #4d6bfe);
  animation: studio-row-pulse 1.1s ease-in-out infinite;
}
.studio-row__title { font-weight: 600; flex: none; }
.studio-row__summary {
  color: var(--dsw-text-tertiary, #8f8f96);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.studio-row__state { margin-left: auto; flex: none; color: var(--dsw-text-tertiary, #8f8f96); font-size: 11px; }
.studio-row__details { min-width: 0; flex-basis: 100%; }
.studio-row__details summary { cursor: pointer; color: var(--dsw-text-tertiary, #8f8f96); font-size: 11px; }
.studio-row__details pre {
  margin: 6px 0 0;
  padding: 8px;
  border-radius: 6px;
  background: var(--dsw-bg-color, rgba(127,127,127,.08));
  overflow: auto;
  max-height: 180px;
  font: 400 11px/1.5 ui-monospace, Consolas, monospace;
  white-space: pre-wrap;
}
@keyframes studio-row-pulse { 50% { opacity: .35; } }
`
