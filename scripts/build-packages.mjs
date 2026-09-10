import { copyFile, mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'tsup'

const root = fileURLToPath(new URL('..', import.meta.url))
const corePackages = ['reactivity', 'runtime', 'dom', 'vobs', 'compiler', 'icon-core', 'notification', 'auth', 'i18n', 'layout', 'resource', 'theme', 'ui', 'kit', 'router', 'forms', 'table']
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
      if (/\.(?:ts|tsx|js|jsx)$/.test(item.name) || /\.d\.ts$/.test(item.name)) continue
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
  const baseOptions = {
    outDir,
    format: ['esm', 'cjs'],
    sourcemap: true,
    splitting: false,
    target: 'es2020',
    treeshake: true,
    skipNodeModulesBundle: true,
    external: [/^@vobs\//],
    outExtension: ({ format }) => ({ js: format === 'cjs' ? '.cjs' : '.js' }),
    esbuildOptions(options) {
      options.platform = 'neutral'
      options.keepNames = true
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
