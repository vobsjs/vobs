#!/usr/bin/env node
/*
 * Set the release version uniformly: root package.json + all publishable packages.
 *
 * Why a script: external post-mortem doc, item S — "manually unifying 36 package
 * versions" is the main fragility of the release flow, and `check:release` can only
 * **detect** inconsistency after the fact, not **fix** it.
 *
 * Usage:
 *   node scripts/set-version.mjs 1.8.0        # write
 *   node scripts/set-version.mjs 1.8.0 --dry  # preview only
 *
 * Boundaries (stated honestly):
 * - Only the `version` field is touched, not dependency ranges — packages in this
 *   repo depend on each other via `workspace:*`, and pnpm replaces those with
 *   concrete versions at publish time, so ranges need no manual edits
 * - Each package.json's original indentation and trailing newline are preserved
 *   (JSON.parse + hand-written formatting)
 */
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { PUBLISHED_PACKAGES } from './packages.mjs'

const args = process.argv.slice(2).filter(argument => argument !== '--')
const dryRun = process.argv.includes('--dry')
const nextVersion = args[0]

if (!nextVersion) {
  console.error('Usage: node scripts/set-version.mjs <version> [--dry]')
  process.exit(2)
}
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(nextVersion)) {
  console.error(`Invalid version format: ${nextVersion} (expected 1.2.3 or 1.2.3-beta.1)`)
  process.exit(2)
}

/** Read the original file, replace the version field, preserve indentation and trailing newline. */
async function updateManifest(path, label) {
  const raw = await readFile(path, 'utf8')
  const manifest = JSON.parse(raw)
  const previous = manifest.version
  if (previous === nextVersion) return { label, previous, changed: false }

  const indentMatch = /\n([ \t]+)"/u.exec(raw)
  const indent = indentMatch ? indentMatch[1] : '  '
  const trailingNewline = raw.endsWith('\n') ? '\n' : ''
  // Replace only the top-level version field; a full JSON.stringify would reorder
  // fields, drop formatting details, and produce a huge meaningless diff
  const next = raw.replace(/("version"\s*:\s*)"[^"]*"/u, `$1"${nextVersion}"`)
  if (next === raw) {
    throw new Error(`${path}: no top-level "version" field found`)
  }
  void indent
  if (!dryRun) await writeFile(path, trailingNewline && !next.endsWith('\n') ? next + '\n' : next, 'utf8')
  return { label, previous, changed: true }
}

const targets = [
  { path: resolve('package.json'), label: 'vobs-framework (root)' },
  ...PUBLISHED_PACKAGES.map(name => ({ path: resolve('packages', name, 'package.json'), label: `@vobs/${name}` }))
]

const results = []
for (const target of targets) {
  results.push(await updateManifest(target.path, target.label))
}

const changed = results.filter(item => item.changed)
if (changed.length === 0) {
  console.log(`[version] Everything already at ${nextVersion}; nothing to change`)
  process.exit(0)
}
console.log(`[version] ${dryRun ? '(dry run) ' : ''}${changed.length}/${results.length} manifests → ${nextVersion}`)
for (const item of changed.slice(0, 6)) console.log(`  ${item.label}: ${item.previous} → ${nextVersion}`)
if (changed.length > 6) console.log(`  …and ${changed.length - 6} more of the same`)
if (!dryRun) {
  console.log('\nNext steps:')
  console.log('  pnpm run test:run && pnpm run typecheck && pnpm run check:release')
  console.log('  pnpm run publish:local')
}
