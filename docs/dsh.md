# DSH plugins

vobs can be used to write client plugins for [DeepSeek Harness](https://github.com/deepseek-ai). The repository contains **one toolchain + three plugin packages**:

| Package | Purpose |
| --- | --- |
| [`@vobs/dsh`](../packages/dsh) | Runtime adapter (`defineDshPlugin` / `defineDshOverlay` / `defineDshPanel`) + `dshBundle()` to build plugins + `@vobs/dsh/preview` local preview runtime |
| [`@vobs/cli`](../packages/cli) | The `vobs dsh init / dev / build / check / install` command group and the plugin template; also `vobs check` static source checks |
| [`packages/dsh-plugin`](../packages/dsh-plugin) | The minimal working plugin (overlay), also the reference implementation for "vobs → DSH" |
| [`packages/dsh-console`](../packages/dsh-console) | **Vobs Console**: a multi-session real-time cockpit registered into the `main` slot (overview / event stream / tool analysis / artifacts) |
| [`packages/dsh-devkit`](../packages/dsh-devkit) | **Vobs DevKit**: project checks (reads `.vobs/check.json`) / guardrails / API / examples / status |

These three `dsh-plugin*` packages share the repository-wide lockstep version with the rest, but are **not published to npm** — they are distributed via Git tags or commits + the `#path:` subdirectory.

## How users install

### Option 1: the DSH plugin page (recommended)

Sidebar → **Plugins** → **Add plugin**. The dialog accepts **a package name, a Git URL, a tarball, or a local absolute path**. Paste:

```text
github:vobsjs/vobs#<ref>&path:/packages/dsh-console
github:vobsjs/vobs#<ref>&path:/packages/dsh-devkit
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

## Building and verifying

```bash
pnpm build:packages      # first time: produces the build artifacts of @vobs/dsh and @vobs/vite-plugin
pnpm build:dsh           # builds lib/{index,client}.js for the three plugin packages
node packages/dsh-plugin/scripts/verify-client.mjs     # 54 artifact checks
node packages/dsh-console/scripts/verify-console.mjs   # 62
node packages/dsh-devkit/scripts/verify-devkit.mjs     # 65
```

The `lib/` artifacts are **committed to the repository** — DSH does not build your package, so after changing source you must rebuild and commit (CI runs the three verifications above to catch missed rebuilds).

The plugin contract, `dshBundle()`'s three purity gates, the Windows CLI `&` trap, and other details are documented in [`packages/dsh/README.md`](../packages/dsh/README.md).
