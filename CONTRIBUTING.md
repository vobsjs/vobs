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
| `pnpm build` | Typecheck + playground production build |
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
4. Open a pull request targeting `develop` with a short description of the what and the why.

Commit messages should state the intent of the change (for example: "fix: dispose swapped array children to stop ghost effects").
