# Vobs Studio

A DeepSeek Harness plugin rendered with [vobs](https://github.com/vobsjs/vobs).

## Develop

```bash
pnpm install
pnpm dev      # local preview: see the panel in a browser without installing into DSH
pnpm build    # produces lib/{index,client}.js
pnpm check    # pre-install consistency check
```

## Install into DSH

The build output **must be committed to Git** — DSH does not build your package at install time.

```bash
git add -A && git commit -m "feat: Vobs Studio" && git tag v0.1.0 && git push --tags
```

Then fill in on DSH's sidebar "Plugins" page:

```text
github:<owner>/<repo>#v0.1.0&path:/<this package's path within the repo>
```

`&path:` is pnpm's Git-repo subdirectory syntax. **Watch out on the Windows command line**:
`dsh.cmd` is a batch wrapper, `&` gets eaten by `cmd.exe` and the wrong package is silently
installed; in PowerShell write `dsh --% plugin --profile desktop add "…"`.

Fully quit DSH and reopen it after installing.

## Layout

```
src/
├── host/index.ts        Host-side cordis plugin (only needs to "be mounted")
└── client/
    ├── index.tsx        defineDshOverlay: which slot to mount into, what to render
    ├── panel.tsx        panel body (a vobs component, executes exactly once)
    └── styles.ts        styles injected into the shadow root
cordis.patch.yml         inserts this plugin's own row into the profile's cordis tree
lib/                     build output (committed to Git)
```

## Alternative mounting styles

The `defineDshOverlay` in `src/client/index.tsx` can be swapped for:

- `defineDshPanel({ key, label, sidebarEntry })` — a full main-area page + a sidebar entry
- `defineDshPlugin({ setup(ctx) { … } })` — write your own apply, mount into slots the adapter has not wrapped yet

For available slots and fields see [the `@vobs/dsh` README](https://github.com/vobsjs/vobs/tree/main/packages/dsh).
