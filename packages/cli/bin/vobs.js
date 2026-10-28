#!/usr/bin/env node

// Register the TypeScript loader synchronously BEFORE importing any .ts
// module. tsx 4.23's programmatic API (tsx/esm/api) uses Node's registerHooks
// (Node >=22.13) and does not rely on the deprecated --loader worker path.
import { register } from 'tsx/esm/api'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import path from 'node:path'

/*
 * **Explicitly pin the repo tsconfig** (no reliance on CWD).
 *
 * tsx looks for `tsconfig.json` from the **current working directory** by default, and uses
 * it to apply the `paths` mappings (the `@vobs/compiler` →
 * `packages/compiler/src/index.ts` batch).
 *
 * But the CLI's common form is **being invoked from an arbitrary directory**:
 * `vobs check /some/project`. Then CWD is not the repo root → tsx cannot find the
 * tsconfig → `paths` stops working → `@vobs/compiler` falls back to node resolution and
 * points at `packages/compiler/dist/`.
 *
 * Consequences:
 *   - Locally (after `build:packages`, dist exists) → it happens to work, **problem invisible**
 *   - CI / fresh clone (tests run before any build) → `ERR_MODULE_NOT_FOUND:
 *     Cannot find module 'packages/cli/node_modules/@vobs/compiler/dist/index.js'`
 *
 * That is exactly the error CI really reported. Pinning the tsconfig path to an absolute
 * path **relative to this file** makes resolution independent of the caller's directory.
 *
 * **But this assumption only holds inside the vobs repo**: when the CLI is installed into a
 * user project, `here/../../..` points into a `.pnpm` virtual directory with no tsconfig —
 * 1.8.10 therefore broke every installed `vobs` command (tsx register threw
 * "Cannot resolve tsconfig"). Fix: only override when the file **exists**; in installed
 * state, fall back to tsx's default (find the user project's tsconfig from CWD; the
 * `@vobs/*` imports in src go through node_modules dist and never needed the repo's paths
 * mappings in the first place).
 */
const here = path.dirname(fileURLToPath(import.meta.url))
const repoTsconfig = path.resolve(here, '..', '..', '..', 'tsconfig.json')
if (existsSync(repoTsconfig)) process.env.TSX_TSCONFIG_PATH ??= repoTsconfig

register()

const { start } = await import('../src/start.ts')

await start(process.argv.slice(2))
