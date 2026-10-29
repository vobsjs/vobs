/**
 * Build the DSH plugin packages in this repository.
 *
 *   <pkg>/lib/index.js   — Host half (cordis plugin, ESM)
 *   <pkg>/lib/client.js  — Client half (browser bundle, __ModuleLoader__ factory)
 *
 * The client half is entirely delegated to @vobs/dsh's `dshBundle()`: shell wrapping,
 * self-contained purity gating, react externalization, and platform bootstrapping are
 * all handled by the adapter. This script is therefore just a demonstration of "how to
 * build a plugin project" — the equivalent of the vite.config a plugin author writes.
 *
 * Dependency resolution: this script lives in <root>/scripts/, so `import 'vite'` hits
 * the root node_modules; @vobs/vite-plugin and @vobs/dsh are imported directly from
 * their dist folders via relative paths. This keeps the plugin packages' own
 * package.json dependency-free — a GitHub `#path:` direct install then never breaks
 * on the workspace: protocol.
 *
 * Usage: pnpm build:dsh                    # all
 *        pnpm build:dsh-plugin             # dsh-plugin only
 *        node scripts/build-dsh-plugins.mjs dsh-console
 */
import { mkdir, readFile, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'vite'
import { workspaceAliases } from './vite-workspace.mjs'

const DEFAULT_PACKAGES = ['dsh-plugin', 'dsh-console', 'dsh-devkit', 'vobs-studio']

const root = fileURLToPath(new URL('..', import.meta.url))
const requested = process.argv.slice(2).filter(argument => !argument.startsWith('-'))
const packageNames = requested.length > 0 ? requested : DEFAULT_PACKAGES

const vitePluginEntry = path.join(root, 'packages', 'vite-plugin', 'dist', 'index.js')
const dshAdapterEntry = path.join(root, 'packages', 'dsh', 'dist', 'vite.js')
const vobsManifestPath = path.join(root, 'packages', 'vobs', 'package.json')

for (const [label, target] of [
  ['@vobs/vite-plugin', vitePluginEntry],
  ['@vobs/dsh', dshAdapterEntry]
]) {
  if (!(await exists(target))) {
    throw new Error(`Missing build output for ${label} (${path.relative(root, target)}). Run pnpm build:packages first.`)
  }
}

const { vobsPlugin } = await import(pathToFileURL(vitePluginEntry).href)
const { dshBundle } = await import(pathToFileURL(dshAdapterEntry).href)
const vobsManifest = JSON.parse(await readFile(vobsManifestPath, 'utf8'))

async function exists(target) {
  try {
    await stat(target)
    return true
  } catch {
    return false
  }
}

for (const name of packageNames) {
  const packageDir = path.join(root, 'packages', name)
  const libDir = path.join(packageDir, 'lib')
  const manifest = JSON.parse(await readFile(path.join(packageDir, 'package.json'), 'utf8'))

  if (manifest.dsh?.client === undefined) {
    throw new Error(`${manifest.name} does not declare dsh.client and is not a DSH client plugin package.`)
  }

  await mkdir(libDir, { recursive: true })

  /* -------------------------------------------------------------- Host half */

  await build({
    configFile: false,
    root: packageDir,
    logLevel: 'warn',
    build: {
      outDir: 'lib',
      emptyOutDir: true,
      target: 'es2022',
      minify: false,
      sourcemap: false,
      lib: {
        entry: path.join(packageDir, 'src', 'host', 'index.ts'),
        formats: ['es'],
        fileName: () => 'index.js'
      }
    }
  })

  /* ------------------------------------------------------------- Client half */

  await build({
    configFile: false,
    root: packageDir,
    logLevel: 'warn',
    define: {
      __VOBS_VERSION__: JSON.stringify(vobsManifest.version)
    },
    resolve: {
      alias: workspaceAliases()
    },
    plugins: [
      vobsPlugin(),
      dshBundle({
        id: manifest.name,
        entry: path.join(packageDir, 'src', 'client', 'index.tsx')
      })
    ],
    build: {
      outDir: 'lib',
      emptyOutDir: false,
      target: 'es2020',
      minify: false,
      sourcemap: false,
      cssCodeSplit: false,
      rollupOptions: {
        output: {
          exports: 'named',
          inlineDynamicImports: true
        }
      }
    }
  })

  // Self-containment is decided precisely by dshBundle's generateBundle using chunk
  // metadata. This used to be a regex scan of the output text for `from '@vobs/...'`,
  // but that also counted **example code displayed as content** — the devkit panel
  // itself shows vobs import snippets, which caused false positives.

  const hostSize = (await stat(path.join(libDir, 'index.js'))).size
  const clientSize = (await stat(path.join(libDir, 'client.js'))).size
  console.log(
    `[dsh] ${manifest.name}  host ${(hostSize / 1024).toFixed(1)} KiB · client ${(clientSize / 1024).toFixed(1)} KiB`
  )
}
