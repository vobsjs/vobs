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
import { activePageId, railMode, refreshStudio, serverNoticeDismissed, sourceBrowserOf, studioState } from './store'
import { buildTree, type TreeNode } from './source'

/**
 * Shown while ready: the static preview server binds on each `design_preview_build`
 * and does not survive a DSH restart, so "ready + blank frames" needs its explanation
 * inside the panel (dismissable — it is a session-lifetime reminder, not an error).
 */
function ServerNotice() {
  return (
    <div class="studio__notice">
      <span>
        Frames blank? The preview server is per-session — ask the agent to re-run{' '}
        <code>design_preview_build</code> to restart it.
      </span>
      <button
        class="studio__notice-x"
        title="Dismiss"
        onClick={() => {
          serverNoticeDismissed.value = true
        }}
      >
        ×
      </button>
    </div>
  )
}

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

/** One recursive tree row; expansion state lives in the source browser's signals. */
function TreeRows(nodes: readonly TreeNode[], depth: number): unknown {
  return nodes.map(node => {
    const browser = sourceBrowserOf()
    const expanded = browser.state.value.expanded.includes(node.relPath)
    return (
      <div>
        <button
          class="studio__tree-row"
          style={{ 'padding-left': `${8 + depth * 14}px` }}
          data-active={browser.state.value.openPath === node.relPath && !node.isDir}
          onClick={() => {
            if (node.isDir) browser.toggleDir(node.relPath)
            else void browser.openFile(node.relPath)
          }}
        >
          <span class="studio__tree-chevron">{node.isDir ? (expanded ? '▾' : '▸') : ''}</span>
          <span>{node.name}</span>
        </button>
        {node.isDir && expanded ? TreeRows(node.children, depth + 1) : null}
      </div>
    )
  })
}

function SourceBrowserPane() {
  const browser = sourceBrowserOf()
  const view = memo(() => {
    const s = browser.state.value
    const projectDir = String(studioState.value.manifest?.project?.dir ?? '')
    if (projectDir === '') return { kind: 'empty' as const }
    if (s.status === 'error') return { kind: 'error' as const, message: s.message }
    const tree = buildTree(s.dirs, '')
    const rootLoaded = s.dirs[''] !== undefined
    return { kind: 'ready' as const, tree, rootLoaded, open: s, projectDir }
  })
  return (
    <div class="studio__tree">
      {view.value.kind === 'empty' ? (
        <p class="studio__tree-hint">Generate a project first — the tree follows the manifest's project dir.</p>
      ) : view.value.kind === 'error' ? (
        <p class="studio__tree-hint">{view.value.message}</p>
      ) : (
        <div class="studio__tree-scroll">
          <button
            class="studio__tree-row"
            data-active={view.value.open.openPath === ''}
            onClick={() => {
              browser.toggleDir('')
            }}
          >
            <span class="studio__tree-chevron">{view.value.rootLoaded ? '▾' : '▸'}</span>
            <span>{view.value.projectDir}</span>
          </button>
          {view.value.rootLoaded ? TreeRows(view.value.tree, 1) : null}
        </div>
      )}
    </div>
  )
}

function CodeViewer() {
  const browser = sourceBrowserOf()
  const view = memo(() => {
    const s = browser.state.value
    return { path: s.openPath, state: s.openState, text: s.openText }
  })
  return (
    <div class="studio__code">
      <div class="studio__code-head">
        <code>{view.value.path === '' ? 'select a file in the tree' : view.value.path}</code>
      </div>
      {view.value.state === 'loading' ? <p class="studio__code-status">Loading…</p> : null}
      {view.value.state === 'error' ? <p class="studio__code-status">{view.value.text}</p> : null}
      {view.value.state === 'ok' ? <pre class="studio__code-body"><code>{view.value.text}</code></pre> : null}
    </div>
  )
}

/** Left rail: Pages (rendered previews) vs Files (project source tree). */
function RailSwitch() {
  return (
    <div class="studio__tabs">
      <button
        class="studio__tab"
        data-active={railMode.value === 'pages'}
        onClick={() => {
          railMode.value = 'pages'
        }}
      >
        Pages
      </button>
      <button
        class="studio__tab"
        data-active={railMode.value === 'files'}
        onClick={() => {
          railMode.value = 'files'
          const browser = sourceBrowserOf()
          if (browser.state.value.status === 'off' && studioState.value.manifest?.project?.dir) {
            browser.state.value = { ...browser.state.value, status: 'loading', projectDir: studioState.value.manifest.project.dir }
            void browser.listDir('')
          }
        }}
      >
        Files
      </button>
    </div>
  )
}

/**
 * Pages mode: the panel does NOT duplicate the rendered preview — DSH's browser opens
 * the page (chat link or the buttons here, `window.open`), so one preview lives in one
 * place. The rail keeps page switching, the launcher makes each page one click away.
 */
function PageLauncher() {
  const view = memo(() => {
    const s = studioState.value
    return { pages: s.manifest?.pages ?? [], ready: s.status === 'ready' }
  })
  return (
    <div class="studio__launch">
      <p class="studio__launch-hint">
        Preview opens in DSH's browser (also via the link the agent posts after each build).
      </p>
      {view.value.pages.map((page: PreviewPage) => (
        <button
          class="studio__launch-page"
          onClick={() => {
            const url = pageUrl(studioState.value.manifest, page)
            if (typeof url === 'string') window.open(url, '_blank')
          }}
        >
          <span>{page.title || page.id}</span>
          {page.route ? <span class="studio__page-route">{page.route}</span> : null}
        </button>
      ))}
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
      <p style={{ 'margin-top': '14px' }}>Switch the rail to Files to browse the project source.</p>
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
      {studioState.value.status === 'ready' && !serverNoticeDismissed.value ? <ServerNotice /> : null}
      <div class="studio__body">
        <aside class="studio__rail">
          <div class="studio__rail-head">
            <RailSwitch />
          </div>
          {railMode.value === 'pages' ? (
            studioState.value.status === 'ready' ? <PageList /> : null
          ) : (
            <SourceBrowserPane />
          )}
        </aside>
        <main class="studio__main">
          {railMode.value === 'files' ? (
            <CodeViewer />
          ) : studioState.value.status === 'ready' ? (
            <PageLauncher />
          ) : (
            <StatusNotice />
          )}
        </main>
        <Aside />
      </div>
    </div>
  )
}
