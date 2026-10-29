# DSH plugins

vobs can be used to write client plugins for [DeepSeek Harness](https://github.com/deepseek-ai). The repository contains **one toolchain + four plugin packages**:

| Package | Purpose |
| --- | --- |
| [`@vobs/dsh`](../packages/dsh) | Runtime adapter (`defineDshPlugin` / `defineDshOverlay` / `defineDshPanel` / `createVobsPropsSlotHost`) + `dshBundle()` to build plugins + `@vobs/dsh/preview` local preview runtime |
| [`@vobs/cli`](../packages/cli) | The `vobs dsh init / dev / build / check / install` command group and the plugin template; also `vobs check` static source checks |
| [`packages/dsh-plugin`](../packages/dsh-plugin) | The minimal working plugin (overlay), also the reference implementation for "vobs → DSH" |
| [`packages/dsh-console`](../packages/dsh-console) | **Vobs Console**: a multi-session real-time cockpit registered into the `main` slot (overview / event stream / tool analysis / artifacts) |
| [`packages/dsh-devkit`](../packages/dsh-devkit) | **Vobs DevKit**: project checks (reads `.vobs/check.json`) / guardrails / API / examples / status |
| [`packages/vobs-studio`](../packages/vobs-studio) | **Vobs Studio**: AI-built vobs+Tailwind projects — an MCP server (design contract / scaffold / static self-check / build+serve) plus a full-page preview panel and in-chat toolview rows |

These four `dsh-plugin*` packages share the repository-wide lockstep version with the rest, but are **not published to npm** — they are distributed via Git tags or commits + the `#path:` subdirectory.

## How users install

### Option 1: the DSH plugin page (recommended)

Sidebar → **Plugins** → **Add plugin**. The dialog accepts **a package name, a Git URL, a tarball, or a local absolute path**. Paste:

```text
github:vobsjs/vobs#<ref>&path:/packages/dsh-console
github:vobsjs/vobs#<ref>&path:/packages/dsh-devkit
github:vobsjs/vobs#<ref>&path:/packages/vobs-studio
```

The Host first reads what the spec points to before running pnpm (you can see the pnpm output). After installing you **must turn the plugin's switch on**, then **quit DSH completely and reopen it**. Only one can be installed at a time.

### Option 2: the command line

```bash
dsh plugin --profile <profile> add "github:vobsjs/vobs#<ref>&path:/packages/dsh-devkit"
```

Or use the bundled CLI (it handles the Windows problem where `&` is treated as a command separator for you, and warns on pnpm < 11):

```bash
vobs dsh install --repo vobsjs/vobs --tag <ref> --subpath /packages/dsh-devkit --profile <profile>
```

### Option 3: a local directory (fastest while iterating on these two panels)

The plugin page's Add plugin also accepts **an absolute local path**. pnpm installs a link, so after editing the source, run `pnpm build:dsh` to rebuild and restart DSH — no need to push to GitHub:

```text
C:\path\to\vobs\packages\dsh-devkit
```

### Which `<ref>` to use

A tag or a commit SHA both work. **The repository does not yet have a tag that contains all fixes for both panels**, so for now use a commit SHA:

```bash
git rev-parse main     # get the current SHA, paste it into <ref> above
```

Once a version tag is cut, it can be written as `#v1.8.0`.

## Two pitfalls you must know

1. **Do not install with `pnpm add`.** The `&path:` subdirectory syntax requires **pnpm ≥ 11**; pnpm 10 **silently ignores** it and installs the entire monorepo root instead of the target subpackage. The DSH plugin page and `dsh plugin` use DSH's built-in pnpm 11.
2. **The DevKit's "Project" page needs data**: it reads `.vobs/check.json` from the workspace, produced by `vobs check --write` (when the file is absent, the panel honestly tells you what to run). The other pages are static content baked in at build time and are viewable right after install.
3. **Vobs Studio registers its MCP server itself** (v1.8.0+): the plugin's `cordis.patch.yml` carries a second insert that registers the Studio MCP server (`serverName: vobs-studio`) with the harness, so installing the plugin is the only setup step. On older versions — or a manual setup — add `node <plugin-dir>/mcp/index.mjs` (stdio) to the session's `mcpServers`. The panel reads `.vobs/studio/preview.json`, written by `design_preview_build`.

## Using Vobs Studio (after install)

The Studio panel itself walks first-time users through these steps (they are shown
on its "Getting started" screen), but the short version:

1. **The tools are already connected** — the plugin patch registered the Studio MCP
   server with the harness at install time. If the agent doesn't use the `design_*`
   tools, restart DSH once: the registration is a patch, applied at startup. On an
   older install, point the session's MCP config at
   `…/node_modules/dsh-plugin-vobs-studio/mcp/index.mjs` manually.
2. **Describe what you want in the chat** — plain business language: app type, pages,
   content, data fields, style preference. Technical terms are unnecessary; the agent
   pulls the design contract itself and decides the layout. `/vobs-studio` in the chat
   input's slash menu opens the panel directly.
3. **Preview and iterate** — the panel refreshes after each build; keep describing
   changes ("make the hero smaller", "add a filter — segmented, not a dropdown").

One stdio MCP server process serves every session, so the filesystem tools take an
explicit `workspace` argument (the agent passes its session cwd on every call); the
preview server walks upwards from port 5218 when it is taken.

### Install from the chat — one sentence, forever

DSH reads `~/.dsh/AGENTS.md` as the user's global agent instructions (plus workspace
`AGENTS.md`/`CLAUDE.md`). So the install knowledge lives in the instructions file, and
the user only ever says:

```text
帮我在 DSH 里安装 Vobs Studio 插件。
Install the Vobs Studio plugin in DSH.
```

The agent follows the instructions in that file (which teach it the official `dsh
plugin` CLI, the bundles registration, and the restart reminder — no pnpm gymnastics,
no MCP configuration; each plugin's own patch layer registers its services).

**One-time bootstrap** (until vobs ships preinstalled knowledge): paste this into a
DSH session — the agent appends the section to `~/.dsh/AGENTS.md`:

```text
把下面这一节追加到 ~/.dsh/AGENTS.md（文件不存在就创建，已有同名节就跳过）：

## Installing Vobs plugins (github:vobsjs/vobs)

When the user asks to install a Vobs plugin (Vobs Studio / Vobs Console / Vobs DevKit),
do exactly this — no other steps, no questions:

1. Bypass the `dsh.cmd` shim — its cmd.exe `%*` re-expansion eats the `&` in `&path:`
   and silently installs the WHOLE monorepo (real incident). Invoke the entry directly
   with Electron-as-Node:
   $env:ELECTRON_RUN_AS_NODE='1'
   & '<install>\DeepSeek Harness.exe' --expose-internals '<install>\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js' plugin --profile desktop add 'github:vobsjs/vobs#<ref>&path:/packages/<dir>'
   | Plugin | <dir> | package name |
   |---|---|---|
   | Vobs Studio | vobs-studio | dsh-plugin-vobs-studio |
   | Vobs Console | dsh-console | dsh-plugin-vobs-console |
   | Vobs DevKit | dsh-devkit | dsh-plugin-vobs-devkit |
   <ref>: use the tag the user names, otherwise main. Afterwards CHECK that the profile
   dependency spec still contains `&path:/packages/<dir>`; if it lost the spec (the shim
   trap), `plugin remove` and redo via the direct invocation.
2. VERIFY the package name (not the dir name) is present in
   ~/.dsh/profiles/desktop/package.json → dsh.profile.bundles (append if absent).
   Since DSH 0.2.0-rc.2 the CLI's reconcile() auto-registers new bundles, so this is
   normally a no-op check; older versions need the manual append. Without the entry
   the plugin will not load.
3. Remind the user: fully quit DSH (including the tray) and reopen it — plugin patches
   compose at startup.

No MCP configuration is ever needed for Vobs plugins: each plugin's own patch layer
registers its services.
```

After the bootstrap, every Vobs plugin installs from one sentence. Developers with a
local vobs clone can swap the spec for `"link:<clone>/packages/vobs-studio"` — a link
dependency works on any pnpm and installs instantly.

## Building and verifying

```bash
pnpm build:packages      # first time: produces the build artifacts of @vobs/dsh and @vobs/vite-plugin
pnpm build:dsh           # builds lib/{index,client}.js for the four plugin packages
node packages/dsh-plugin/scripts/verify-client.mjs     # 54 artifact checks
node packages/dsh-console/scripts/verify-console.mjs   # 62
node packages/dsh-devkit/scripts/verify-devkit.mjs     # 65
node packages/vobs-studio/scripts/verify-studio.mjs    # 42
```

The `lib/` artifacts are **committed to the repository** — DSH does not build your package, so after changing source you must rebuild and commit (CI runs the three verifications above to catch missed rebuilds).

The plugin contract, `dshBundle()`'s three purity gates, the Windows CLI `&` trap, and other details are documented in [`packages/dsh/README.md`](../packages/dsh/README.md).
