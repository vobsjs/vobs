import { PUBLISHED_PACKAGES, findPackageScriptDrift } from './packages.mjs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const packageNames = process.argv.slice(2).filter(argument => !argument.startsWith('-'))
// This checks local build artifacts for every public package.
const packages = packageNames.length > 0 ? packageNames : PUBLISHED_PACKAGES

for (const name of packages) {
  const directory = path.join(root, 'packages', name)
  const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'))
  const files = new Set()
  const collect = value => {
    if (typeof value === 'string') files.add(value)
    else if (value && typeof value === 'object') Object.values(value).forEach(collect)
  }
  collect(manifest.exports)
  for (const file of files) {
    if (file.includes('*')) continue
    if (!file.startsWith('./dist/') && !file.startsWith('./src/')) continue
    try {
      await readFile(path.join(directory, file.slice(2)))
    } catch {
      throw new Error(`${manifest.name}: exports points to missing file ${file}`)
    }
  }
  for (const required of ['dist/index.js', 'dist/index.cjs', 'dist/index.d.ts', 'src/index.ts']) {
    try {
      await readFile(path.join(directory, required))
    } catch {
      throw new Error(`${manifest.name}: required file is missing: ${required}`)
    }
  }
  console.log(`[check] ${manifest.name} exports are present`)
}

/*
 * package.json 里 pack/publish 三条 `pnpm --filter` 链与可发布清单保持一致。
 *
 * 这三条链**故意保留**（重写发布命令的风险大于收益：出错就是真发 npm），
 * 但重复必须是「被检查的重复」—— 加包时漏改一处，结果就是某个包没被构建或没被发布，
 * 而且不会有任何提示。这里把它变成显式失败。
 */
const rootManifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const drift = findPackageScriptDrift(rootManifest)
if (drift.length > 0) {
  throw new Error(`package.json 的打包/发布脚本与可发布清单不一致：\n  ${drift.join('\n  ')}`)
}
console.log(`[check] 打包与发布脚本与 ${PUBLISHED_PACKAGES.length} 个可发布包一致`)
