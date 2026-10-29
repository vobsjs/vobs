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
 * Without a tag this runs in **consistency mode**.
 *
 * Why it exists: this script used to **require a tag** to run (`pnpm run check:release`
 * without arguments → always threw "Expected a release tag"), so it was unusable
 * locally; and "manually unifying 36 package versions" had **no automated detection**
 * — drift really did happen historically (external post-mortem doc, item S: releases
 * aligned by hand, `publish.yml` deleted, publishing only possible locally by hand).
 *
 * Consistency mode checks two things, both drift only humans could catch:
 *   1. all publishable package versions agree with each other
 *   2. the root package.json version agrees with them
 *
 * With a tag the original "tag == all publishable package versions" semantics is kept,
 * and the root version is **additionally** verified — when the root version drifts
 * for a long time, the monorepo metadata produced by `publish` stops matching the
 * package versions.
 */
if (!tag || !tag.startsWith('v') || tag.length < 2) {
  if (tag) {
    throw new Error(`Expected a release tag such as v1.2.0, received: ${tag || '(empty)'}`)
  }
  const versions = new Set(packages.filter(item => !item.private).map(item => item.version))
  const problems = []
  if (versions.size > 1) {
    const detail = [...versions]
      .map(version => `${version} (${packages.filter(item => item.version === version).map(item => item.name).join(', ')})`)
      .join(' | ')
    problems.push(`Publishable package versions disagree with each other: ${detail}`)
  }
  const packageVersion = [...versions][0]
  if (packageVersion !== undefined && rootManifest.version !== packageVersion) {
    problems.push(
      `Root package.json version is ${rootManifest.version}, but publishable packages are at ${packageVersion}`
      + ' (in the release flow the root version only affects monorepo metadata, but long-term drift makes "which version is this" ambiguous)'
    )
  }
  if (problems.length > 0) {
    console.error('[release] Version consistency check failed:')
    for (const problem of problems) console.error(`  - ${problem}`)
    console.error('\nTo unify versions: node scripts/set-version.mjs <version>')
    process.exit(1)
  }
  console.log(`[release] Versions consistent: ${packageVersion} (${packages.length} packages, root version in sync)`)
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

// With a tag the root version is verified too: long-term drift makes "which version is this" ambiguous
if (rootManifest.version !== releaseVersion) {
  throw new Error(
    `Release ${tag} does not match root package.json version ${rootManifest.version}.`
    + `To unify: node scripts/set-version.mjs ${releaseVersion}`
  )
}

console.log(`[release] ${tag} matches ${packages.length} public packages (root version in sync)`)
