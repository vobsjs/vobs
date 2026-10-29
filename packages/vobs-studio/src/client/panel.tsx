/**
 * Vobs Studio panel — full-page main area.
 *
 * The component body executes exactly once; every dynamic `{…}` is a subscription
 * position, so updates never re-run this function. All state lives in `store.ts`.
 *
 * Discipline applied here (each of these is a real diagnostic, not style):
 * - no `const s = studioState.value` snapshots in the body (C118) — read `.value`
 *   inside JSX dynamic expressions so each read position subscribes;
 * - derived values used across several bindings go through `memo`, not body reads;
 * - the selection-fixer is `effect(on([studioState], …))` with everything untracked
 *   inside — declared deps only, no read+write self-subscription (C210).
 */
import { effect, memo, on, untrack } from '@vobs/vobs'
import { pageUrl, type PreviewPage } from './manifest'
import { activePageId, refreshStudio, studioState } from './store'

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
      {studioState.value.status === 'error' ? <p class="studio__error">{studioState.value.message}</p> : null}
    </div>
  )
}

/**
 * First-run guidance, shown whenever the preview manifest has never been produced.
 * This panel is the only surface a fresh install guarantees the user will open — so the
 * setup steps live HERE, not only in the repository docs.
 */
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
          of app, which pages, what content. The agent pulls the design contract, scaffolds
          the project, self-checks every snippet and builds it.
        </li>
        <li>
          <b>Watch the pages appear here</b> — the panel refreshes automatically after each
          build. Iterate by describing changes ("make the hero smaller"); "Open in browser"
          shows the same preview full-size.
        </li>
      </ol>
    </div>
  )
}

function PageList() {
  return (
    <nav class="studio__pages">
      {(studioState.value.manifest?.pages ?? []).map((page: PreviewPage) => (
        <button
          class="studio__page"
          data-active={activePageId.value === page.id}
          onClick={() => {
            activePageId.value = page.id
          }}
        >
          <span>{page.title || page.id}</span>
          {page.route ? <span class="studio__page-route">{page.route}</span> : null}
        </button>
      ))}
    </nav>
  )
}

function Viewport() {
  const view = memo(() => {
    const s = studioState.value
    const active = (s.manifest?.pages ?? []).find((p: PreviewPage) => p.id === activePageId.value)
    return {
      url: active === undefined ? undefined : pageUrl(s.manifest, active),
      title: active?.title ?? 'preview'
    }
  })
  return (
    <div class="studio__viewport">
      {view.value.url !== undefined
        ? <iframe class="studio__frame" src={view.value.url} title={view.value.title} />
        : <StatusNotice />}
    </div>
  )
}

function Aside() {
  return (
    <aside class="studio__aside">
      <h3>Project</h3>
      <div class="studio__file">{studioState.value.manifest?.project?.name ?? '—'}</div>
      <h3 style={{ 'margin-top': '14px' }}>Files</h3>
      {(studioState.value.manifest?.pages ?? []).map((page: PreviewPage) => (
        <div class="studio__file">{page.file}</div>
      ))}
      <p style={{ 'margin-top': '14px' }}>
        The full file tree lands with the workspace service in the next milestone.
      </p>
    </aside>
  )
}

export function Studio() {
  // Keep the selection valid as the manifest changes: pick the first page when the
  // current id no longer exists. The only tracked dep is studioState; everything inside
  // is untracked, so writes to activePageId never subscribe this effect (no C210).
  effect(on([studioState], () => {
    untrack(() => {
      const pages = studioState.value.manifest?.pages ?? []
      if (pages.length === 0) return
      const id = activePageId.value
      if (id === '' || !pages.some((p: PreviewPage) => p.id === id)) {
        activePageId.value = pages[0]?.id ?? ''
      }
    })
  }))

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
        <button
          class="studio__btn"
          disabled={!(studioState.value.status === 'ready' && (studioState.value.manifest?.server?.origin ?? '') !== '')}
          onClick={() => {
            const s = studioState.value
            const pages = s.manifest?.pages ?? []
            const active = pages.find((p: PreviewPage) => p.id === activePageId.value)
            const url = active === undefined ? s.manifest?.server?.origin : pageUrl(s.manifest, active)
            if (typeof url === 'string') window.open(url, '_blank')
          }}
        >
          Open in browser
        </button>
      </header>
      <div class="studio__body">
        <aside class="studio__rail">
          <div class="studio__rail-head">Pages</div>
          {studioState.value.status === 'ready' ? <PageList /> : null}
        </aside>
        <main class="studio__main">
          <Viewport />
        </main>
        <Aside />
      </div>
    </div>
  )
}
