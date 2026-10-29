import { PUBLISHED_PACKAGES } from './packages.mjs'
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'tsup'

const root = fileURLToPath(new URL('..', import.meta.url))
// Keep this list aligned with the public package release allowlist.
const corePackages = PUBLISHED_PACKAGES
const requested = process.argv.slice(2).filter(argument => !argument.startsWith('-'))
const packageNames = requested.length > 0 ? requested : corePackages

function packagePath(name) {
  return path.join(root, 'packages', name)
}

async function sourceEntries(directory) {
  const entries = []
  async function visit(current) {
    for (const item of await readdir(current, { withFileTypes: true })) {
      const fullPath = path.join(current, item.name)
      if (item.isDirectory()) {
        await visit(fullPath)
        continue
      }
      if (/\.d\.ts$/.test(item.name)) continue
      if (!/\.(?:ts|tsx|js|jsx)$/.test(item.name)) continue
      if (/(?:\.test|\.spec)\.(?:ts|tsx|js|jsx)$/.test(item.name)) continue
      entries.push(fullPath)
    }
  }
  await visit(path.join(directory, 'src'))
  return entries
}

async function copyAssets(directory, outDir) {
  async function visit(current) {
    for (const item of await readdir(current, { withFileTypes: true })) {
      const source = path.join(current, item.name)
      const relative = path.relative(path.join(directory, 'src'), source)
      const target = path.join(outDir, relative)
      if (item.isDirectory()) {
        await visit(source)
        continue
      }
      // Standalone .d.ts files (e.g. the jsx.d.ts global type declarations) are not build
      // entries and tsup emits nothing for them, so copy them into dist directly (an existing
      // target means tsup already emitted the same-entry types; do not overwrite).
      // This must be checked before the generic .ts$ rule: .d.ts also ends with .ts.
      if (/\.d\.ts$/.test(item.name)) {
        if (existsSync(target)) continue
        await mkdir(path.dirname(target), { recursive: true })
        await copyFile(source, target)
        continue
      }
      if (/\.(?:ts|tsx|js|jsx)$/.test(item.name)) continue
      await mkdir(path.dirname(target), { recursive: true })
      await copyFile(source, target)
    }
  }
  await visit(path.join(directory, 'src'))
}

for (const name of packageNames) {
  const directory = packagePath(name)
  const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'))
  const entries = await sourceEntries(directory)
  if (entries.length === 0) throw new Error(`No source exports found for ${manifest.name}`)
  const entryFor = files => Object.fromEntries(files.map(file => {
    const relative = path.relative(path.join(directory, 'src'), file)
    return [relative.replace(/\.(?:ts|tsx|js|jsx)$/, ''), file]
  }))
  const tsEntries = entries.filter(file => /\.(?:ts|tsx)$/.test(file))
  const jsEntries = entries.filter(file => /\.(?:js|jsx)$/.test(file))

  const outDir = path.join(directory, 'dist')
  if (existsSync(outDir)) await rm(outDir, { recursive: true, force: true })

  console.log(`[build] ${manifest.name} (${entries.length} entries)`)
  // Workspace deps are handled by the @vobs/* regex; all other dependencies/peerDependencies
  // (e.g. typescript, parse5) must be externalized explicitly, otherwise they get inlined into
  // dist (symlinked node_modules and workspace paths defeat automatic externalization)
  const dependencyNames = Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies })
  const baseOptions = {
    outDir,
    format: ['esm', 'cjs'],
    sourcemap: true,
    splitting: false,
    target: 'es2020',
    external: [/^@vobs\//, /^node:/, ...dependencyNames],
    outExtension: ({ format }) => ({ js: format === 'cjs' ? '.cjs' : '.js' }),
    esbuildOptions(options) {
      // platform: node automatically externalizes Node built-ins
      options.platform = 'node'
      options.keepNames = true
      if (options.format === 'cjs') {
        // esbuild turns import.meta into an empty object in CJS output (crashes at runtime).
        // define only accepts identifiers/literals, so substitute an identifier first and
        // inject the real value via a banner; ESM output keeps the native import.meta.url
        options.define = {
          ...options.define,
          'import.meta.url': '__VOBS_CJS_FILE_URL'
        }
        options.banner = {
          ...options.banner,
          js: 'var __VOBS_CJS_FILE_URL = require("url").pathToFileURL(__filename).href;'
        }
      }
    }
  }
  if (tsEntries.length > 0) {
    await build({ ...baseOptions, entry: entryFor(tsEntries), dts: true, clean: true })
  }
  if (jsEntries.length > 0) {
    await build({ ...baseOptions, entry: entryFor(jsEntries), dts: false, clean: tsEntries.length === 0 })
  }
  await copyAssets(directory, outDir)
}
