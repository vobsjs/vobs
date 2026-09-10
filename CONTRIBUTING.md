# Contributing

Thanks for your interest in contributing to vobs.

## Prerequisites

- Node.js 20+
- pnpm 9+

## Setup

```bash
pnpm install
pnpm dev         # playground with HMR
```

## Common commands

| Command | Description |
| --- | --- |
| `pnpm test` | Vitest in watch mode |
| `pnpm test:run` | Single test pass across all packages |
| `pnpm typecheck` | `tsc --noEmit` across the workspace |
| `pnpm build` | Build core package artifacts, typecheck, and build the playground |
| `pnpm verify:packages` | Pack core packages and verify ESM, CJS, subpaths, types, and source entries |
| `pnpm lint` | ESLint |

## Repository layout

- `packages/*` — one directory per npm package. The compiler, reactivity, and runtime packages are the core; everything else builds on them.
- `playground/*` — integration examples used for manual verification.

## Ground rules

- **The source code is the single source of truth.** Docs and comments may lag; verify behavior against the implementation.
- **Every bug fix ships with a regression test** that fails without the fix.
- **Keep packages decoupled.** A package may only depend on other `@vobs/*` packages it already declares; do not reach into another package's internals.
- Component and lifecycle semantics rely on the owner tree: effects, listeners, and refs must always be created inside an owner scope so disposal stays complete.

## Submitting changes

1. Fork the repository and create a branch from `develop`.
2. Make your change with tests.
3. Run `pnpm test:run` and `pnpm typecheck` — both must pass.
4. Run `pnpm verify:packages` before changing package manifests or exports.
5. Open a pull request targeting `develop` with a short description of the what and the why.

Pull requests and pushes to `main` run the same checks in GitHub Actions: tests,
type checking, published-package verification, and the framework/playground build.

## Releasing

Releases are tag-driven. After updating the versions of the 36 publishable packages
and the changelog, verify the tag locally and push it:

```bash
pnpm run check:release -- v1.1.1
git tag v1.1.1
git push origin v1.1.1
```

The `publish` workflow reruns the full verification and publishes only the
allowlisted public packages. Each package must have the repository's
`publish.yml` workflow configured as an npm Trusted Publisher before its first
automated release.

Commit messages should state the intent of the change (for example: "fix: dispose swapped array children to stop ghost effects").
