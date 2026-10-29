# dsh-plugin-vobs

A minimal working implementation of installing **vobs** as a **DeepSeek Harness (DSH)** plugin, and at the same time the reference wiring for "vobs → DSH browser plugin".

Once installed, an overlay appears in the bottom-right corner of the DSH window: counter / memo derived value / effect run count, plus a tag list you can add to and remove from. It is rendered by `@vobs/vobs` inside a shadow root, with only a few-line React host on the outside.

```
┌──────────────────────────────────────┐
│ vobs  v1.7.7    Signals First · Z…  – ×│
├──────────────────────────────────────┤
│ Component body runs   1 │ effect runs   3       │
│ count 1   memo ×2  2   [−1] [ +1 ]    │
│ [ Add an item to the tag list… ]  [Add]          │
│ (signals ×) (run-once ×)              │
└──────────────────────────────────────┘
```

---

## 1. First, an explanation: why installing `github:vobsjs/vobs` does nothing

A DSH plugin is not "a JS library" but a **cordis bundle**. After reading a dependency, the plugin manager checks whether the package declares a bundle:

- No `dsh.bundle` → installed as a plain dependency, with the warning `declares no dsh.bundle — installed as a plain dependency, not a profile layer`;
- Has `dsh.bundle.patch` → the patch file is inserted as a layer into the profile's cordis tree;
- If `dsh.client` is also declared → `@deepseek-ai/dsh-client-modules` additionally serves `exports['./client']` to the page as a browser bundle.

The vobs repo root is a `private: true` pnpm monorepo with no `main` / `exports` / `dsh` fields, and `.gitignore` also excludes `dist/`. So installing `github:vobsjs/vobs` directly only puts the empty `vobs-framework` shell into `node_modules`; the bundle layer gets no insertable lines — nothing happens in the UI.

**Conclusion: a frontend framework itself cannot "be" a plugin; you can only write a plugin with it.** This package is that plugin.

---

## 2. The DSH plugin contract (verified against a real DSH)

| Location | Requirement | This package's value |
| --- | --- | --- |
| `package.json` → `dsh.bundle.patch` | Points to the patch file (relative to package root) | `./cordis.patch.yml` |
| `package.json` → `dsh.client.platform` | Platform of the client bundle; `'web'` for the web client | `'web'` |
| `package.json` → `dsh.client.inject` / `external` / `immediately` | Optional. `inject` lists client packages to load first; `external` lists module requests outside the base | None needed (only `require('react')`, and React is in the platform module table) |
| `exports['.']` | Host-side cordis plugin module (ESM, exports `name` / `inject` / `apply`) | `./lib/index.js` |
| `exports['./client']` | **Prebuilt** browser bundle | `./lib/client.js` |
| `cordis.patch.yml` | YAML array appending your own line with `- insert:` | See the file in this package |
| Install-time scripts | No `prepare` / `postinstall`: DSH does not build; artifacts must be committed | None |
| Dependencies | Zero if possible, and never the `workspace:` protocol (unresolvable in a Git subdirectory install) | Zero dependencies |

The browser bundle's shape is a single factory registration into DSH's client module system, **not** an ordinary ESM/CJS package:

```js
window.__ModuleLoader__.load({
  id: 'dsh-plugin-vobs',              // package name, used as the browser module identity
  factory: function (require) {       // registers only, runs no side effects (incl. CSS injection)
    // ... self-contained bundle content ...
    return plugin                       // the browser cordis plugin itself
  }
});
```

Hard constraints (from DSH's client module implementation):

- The bundle must be **self-contained**: no split chunks, no dynamic `import()`; the entry may only synchronously `require` platform modules (static table members like `react`, `react-dom`, `@deepseek-ai/dsh-client-ui-*`).
- Everything except platform modules (including vobs itself) must be bundled into the artifact.
- Module side effects are deferred until first materialization, so CSS injection must happen inside the factory closure (this package's approach: inject into the shadow root at mount time).

---

## 3. Installation

### Prerequisite: commit the artifacts first

DSH does **not** build your package at install time; `lib/index.js` and `lib/client.js` must already be in Git:

```bash
pnpm build:packages      # needed first time, produces @vobs/vite-plugin's dist
pnpm build:dsh-plugin    # produces packages/dsh-plugin/lib/*
git add packages/dsh-plugin scripts/build-dsh-plugins.mjs package.json
git commit -m "feat(dsh-plugin): vobs DSH plugin package"
git tag v1.7.7           # use a tag containing this package
git push origin main --tags
```

### Method A: the DSH plugin page (recommended)

Paste into the install input on DSH's sidebar "Plugins" page:

```text
github:vobsjs/vobs#v1.7.7&path:/packages/dsh-plugin
```

`&path:` is pnpm's **Git repository subdirectory** syntax, used to take a single subpackage out of a monorepo. Verified that DSH's built-in pnpm 11.7.0 supports it.

- To follow the default branch, omit the ref: `github:vobsjs/vobs#path:/packages/dsh-plugin`
- When both ref and path are present they must be joined with `&`

### Method B: command line

```bash
dsh plugin --profile desktop add "github:vobsjs/vobs#v1.7.7&path:/packages/dsh-plugin"
```

> **Windows note**: `dsh.cmd` is a batch wrapper; `&` is eaten by `cmd.exe` as a command separator, and the result is **silently installing the wrong package** (the monorepo root, with the notice `declares no dsh.bundle`). In PowerShell you must add the stop-parsing token:
>
> ```powershell
> dsh --% plugin --profile desktop add "github:vobsjs/vobs#v1.7.7&path:/packages/dsh-plugin"
> ```
>
> This path is verified working; the GUI path is unaffected (the service takes the string directly, no shell involved).

### Method C: npm

Publish `packages/dsh-plugin` as `dsh-plugin-vobs` (versioned independently of `@vobs/*`), then enter the package name on the plugin page:

```text
dsh-plugin-vobs
```

### Method D: local directory / tgz

```bash
pnpm --filter dsh-plugin pack --pack-destination .artifacts
```

Then enter the **absolute path** on the plugin page (directory or `.tgz` both work).

### After installing

A Host-side module was added; **fully quit DSH and reopen** (closing the window does not necessarily quit the process). The panel appears in the bottom-right corner; it can be disabled or uninstalled from the plugin page.

---

## 4. Development

```bash
pnpm build:packages                     # first time: build-dsh depends on @vobs/vite-plugin's dist
pnpm build:dsh-plugin                   # builds lib/index.js and lib/client.js
node packages/dsh-plugin/scripts/verify-client.mjs   # jsdom verification against the built artifact
pnpm typecheck                          # repo-wide type check
```

`verify-client.mjs` looks at no source, only the **artifact**, and actually runs it under DSH's module protocol: register factory → materialize to get the plugin → `apply()` registers into `shell.overlay` → React host mounts → vobs renders → clicks drive reactive updates → cleanup. It doubles as the executable specification of this wiring.

### Layout

```
packages/dsh-plugin/
├── package.json          # dsh manifest + exports + zero dependencies
├── cordis.patch.yml      # inserts only its own line, never overrides official entries
├── lib/                  # prebuilt artifacts (committed to Git)
│   ├── index.js          # Host: a legitimate cordis plugin, only responsible for "being mounted"
│   └── client.js         # Client: __ModuleLoader__ factory
├── src/
│   ├── host/index.ts
│   └── client/
│       ├── index.tsx     # React host + shadow root + slot registration
│       ├── panel.tsx     # the panel written in vobs JSX
│       └── styles.ts     # CSS injected into the shadow root
└── scripts/verify-client.mjs
```

The root-level `scripts/build-dsh-plugins.mjs` does the building; it deliberately does **not** go through `build-packages.mjs`: the client artifact must be wrapped in a `__ModuleLoader__` layer and must be self-contained with no split chunks.

---

## 5. Turn it into your own plugin

- **Change the content**: edit `src/client/panel.tsx`. It is an ordinary vobs component — the component body executes only once, and expressions like `{count.value}` are compiled by the compiler into standalone DOM binding effects.
- **Change the location**: `shell.overlay` is a `list` slot (scope: root) declared by `@deepseek-ai/dsh-client-ui-layout`; DSH's own quota notice and the plugin-manager toast also mount there. To use a different slot, edit `ctx.slots.inject(...)` in `src/client/index.tsx`.
- **Add languages**: the client can use `@deepseek-ai/dsh-client-locale`; if so, add it to `dsh.client.inject`.
- **Follow the theme**: the panel already reads `getComputedStyle(document.documentElement).colorScheme` (DSH's theme service writes here), falling back to `prefers-color-scheme` when unavailable; you can also use DSH's `--dsw-alias-*` design variables directly.
- **Add Host capabilities**: `src/host/index.ts` is intentionally empty right now. To add Agent-side tools, subscribe to `session/event`, or register services, do it here and adjust `inject` accordingly.

---

## 6. Known limitations

- **Version coupling**: wired against DSH Desktop 0.1.x (`@deepseek-ai/cordis@4.0.4`, `shell.overlay` declared by `dsh-client-ui-layout`). DSH is still evolving; changing versions requires re-verifying slots and the platform module table.
- **No `@deepseek-ai/cordis` peer declaration**: official bundles declare `peerDependencies: { "@deepseek-ai/cordis": "~4.0.4" }`, but the profile does not install cordis (it lives in the app), and declaring the peer could make the pre-install compatibility check fail outright. This package therefore declares **no** peers, consistent with `dsh-plugin-whale-pet`.
- **UI only**: registers no tools, subscribes to no events, reads or writes no session content, and sends no model requests.
- **Not visually confirmed in a real Web GUI**: the artifact-side protocol, rendering, reactivity, cleanup, and the plugin manager's install and bundle-tree insertion are all verified by testing; the panel's appearance on a real page still needs one visual confirmation after installing into the `desktop` profile.
