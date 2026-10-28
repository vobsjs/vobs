# vobs npm release process

This document records the release process for vobs' dual-track npm packages.

> **Current state (verified 2026-09-30)**
>
> This document previously described "push the version tag and `.github/workflows/publish.yml` publishes automatically".
> The repository actually has **no** `publish.yml` — under `.github/workflows/` there is only
> `ci.yml` (the quality gate for PRs and pushes to `main`) and `release.yml` (**validates** version
> alignment when a `v*` tag is pushed).
> Therefore **pushing a tag does not publish anything**; publishing is done manually, locally.
> The "Manual publishing" section below gives the commands that actually work today.
>
> **This is a decision, not a transitional state** (made explicit 2026-10-02): tags in this repository are
> **for validation only**, and publishing is **always done manually**. There is no plan to add `publish.yml`
> with OIDC auto-publishing — auto-publishing would require configuring a Trusted Publisher for each of the
> 37 packages, the actual publishing frequency is low, and the payoff does not justify the maintenance surface.
> The "First-time setup" section is kept **for the record** (the steps if we ever decide to switch), not as a todo.
>
> Also worth knowing: Git tags in this repository serve **two** purposes — npm releases, and the install reference
> for the DSH plugin packages (`github:vobsjs/vobs#<tag>&path:/packages/<name>`). `v1.7.6` is a tag that serves
> **only the latter**: it points at the plugin commit, at which time the 37 packages were still at `1.7.5`,
> `check:release` fails for it, and there is no matching version on npm. Never reuse a tag that has already been pushed
> when releasing.

## Release scope

The current release list is the following 37 public packages, all with completed artifact builds and release verification:

```text
@vobs/reactivity
@vobs/runtime
@vobs/dom
@vobs/vobs
@vobs/compiler
@vobs/icon-core
@vobs/notification
@vobs/auth
@vobs/i18n
@vobs/layout
@vobs/resource
@vobs/theme
@vobs/ui
@vobs/kit
@vobs/router
@vobs/forms
@vobs/table
@vobs/captcha
@vobs/devtools
@vobs/devtools-ui
@vobs/dict
@vobs/http
@vobs/jwt-auth
@vobs/logger
@vobs/preferences
@vobs/queue
@vobs/ssr
@vobs/storage
@vobs/sync
@vobs/tailwind
@vobs/test-utils
@vobs/transition
@vobs/upload
@vobs/vite-plugin
@vobs/cli
@vobs/payment
@vobs/dsh
```

The root project is a private workspace and is not published; other packages not yet on the list are not published either.

`@vobs/cli` and `@vobs/payment` are now part of the public bundling, version-consistency checks, and the release list;
both keep the `dist/` and `/source` dual-track entries.

`@vobs/dsh` (added in 1.7.7) likewise keeps the `dist/` and `/source` dual-track entries and additionally exports
the `./react`, `./vite`, `./types`, and `./preview` subpaths; its `vite` dependency is a `peerDependencies`
entry marked optional (only the `./vite` entry needs it).

`packages/dsh-plugin` and `packages/dsh-console` are **not** on the release list: they are not
`@vobs/*` packages, their versions are independent (`0.1.0`), they are installed via Git tag + `#path:`
subdirectory, and their `lib/` artifacts are committed to the repository.

## First-time setup

> **For the record, not a todo**: per the decision above, this repository does not use OIDC auto-publishing.
> The following steps are only needed "the day we decide to switch to automated publishing".

To use OIDC auto-publishing, a GitHub Actions Trusted Publisher must be configured in npm for each package above:

- Organization: `vobsjs`
- Repository: `vobs`
- Workflow filename: `publish.yml`

The publish workflow uses OIDC, so no long-lived npm token needs to be stored in GitHub Secrets.

The workflow files that actually exist today (two):

- `.github/workflows/ci.yml`: quality gate for PRs and pushes to `main`
- `.github/workflows/release.yml`: **when a `v*` tag is pushed, validates that "tag version == all publishable package versions"**
  (validation only, no publishing). It catches misalignment such as "tagged but forgot to bump the package
  versions" — which has genuinely happened (`v1.7.8` pointed at a commit where the versions were not aligned)

Note that `ci.yml` does **not build or verify** the two DSH plugin packages; their artifact verification
(`packages/dsh-plugin/scripts/verify-client.mjs` and
`packages/dsh-console/scripts/verify-console.mjs`) currently runs only locally, by hand.

## Publishing a new version (1.7.7 as the example)

First align the versions of the 37 packages and the **root** `package.json`, and update `CHANGELOG.md`:

```bash
pnpm run release:version 1.7.7      # writes root + all publishable packages in one pass (--dry to preview)
```

Then run the version gate. **Without a tag argument it enters "consistency mode"** — it checks that the
packages agree with each other and that the root version is in sync (no tag needed; can be run at any time):

```bash
pnpm run check:release
```

```text
[release] 版本一致：1.7.7（37 个包，根版本同步）
```

Run it once more in tag form before creating the tag (this is exactly what `release.yml` runs in CI):

```bash
pnpm run check:release -- v1.7.7
```

```text
[release] v1.7.7 matches 37 public packages（根版本同步）
```

Commit the version changes and push `main`:

```bash
git add package.json packages CHANGELOG.md
git commit -m "release: v1.7.7"
git push origin main
```

Create and push the version tag:

```bash
git tag v1.7.7
git push origin v1.7.7
```

## Manual publishing

Pushing the tag triggers no publishing. Before publishing, confirm the quality gate is fully green:

```bash
pnpm install --frozen-lockfile
pnpm test:run
pnpm run build           # build:packages + typecheck + playground build
pnpm run verify:packages # pack each package and verify ESM/CJS/subpaths/source entries
```

Then publish all 37 packages with one command (roughly in dependency order; `workspace:*` is replaced with the
real version by pnpm at pack time, so you must use `pnpm publish` — `npm publish` does not understand that protocol):

```bash
pnpm run publish:local
```

`publish:packages` and `publish:local` have exactly the same package list; the only difference is that the
former adds `--provenance`. **Locally you can only use `publish:local`** — the reason is below.

### Post-publish verification: visibility lags behind acceptance

**Do not verify versions immediately after the publish command returns — you will inevitably see the illusion
that "half of them didn't go out".**

Measured (when publishing 1.7.7 on 2026-09-30): the registry returns **202 Accepted** for the upload — the write
is accepted — but the packument is updated **asynchronously**; in practice a single package takes about
**3–5 minutes** from acceptance to being visible in `npm view`. During that window:

- `npm view <pkg> version` still shows the old version;
- re-running publish returns
  `409 Conflict - Cannot publish over previously staged version "<x.y.z>"`.

**That 409 does not mean failure — only "already in flight"**: do not re-publish, do not change the version
number, just wait a few minutes.
(npm 11.6.1 has no `npm stage` subcommand, so this staged state cannot be queried from the client side.)

So verify like this: wait 3–5 minutes → run `npm view` one by one → record **request errors** and
**missing versions** separately — do not use a single catch that counts network errors as "not published".

```bash
for p in reactivity runtime dom vobs compiler; do
  echo -n "$p: "; npm view "@vobs/$p" version 2>/dev/null || echo "query failed"
done
```

### Why `--provenance` cannot be used locally

Provenance requires running in a supported CI environment. In npm's
`libnpmpublish/lib/publish.js`, the check in `ensureProvenanceGeneration()` is:

- GitHub Actions: requires the `id-token: write` permission (i.e. `ACTIONS_ID_TOKEN_REQUEST_URL` must exist);
- GitLab CI: requires `SIGSTORE_ID_TOKEN`;
- **any other environment (including a local terminal): throws directly**
  `Automatic provenance generation not supported for provider: <name>` (`EUSAGE`).

Also, that check only runs in a **real publish**, so `pnpm publish --dry-run --provenance` passes normally —
a dry-run will not reveal this problem. In addition, `--provenance` on a **brand-new package** also requires an
explicit `--access public` (our script already passes it).

### First publish of a new package

`@vobs/dsh` was first published in 1.7.7, which required:

1. `npm login` (confirm identity with `npm whoami`);
2. the account must have publish rights to the `@vobs` scope;
3. a scoped package's first publish must use `--access public`, otherwise it is treated as private by default.

To republish only individual packages, you can filter them:

```bash
pnpm --filter @vobs/dsh --filter @vobs/cli publish --no-git-checks --access public
```

## Post-publish checks

Spot-check the npm versions:

```bash
npm view @vobs/vobs version
npm view @vobs/ui version
npm view @vobs/dsh version
```

You can also install and verify in a temporary directory:

```bash
pnpm add @vobs/vobs@1.7.7 @vobs/ui@1.7.7 @vobs/dsh@1.7.7
```

## Common failures

- `check-release` fails: the tag version does not match the 37 package versions.
- `Automatic provenance generation not supported for provider: ...`: a command with
  `--provenance` was run locally; use `pnpm run publish:local` instead.
- `409 Conflict - Cannot publish over previously staged version "x.y.z"`:
  **usually not a failure but a publish already in flight** (the registry returned 202 and the packument
  updates asynchronously). Wait 3–5 minutes and verify again; do not re-publish, do not change the version
  number. See the "Post-publish verification" section above.
- `There are no new packages that should be published`: the version already exists on npm;
  bump to a new version number — published npm versions cannot be overwritten.
- `EPUBLISHCONFLICT` / 403: the account lacks publish rights for the scope, or the package name is taken by someone else.
- OIDC or permission failures: only possible after `publish.yml` is added; check that the corresponding npm
  package has a Trusted Publisher configured, and that the repository and organization names are `vobsjs/vobs`.
- Build or tarball verification failures: do not force a publish; fix and submit a new version.

Published npm versions cannot be overwritten in place; if published content is bad, fix it and release the next
patch version, e.g. `1.7.8`.
