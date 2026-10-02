#!/usr/bin/env node
/*
 * 统一发版版本号：根 package.json + 全部可发布包。
 *
 * 为什么脚本化：外部踩坑文档 S 条——"36 包版本手工统一"是发版流程脆弱的主因，
 * 而 `check:release` 只能**事后发现**不一致、不能**修正**。
 *
 * 用法：
 *   node scripts/set-version.mjs 1.8.0        # 写入
 *   node scripts/set-version.mjs 1.8.0 --dry  # 只看会改什么
 *
 * 边界（如实说明）：
 * - 只改 `version` 字段，不动依赖范围 —— 本仓库的包之间用 `workspace:*`，
 *   发布时 pnpm 会替换成具体版本，所以依赖范围不需要跟着手改
 * - 会保留每个 package.json 原有的缩进与结尾换行（JSON.parse + 手写格式化）
 */
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { PUBLISHED_PACKAGES } from './packages.mjs'

const args = process.argv.slice(2).filter(argument => argument !== '--')
const dryRun = process.argv.includes('--dry')
const nextVersion = args[0]

if (!nextVersion) {
  console.error('用法：node scripts/set-version.mjs <版本> [--dry]')
  process.exit(2)
}
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(nextVersion)) {
  console.error(`版本号形态不对：${nextVersion}（期望 1.2.3 或 1.2.3-beta.1）`)
  process.exit(2)
}

/** 读原文件，替换 version 字段，保留缩进与结尾换行。 */
async function updateManifest(path, label) {
  const raw = await readFile(path, 'utf8')
  const manifest = JSON.parse(raw)
  const previous = manifest.version
  if (previous === nextVersion) return { label, previous, changed: false }

  const indentMatch = /\n([ \t]+)"/u.exec(raw)
  const indent = indentMatch ? indentMatch[1] : '  '
  const trailingNewline = raw.endsWith('\n') ? '\n' : ''
  // 只替换顶层 version 字段，不用整份 JSON.stringify —— 后者会重排字段顺序、
  // 丢掉格式化细节，产生巨大的无意义 diff
  const next = raw.replace(/("version"\s*:\s*)"[^"]*"/u, `$1"${nextVersion}"`)
  if (next === raw) {
    throw new Error(`${path}: 没找到顶层 "version" 字段`)
  }
  void indent
  if (!dryRun) await writeFile(path, trailingNewline && !next.endsWith('\n') ? next + '\n' : next, 'utf8')
  return { label, previous, changed: true }
}

const targets = [
  { path: resolve('package.json'), label: 'vobs-framework（根）' },
  ...PUBLISHED_PACKAGES.map(name => ({ path: resolve('packages', name, 'package.json'), label: `@vobs/${name}` }))
]

const results = []
for (const target of targets) {
  results.push(await updateManifest(target.path, target.label))
}

const changed = results.filter(item => item.changed)
if (changed.length === 0) {
  console.log(`[version] 全部已是 ${nextVersion}，无需改动`)
  process.exit(0)
}
console.log(`[version] ${dryRun ? '（dry run）' : ''}${changed.length}/${results.length} 个 manifest → ${nextVersion}`)
for (const item of changed.slice(0, 6)) console.log(`  ${item.label}: ${item.previous} → ${nextVersion}`)
if (changed.length > 6) console.log(`  …其余 ${changed.length - 6} 个同类`)
if (!dryRun) {
  console.log('\n下一步：')
  console.log('  pnpm run test:run && pnpm run typecheck && pnpm run check:release')
  console.log('  pnpm run publish:local')
}
