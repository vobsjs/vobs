/**
 * Vobs Studio panel — two-zone source browser: project tree (left) + code viewer (right).
 *
 * The component body executes exactly once; every dynamic `{…}` is a subscription
 * position, so updates never re-run this function. All state lives in `store.ts`.
 *
 * Product shape (owner call): no preview duplication — pages open in DSH's browser via
 * the chat link; this panel is for source review. The missing/error card surfaces the
 * Host's real error text (diagnostics) so field failures are never silent again.
 */
import { effect, memo, on, untrack } from '@vobs/vobs'
import { studioState, sourceBrowserOf } from './store'
import { buildTree, type TreeNode } from './source'

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
          of app, which pages, what content. The agent pulls the design contract, states
          the design direction (DESIGN.md), scaffolds the project, self-checks every
          snippet and builds it.
        </li>
        <li>
          <b>Open the pages from the chat</b> — the agent posts a preview URL after each
          build; DSH's browser renders it (and "Open in browser" style links reach your
          default browser). This panel follows with the source tree and code.
        </li>
      </ol>
    </div>
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

function SourceTree() {
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

export function Studio() {
  // Auto-load the project root once the manifest is ready, so the tree is populated
  // without a click. The only tracked dep is studioState; all writes are untracked (no
  // C210 self-subscription).
  effect(on([studioState], () => {
    untrack(() => {
      const browser = sourceBrowserOf()
      const s = browser.state.value
      const projectDir = String(studioState.value.manifest?.project?.dir ?? '')
      if (studioState.value.status !== 'ready' || projectDir === '') return
      if (s.projectDir !== projectDir) {
        browser.reset()
        browser.state.value = { ...browser.state.value, status: 'loading', projectDir }
      }
      if (browser.state.value.dirs[''] === undefined) {
        browser.state.value = { ...browser.state.value, expanded: [...browser.state.value.expanded, ''] }
        void browser.listDir('')
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
            sourceBrowserOf().listDir('')
          }}
        >
          Refresh
        </button>
      </header>
      <div class="studio__body">
        <aside class="studio__rail">
          <SourceTree />
        </aside>
        <main class="studio__main">
          {studioState.value.status === 'ready' ? <CodeViewer /> : <StatusNotice />}
        </main>
      </div>
    </div>
  )
}
