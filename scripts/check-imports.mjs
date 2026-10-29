/**
 * Verify that every @vobs/* import in a package's source is declared in its own
 * package.json.
 *
 * Why this needs a dedicated check: `pnpm run verify:packages` packs all 37 packages
 * into one temporary project, so "A uses B without declaring it" **always resolves
 * there** — structurally undetectable. Real runs found 3 genuine phantom dependencies
 * (captcha / devtools-ui / test-utils used @vobs/reactivity without declaring it), plus
 * one **false positive**: vite-plugin puts `import ... from '@vobs/vobs'` inside a
 * template string injected into the browser, which a regex scan mistakes for a real
 * import. So this check uses the TypeScript AST to collect real imports, no text matching.
 *
 * The package list is enumerated directly from packages/ package.json files — no second
 * hard-coded manifest.
 *
 * Exception: **bundle-type** packages (manifest has a `dsh` field). All of their source
 * imports are inlined into self-contained artifacts at build time, and their manifest
 * must **never contain `workspace:` anywhere** — they are installed directly via
 * `github:…#path:`, where the workspace protocol cannot resolve (each of the three
 * plugin packages' verify scripts has an assertion guarding this invariant). So such
 * packages are skipped entirely rather than given devDependencies: adding
 * `workspace:*` was tried once and immediately turned that assertion red.
 */
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = fileURLToPath(new URL('..', import.meta.url))
const packagesDir = path.join(root, 'packages')

/** Collect the real module specifiers in a file (including dynamic imports and re-exports). */
function collectSpecifiers(fileName, source) {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const specifiers = []
  const visit = node => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      specifiers.push(node.moduleSpecifier.text)
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      specifiers.push(node.moduleSpecifier.text)
    } else if (ts.isCallExpression(node)
      && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments.length > 0
      && ts.isStringLiteral(node.arguments[0])) {
      specifiers.push(node.arguments[0].text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return specifiers
}

/** `@vobs/runtime/error` → `@vobs/runtime`. */
function packageNameOf(specifier) {
  const parts = specifier.split('/')
  return parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0]
}

async function sourceFiles(directory) {
  const found = []
  const walk = async current => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
        continue
      }
      if (!/\.tsx?$/u.test(entry.name)) continue
      // Test files use devDependencies and are out of scope for this gate (it only guarantees publishable source is self-consistent)
      if (/\.test\.tsx?$/u.test(entry.name)) continue
      found.push(full)
    }
  }
  await walk(directory)
  return found
}

const problems = []
const skipped = []
let checked = 0

const entries = await readdir(packagesDir, { withFileTypes: true })
for (const entry of entries) {
  if (!entry.isDirectory()) continue
  const directory = path.join(packagesDir, entry.name)
  let manifest
  try {
    manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'))
  } catch {
    continue
  }
  const declared = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {})
  ])
  // Bundle-type packages are skipped entirely (see the file header)
  if (manifest.dsh !== undefined) {
    skipped.push(manifest.name)
    continue
  }

  const srcDir = path.join(directory, 'src')
  let files
  try {
    files = await sourceFiles(srcDir)
  } catch {
    continue
  }

  const missing = new Map()
  for (const file of files) {
    const source = await readFile(file, 'utf8')
    for (const specifier of collectSpecifiers(file, source)) {
      if (!specifier.startsWith('@vobs/')) continue
      const name = packageNameOf(specifier)
      if (name === manifest.name) continue
      if (declared.has(name)) continue
      // Report each missing dependency once, with its first occurrence's location
      if (!missing.has(name)) {
        missing.set(name, `${path.relative(root, file).split(path.sep).join('/')} (imports ${specifier})`)
      }
    }
  }

  checked += 1
  for (const [name, where] of missing) {
    problems.push(`${manifest.name}: uses ${name} but does not declare it in dependencies / peerDependencies — ${where}`)
  }
}

if (problems.length > 0) {
  console.error(`\nFound ${problems.length} undeclared dependencies:\n`)
  for (const problem of problems) console.error(`  ${problem}`)
  console.error('\nDeclare them (usually with workspace:*), otherwise resolution fails under a strict node_modules layout.\n')
  process.exit(1)
}

const skipNote = skipped.length > 0 ? ` (skipping ${skipped.length} bundle-type packages: ${skipped.join(', ')})` : ''
console.log(`✔ Dependency declarations are self-consistent — checked source imports of ${checked} packages${skipNote}`)
