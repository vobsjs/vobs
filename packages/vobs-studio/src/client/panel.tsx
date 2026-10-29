/**
 * Vobs Studio panel — the generation WORKFLOW-STATUS page.
 *
 * Product shape (owner call): the panel carries only what DSH does not have natively —
 * build status, the page list with open links, and the design-direction card (DESIGN.md
 * rendered). Source browsing belongs to DSH's built-in sidebar; page rendering to DSH's
 * browser. One column, minimal reads: manifest per poll, DESIGN.md only on version
 * changes.
 *
 * Discipline: the body executes exactly once; every dynamic `{…}` is a subscription
 * position. Missing/error states surface the Host's real error text (diagnostics).
 */
import { memo } from '@vobs/vobs'
import { pageUrl, type PreviewPage } from './manifest'
import { refreshStudio, studioState } from './store'

function StatusNotice() {
  return (
    <div class="studio__placeholder">
      <h2>
        {studioState.value.status === 'missing'
          ? 'Getting started'
          : studioState.value.status === 'error'
            ? 'Preview manifest error'
            : 'Vobs Studio'}
      </h2>
      {studioState.value.workspace ? <p>Workspace: <code>{studioState.value.workspace}</code></p> : null}
      {studioState.value.status === 'missing' ? <SetupSteps /> : <p>{studioState.value.message}</p>}
      {studioState.value.diagnostic ? <p class="studio__diag">{studioState.value.diagnostic}</p> : null}
      {studioState.value.status === 'error' ? <p class="studio__error">{studioState.value.message}</p> : null}
    </div>
  )
}

/** First-run guidance — the only surface a fresh install guarantees the user will open. */
function SetupSteps() {
  return (
    <div class="studio__steps">
      <p class="studio__steps-hint">One-time setup, then just chat:</p>
      <ol>
        <li>
          <b>The Studio tools are already connected</b> — installing this plugin also
          registers its MCP server (design contract / scaffold / self-check / preview
          build) with the harness. If the agent doesn't use them, restart DSH once: the
          registration is a patch, applied at startup. On an older install (or a manual
          setup), point the session's MCP config at:
          <code>…/node_modules/dsh-plugin-vobs-studio/mcp/index.mjs</code>
        </li>
        <li>
          <b>Describe what you want in the chat</b> — plain language is enough: what kind
          of app, which pages, what content. The agent pulls the design contract, states
          the design direction (DESIGN.md), scaffolds the project, self-checks every
          snippet and builds it.
        </li>
        <li>
          <b>Open the pages from the chat</b> — the agent posts a preview URL after each
          build; DSH's browser renders it. This panel follows with the build status, the
          page list and the design direction.
        </li>
      </ol>
    </div>
  )
}

function BuildStatus() {
  const view = memo(() => {
    const s = studioState.value
    return { pages: s.manifest?.pages ?? [], version: s.manifest?.version ?? 0, origin: s.manifest?.server?.origin ?? '' }
  })
  return (
    <div class="studio__status">
      <span class="studio__status-dot" />
      <span class="studio__status-text">
        Ready · {view.value.pages.length} page(s) · build v{view.value.version}
      </span>
      <button
        class="studio__btn"
        title="Copy the preview origin"
        onClick={() => {
          void navigator.clipboard?.writeText(view.value.origin).catch(() => {})
        }}
      >
        Copy URL
      </button>
    </div>
  )
}

function PageList() {
  return (
    <div class="studio__pages">
      {(studioState.value.manifest?.pages ?? []).map((page: PreviewPage) => (
        <button
          class="studio__page-btn"
          onClick={() => {
            const url = pageUrl(studioState.value.manifest, page)
            if (typeof url === 'string') window.open(url, '_blank')
          }}
        >
          <span>{page.title || page.id}</span>
          <span class="studio__page-route">{page.route}</span>
        </button>
      ))}
    </div>
  )
}

/** DESIGN.md rendered lightly: '## ' headings, '- ' bullets, **bold** stripped to <b>. */
function DesignCard() {
  const view = memo(() => {
    const s = studioState.value
    return { text: s.designMdText, note: s.designMdNote }
  })
  const lines = (view.value.text ?? '').split('\n')
  const clean = (line: string): string => line.replace(/\*\*([^*]+)\*\*/gu, '$1')
  return (
    <section class="studio__design">
      <h3>设计方向 <span class="studio__design-src">DESIGN.md</span></h3>
      {view.value.text === undefined ? (
        <p class="studio__design-note">{view.value.note ?? 'Not written yet.'}</p>
      ) : (
        <div class="studio__design-body">
          {lines.map((line, index) => {
            const trimmed = clean(line).trim()
            if (trimmed === '') return <div class="studio__design-spacer" key={index} />
            if (trimmed.startsWith('## ')) return <h4 key={index}>{trimmed.slice(3)}</h4>
            if (trimmed.startsWith('### ')) return <h5 key={index}>{trimmed.slice(4)}</h5>
            if (trimmed.startsWith('- ') || /^\d+\.\s/u.test(trimmed)) {
              return <div class="studio__design-li" key={index}>{trimmed.replace(/^[-]\s*/u, '').replace(/^\d+\.\s*/u, '')}</div>
            }
            return <p key={index}>{trimmed}</p>
          })}
        </div>
      )}
    </section>
  )
}

export function Studio() {
  return (
    <div class="studio">
      <header class="studio__head">
        <span class="studio__brand">Vobs Studio</span>
        <span class="studio__tag">AI Build</span>
        <span class="studio__ws">{studioState.value.workspace ?? ''}</span>
        <button
          class="studio__btn"
          onClick={() => {
            refreshStudio()
          }}
        >
          Refresh
        </button>
      </header>
      <main class="studio__main">
        {studioState.value.status === 'ready' ? (
          <div class="studio__flow">
            <BuildStatus />
            <PageList />
            <DesignCard />
          </div>
        ) : (
          <StatusNotice />
        )}
      </main>
    </div>
  )
}
