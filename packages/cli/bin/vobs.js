#!/usr/bin/env node

// Register the TypeScript loader synchronously BEFORE importing any .ts
// module. tsx 4.23's programmatic API (tsx/esm/api) uses Node's registerHooks
// (Node >=22.13) and does not rely on the deprecated --loader worker path.
import { register } from 'tsx/esm/api'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
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
 *
 * **但这个假设只在 vobs 仓库内成立**：CLI 被安装到用户项目时，`here/../../..`
 * 指向的是 `.pnpm` 虚拟目录，那里没有 tsconfig —— 1.8.10 因此把所有安装态的
 * `vobs` 命令搞挂了（tsx register 直接抛 "Cannot resolve tsconfig"）。
 * 修法：文件**存在才覆盖**；安装态回退 tsx 默认（从 CWD 找用户项目的 tsconfig，
 * src 里的 `@vobs/*` 导入走 node_modules 的 dist，本就不需要仓库的 paths 映射）。
 */
const here = path.dirname(fileURLToPath(import.meta.url))
const repoTsconfig = path.resolve(here, '..', '..', '..', 'tsconfig.json')
if (existsSync(repoTsconfig)) process.env.TSX_TSCONFIG_PATH ??= repoTsconfig

register()

const { start } = await import('../src/start.ts')

await start(process.argv.slice(2))
