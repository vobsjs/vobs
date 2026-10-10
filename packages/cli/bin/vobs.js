#!/usr/bin/env node

// Register the TypeScript loader synchronously BEFORE importing any .ts
// module. tsx 4.23's programmatic API (tsx/esm/api) uses Node's registerHooks
// (Node >=22.13) and does not rely on the deprecated --loader worker path.
import { register } from 'tsx/esm/api'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

/*
 * **显式指定仓库的 tsconfig**（不依赖 CWD）。
 *
 * tsx 默认从**当前工作目录**找 `tsconfig.json`，靠它应用 `paths` 映射
 * （`@vobs/compiler` → `packages/compiler/src/index.ts` 那批）。
 *
 * 但 CLI 的常用形态是**从任意目录调用它**：`vobs check /some/project`。
 * 那时 CWD 不是仓库根 → tsx 找不到 tsconfig → `paths` 失效 →
 * `@vobs/compiler` 退回 node 解析、指向 `packages/compiler/dist/`。
 *
 * 于是：
 *   - 本地（已 `build:packages`，dist 存在）→ 恰好能跑，**看不见问题**
 *   - CI / 全新克隆（测试在任何构建之前跑）→ `ERR_MODULE_NOT_FOUND:
 *     Cannot find module 'packages/cli/node_modules/@vobs/compiler/dist/index.js'`
 *
 * 这正是 CI 真实报的那个错。把 tsconfig 路径固定成**相对本文件**的绝对路径，
 * 解析就不再随调用者的目录变化。
 */
const here = path.dirname(fileURLToPath(import.meta.url))
process.env.TSX_TSCONFIG_PATH ??= path.resolve(here, '..', '..', '..', 'tsconfig.json')

register()

const { start } = await import('../src/start.ts')

await start(process.argv.slice(2))
