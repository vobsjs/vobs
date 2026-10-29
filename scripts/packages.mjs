/**
 * The **single source of truth** for publishable packages.
 *
 * These 37 names used to be hardcoded in four places (build-packages / check-packages /
 * verify-packages / check-release), and repeated three more times as `pnpm --filter @vobs/x`
 * chains (package.json's pack:packages / publish:packages / publish:local) — adding a
 * package meant editing seven spots, and missing one silently left a package unbuilt
 * or unpublished.
 *
 * Everything now lives here. The three filter chains in package.json are **kept on
 * purpose** (rewriting the publish commands risks more than it gains: a mistake means a
 * real npm publish), but `assertPackageScriptsMatch` verifies they match this list —
 * the duplication becomes "checked duplication" instead of free drift.
 *
 * Excluded: the three DSH plugin packages (`packages/dsh-plugin|dsh-console|dsh-devkit`).
 * They are not published to npm; they ship via Git tags + #path: subdirectories.
 */
export const PUBLISHED_PACKAGES = [
  'reactivity',
  'runtime',
  'dom',
  'vobs',
  'compiler',
  'icon-core',
  'notification',
  'auth',
  'i18n',
  'layout',
  'resource',
  'theme',
  'ui',
  'kit',
  'router',
  'forms',
  'table',
  'captcha',
  'devtools',
  'devtools-ui',
  'dict',
  'http',
  'jwt-auth',
  'logger',
  'preferences',
  'queue',
  'ssr',
  'storage',
  'sync',
  'tailwind',
  'test-utils',
  'transition',
  'upload',
  'vite-plugin',
  'cli',
  'payment',
  'dsh'
]

/** Extract the set of names from `--filter @vobs/x` occurrences in a package.json script. */
export function filtersInScript(command) {
  const names = []
  for (const match of command.matchAll(/--filter\s+@vobs\/([a-z0-9-]+)/gu)) names.push(match[1])
  return names
}

/**
 * Verify that package.json's publish/pack scripts match PUBLISHED_PACKAGES.
 * @returns descriptions of any mismatches (empty array = in sync)
 */
export function findPackageScriptDrift(manifest, scriptNames = ['pack:packages', 'publish:packages', 'publish:local']) {
  const problems = []
  const expected = new Set(PUBLISHED_PACKAGES)
  for (const script of scriptNames) {
    const command = manifest.scripts?.[script]
    if (typeof command !== 'string') {
      problems.push(`package.json is missing the ${script} script`)
      continue
    }
    const actual = new Set(filtersInScript(command))
    for (const name of expected) {
      if (!actual.has(name)) problems.push(`${script} is missing @vobs/${name}`)
    }
    for (const name of actual) {
      if (!expected.has(name)) problems.push(`${script} has extra @vobs/${name} (not in the publishable list)`)
    }
  }
  return problems
}
