/**
 * 构建仓库内的 DSH 插件包。
 *
 *   <pkg>/lib/index.js   —— Host 半侧（cordis 插件，ESM）
 *   <pkg>/lib/client.js  —— Client 半侧（浏览器 bundle，__ModuleLoader__ factory）
 *
 * 客户端那一半完全交给 @vobs/dsh 的 `dshBundle()`：外壳包装、自包含纯度门禁、
 * react 外置与平台引导都由适配层负责。这个脚本因此只是「怎么构建一个插件项目」的示范，
 * 也正是插件作者会写的 vite.config 的等价物。
 *
 * 依赖解析：脚本位于 <root>/scripts/，因此 `import 'vite'` 命中根 node_modules；
 * @vobs/vite-plugin 与 @vobs/dsh 直接用各自 dist 的相对路径导入。这样插件包自己的
 * package.json 可以保持零依赖 —— GitHub `#path:` 直装时不会因为 workspace: 协议炸掉。
 *
 * 用法：pnpm build:dsh                    # 全部
 *       pnpm build:dsh-plugin             # 只构建 dsh-plugin
 *       node scripts/build-dsh-plugins.mjs dsh-console
 */
import { mkdir, readFile, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'vite'
import { workspaceAliases } from './vite-workspace.mjs'

const DEFAULT_PACKAGES = ['dsh-plugin', 'dsh-console', 'dsh-devkit']

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
    throw new Error(`找不到 ${label} 的构建产物（${path.relative(root, target)}）。先运行 pnpm build:packages。`)
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
    throw new Error(`${manifest.name} 没有声明 dsh.client，不是 DSH 客户端插件包。`)
  }

  await mkdir(libDir, { recursive: true })

  /* -------------------------------------------------------------- Host 半侧 */

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

  /* ------------------------------------------------------------- Client 半侧 */

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

  // 自包含性由 dshBundle 的 generateBundle 用 chunk 元数据判定（精确）。这里曾经用
  // 正则在产物文本上找 `from '@vobs/...'`，但那会把**作为内容展示的示例代码**也算进去 ——
  // 开发台面板就展示了 vobs 的 import 写法，直接造成误报。

  const hostSize = (await stat(path.join(libDir, 'index.js'))).size
  const clientSize = (await stat(path.join(libDir, 'client.js'))).size
  console.log(
    `[dsh] ${manifest.name}  host ${(hostSize / 1024).toFixed(1)} KiB · client ${(clientSize / 1024).toFixed(1)} KiB`
  )
}
