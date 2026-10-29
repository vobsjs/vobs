# dsh-plugin-vobs-devkit

**Vobs DevKit** — a full-page panel registered into DSH's `main` (keyed) slot with a left-sidebar entry, providing a reference for "people who write vobs code" and "AI that writes vobs code for people".

## The five tabs

| Tab | Content | Data from |
| --- | --- | --- |
| **Project** | The issue list from the workspace's `.vobs/check.json` (`file:line:col` + the offending line + fix suggestions), summarizing files/errors/warnings | **Live data** · `vobs check --write` |
| Guardrails | Explanations of the `VOBS_C210` / `VOBS_C211` rules with before/after comparisons (from the implemented `@vobs/vobs/dev`) | Build-time static |
| API | An index of APIs that really exist in the repo: signatures, descriptions, examples (each verified against the source) | Build-time static |
| Examples | Copy-paste-ready code examples | Build-time static |
| Status | Honestly lists which capabilities of this toolchain are done and which are not | Build-time static |

## Using the "Project" page

```bash
vobs check --write     # run in the root of the project being checked; produces .vobs/check.json
```

The panel reads this file and re-reads it automatically on change (comparing `version`; no re-read if unchanged).
**The panel is read-only and runs no commands** — DSH's workspace-files Remote has no write capability and the panel cannot start processes,
so this report is produced by an AI (or by you).

File reads go through DSH's built-in `remote.workspaceFiles` (`readBytes` / `stat`) and
**do not need this plugin's Host half** — that is the reason this panel could be built at all.

### Known trade-offs

- **Polling instead of a change stream**: DSH also offers `changes()` (streamed, more powerful), but I have not verified
  how it is consumed (async iterator or callback) on a live DSH; `stat()`'s shape is certain, cheaper and steadier than
  `version`. Upgrading only means replacing this one piece.
- **Which workspace**: the `cwd` of the most recently updated non-empty session is used. The panel displays it, so a wrong
  pick is visible at a glance. Manual switching would have to wait for a session picker.

## Pitfalls hit while building this panel

- The first version of `ApiIndex` read `props.apiName.value` inside the component body — component bodies execute only
  once, so clicking an API entry on the left did not budge the right side. Fixed after switching to a `memo` derived
  value. (This is exactly the pitfall the panel's "Guardrails" page teaches.)
- `data instanceof Uint8Array` **fails across realms** (jsdom / iframe / worker boundaries have different constructors).
  Fixed by checking shape via `byteLength`.
- vobs JSX **eats whitespace before an expression**: `{x} files` renders as `12files`. Use a template string to keep
  the space explicitly.

## Why the other pages are static

**The DevKit runs inside DSH; your app runs in its own dev server — they are not the same page.**
So the panel cannot see your app's runtime (including runtime guardrail warnings).

Showing live data (workspace info, `vobs check` results) would require wiring DSH's **Host half**: the Host can read
the workspace and run the CLI, then deliver results to the client through cordis services. That step is **not done yet**;
the "Status" page says so honestly.

## Install

```bash
dsh plugin --profile desktop add "github:vobsjs/vobs#<ref>&path:/packages/dsh-devkit"
```

Use a tag or commit SHA containing this package for `<ref>`. After installing, **fully quit DSH and reopen** — Host-side modules do not hot-reload.

## Development

```bash
pnpm build:dsh-devkit                              # builds lib/{index,client}.js
node packages/dsh-devkit/scripts/verify-devkit.mjs # 50 artifact checks (really mounts and clicks in jsdom)
```

The `lib/` artifacts are **checked into the repo** — DSH will not build your package. After changing source you must rebuild and commit, otherwise what gets installed is the stale artifact (the `dsh-plugin` verify script blocks this via an embedded version number).

## Pitfalls hit while building this panel (by the panel itself)

The first version of `ApiIndex` read `props.apiName.value` inside the component body — component bodies execute only once, so clicking an API entry on the left did not budge the right side. Fixed after switching to a `memo` derived value.

This is **exactly the pitfall the panel's "Guardrails" page teaches** (reading a signal in the component body with a React mental model). When writing vobs remember: **the component body runs once; mutable reads must go into dynamic expressions or `memo`**.
