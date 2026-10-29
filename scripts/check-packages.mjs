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
 * The three pack/publish `pnpm --filter` chains in package.json must stay in sync
 * with the publishable list.
 *
 * These chains are **kept on purpose** (rewriting the publish commands risks more than it
 * gains: a mistake means a real npm publish), but the duplication must be "checked
 * duplication" — missing one spot when adding a package silently leaves it unbuilt or
 * unpublished, with no hint whatsoever. This check turns that into an explicit failure.
 */
const rootManifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const drift = findPackageScriptDrift(rootManifest)
if (drift.length > 0) {
  throw new Error(`package.json pack/publish scripts do not match the publishable list:\n  ${drift.join('\n  ')}`)
}
console.log(`[check] pack/publish scripts match the ${PUBLISHED_PACKAGES.length} publishable packages`)
