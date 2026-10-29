# Vobs Studio

**AI-built vobs + Tailwind pages, inside [DeepSeek Harness](https://github.com/deepseek-ai) (DSH).**
The user describes what they want in the DSH agent chat; the agent designs and generates a
vobs+Tailwind multi-page project using the design contract, self-checks every snippet before
writing it, and the Studio panel previews every generated page live — files stay local.

One of the [DSH plugin family](../../docs/dsh.md) (Console / DevKit / Studio).

## How it works

```
user requirement (DSH chat)
  → agent designs (design_contract: rules + tokens + @vobs/ui + principles — no templates)
  → design_scaffold: neutral project baseline (pinned @vobs deps, MPA build, tokens)
  → agent writes pages · design_check: VOBS_C* self-check before every write
  → design_preview_build: vite build → dist served on 127.0.0.1 (SSE live-reload)
                          → .vobs/studio/preview.json manifest
  → Studio panel: page rail + per-page iframe preview + open in browser
  → "change X" → regenerate → incremental rebuild → auto-refresh
```

Layout and architecture are the **agent's decision** — the contract provides constraints
(framework rules, token mapping, component inventory, design principles, forbidden list),
never page templates.

## The MCP server

`mcp/index.mjs` is a zero-shell stdio MCP server (same newline-delimited transport as
`vobs mcp`). Register it in the session's `mcpServers`:

```json
{ "command": "node", "args": ["<plugin-dir>/mcp/index.mjs"] }
```

| Tool | Purpose |
| --- | --- |
| `design_contract` | The design contract, by section (rules / tokens / components / principles / pages / preview / forbidden) |
| `design_scaffold` | Write the neutral project baseline into the workspace (once per project) |
| `design_check` | Static-check a snippet against all VOBS_C\* diagnostics before writing it |
| `design_preview_build` | Build, serve `dist/` on `127.0.0.1:<port>` with live-reload, write the preview manifest (skipped when sources are unchanged) |

The panel (`tool.call.toolview` rows) renders these calls as structured cards inside the
conversation: running pulse → done, input summary, expandable output.

## The preview panel

Full-page panel in the `main` slot (sidebar entry **Vobs Studio**). It reads
`.vobs/studio/preview.json` from the session workspace via DSH's read-only
`remote.workspaceFiles` (polled, version-compared):

```json
{
  "version": 1,
  "server": { "origin": "http://127.0.0.1:5218" },
  "project": { "name": "my-app", "dir": "my-app" },
  "pages": [{ "id": "home", "title": "Home", "route": "/pages/home.html", "file": "my-app/dist/pages/home.html" }]
}
```

You never write this by hand — `design_preview_build` does. "Open in browser" points at the
same static server; the served HTML carries a one-line EventSource reload script, so DSH and
the system browser stay in sync.

## Install

See [docs/dsh.md](../../docs/dsh.md) (plugin page / CLI / local path). The plugin ships its
`lib/` build output — DSH never builds at install time.

## Verify

```bash
pnpm build:packages && pnpm build:dsh
pnpm --filter dsh-plugin-vobs-studio verify   # 33 artifact checks (jsdom, fake DSH services)
```

The acceptance script runs the **built artifact** against DSH's client module protocol:
manifest → panel ready → page switching → iframe src → cleanup, plus the four toolview
registrations.

## Known limitations

- The toolview props contract (`{ t, phase, callId, block, inspect }`) is reverse-engineered
  from official DSH bundles — all reads are defensive; see [docs/dsh.md](../../docs/dsh.md).
- The MCP server's `@vobs/compiler` dependency is pinned; `design_check` covers the static
  C-diagnostics, not TypeScript type errors.
- The panel polls the manifest (2.5s) rather than subscribing — DSH's `changes()` stream was
  not verified against a live install at the time of writing.
