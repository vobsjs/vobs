import { PUBLISHED_PACKAGES } from './packages.mjs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const publishablePackages = PUBLISHED_PACKAGES

const tag = process.argv.slice(2).find((argument) => argument !== '--') ?? process.env.GITHUB_REF_NAME ?? ''

const packages = await Promise.all(
  publishablePackages.map(async (name) => {
    const path = resolve('packages', name, 'package.json')
    const manifest = JSON.parse(await readFile(path, 'utf8'))
    return { name: manifest.name, version: manifest.version, private: manifest.private === true, path }
  }),
)
const rootManifest = JSON.parse(await readFile(resolve('package.json'), 'utf8'))

/*
 * 无 tag 时进入**一致性模式**。
 *
 * 为什么需要：这个脚本原来**必须有 tag 才能跑**（`pnpm run check:release` 没传参数 →
 * 必然抛 "Expected a release tag"），于是它在本地根本用不上；而"36 个包版本手工统一"
 * 这件事**没有任何自动检测** —— 历史上真的漂移过（外部踩坑文档 S 条：
 * 发版靠人肉对齐、`publish.yml` 已删、发布只能本地手跑）。
 *
 * 一致性模式检查两件事，都是**只有人肉才能发现**的漂移：
 *   1. 所有可发布包版本是否互相一致
 *   2. 根 package.json 版本是否与它们一致
 *
 * 带 tag 时保留原有的「tag == 全部可发布包版本」语义，并**额外**校验根版本
 * —— 根版本长期不同步时，`publish` 出的 monorepo 元信息与包版本会对不上。
 */
if (!tag || !tag.startsWith('v') || tag.length < 2) {
  if (tag) {
    throw new Error(`Expected a release tag such as v1.2.0, received: ${tag || '(empty)'}`)
  }
  const versions = new Set(packages.filter(item => !item.private).map(item => item.version))
  const problems = []
  if (versions.size > 1) {
    const detail = [...versions]
      .map(version => `${version}（${packages.filter(item => item.version === version).map(item => item.name).join(', ')}）`)
      .join(' | ')
    problems.push(`可发布包的版本互不一致：${detail}`)
  }
  const packageVersion = [...versions][0]
  if (packageVersion !== undefined && rootManifest.version !== packageVersion) {
    problems.push(
      `根 package.json 版本是 ${rootManifest.version}，而可发布包是 ${packageVersion}`
      + '（发布流程里根版本只影响 monorepo 元信息，但长期漂移会让"这一版是哪个"变得含糊）'
    )
  }
  if (problems.length > 0) {
    console.error('[release] 版本一致性检查未通过：')
    for (const problem of problems) console.error(`  - ${problem}`)
    console.error('\n统一版本的命令：node scripts/set-version.mjs <版本>')
    process.exit(1)
  }
  console.log(`[release] 版本一致：${packageVersion}（${packages.length} 个包，根版本同步）`)
  process.exit(0)
}

const releaseVersion = tag.slice(1)

const invalid = packages.filter(
  ({ name, version, private: isPrivate }) =>
    isPrivate || version !== releaseVersion,
)

if (invalid.length > 0) {
  const details = invalid
    .map(({ name, version, private: isPrivate }) => `${name}: ${isPrivate ? 'private' : version}`)
    .join(', ')
  throw new Error(`Release ${tag} does not match all publishable packages: ${details}`)
}

// 带 tag 时也校验根版本：根长期不同步会让"这一版是哪个"变得含糊
if (rootManifest.version !== releaseVersion) {
  throw new Error(
    `Release ${tag} 与根 package.json 版本 ${rootManifest.version} 不一致。`
    + `统一命令：node scripts/set-version.mjs ${releaseVersion}`
  )
}

console.log(`[release] ${tag} matches ${packages.length} public packages（根版本同步）`)
