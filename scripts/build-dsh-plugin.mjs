/**
 * 构建 DSH 插件包 packages/dsh-plugin 的产物：
 *
 *   lib/index.js   —— Host 半侧（cordis 插件，ESM）
 *   lib/client.js  —— Client 半侧（浏览器 bundle，window.__ModuleLoader__ factory）
 *
 * 为什么单独一个脚本、而不是走 build-packages.mjs：
 *   1. 客户端产物必须是**自包含**的经典脚本，除了平台内置的 react 之外不能被
 *      rollup 拆成 chunk（DSH 只支持自包含 chunk，`require('<id>/client')` 之外
 *      不允许同步 require 另一个相对产物）；
 *   2. 产物要包一层 `window.__ModuleLoader__.load({id, factory})`，这是 DSH 客户端
 *      模块系统的入口协议，不是普通 ESM/CJS 包；
 *   3. 该包不进 @vobs/* 发布火车，也不该被 tsup 的包构建流程接管。
 *
 * 依赖解析：脚本自己位于 <root>/scripts/，因此 `import 'vite'` 命中根 node_modules，
 * `@vobs/vite-plugin` 直接用它的构建产物相对路径导入（其自身的 @vobs/* 依赖由
 * packages/vite-plugin/node_modules 下的 workspace 软链解析）。这样插件包自己的
 * package.json 可以保持零依赖 —— GitHub/path: 直装时不会因为 workspace: 协议炸掉。
 *
 * 用法：pnpm build:dsh-plugin   （需要先 pnpm build:packages 产出 vite-plugin/dist）
 */
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'vite'
import { workspaceAliases } from './vite-workspace.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const pluginDir = path.join(root, 'packages', 'dsh-plugin')
const libDir = path.join(pluginDir, 'lib')

const pluginManifest = JSON.parse(await readFile(path.join(pluginDir, 'package.json'), 'utf8'))
const vobsManifest = JSON.parse(await readFile(path.join(root, 'packages', 'vobs', 'package.json'), 'utf8'))

const vitePluginEntry = path.join(root, 'packages', 'vite-plugin', 'dist', 'index.js')
if (!(await exists(vitePluginEntry))) {
  throw new Error(
    `找不到 ${path.relative(root, vitePluginEntry)}。先运行 pnpm build:packages 产出 @vobs/vite-plugin 的构建产物。`
  )
}
const { vobsPlugin } = await import(pathToFileURL(vitePluginEntry).href)

async function exists(target) {
  try {
    await stat(target)
    return true
  } catch {
    return false
  }
}

await mkdir(libDir, { recursive: true })

/* ---------------------------------------------------------------- Host 半侧 */

await build({
  configFile: false,
  root: pluginDir,
  logLevel: 'warn',
  build: {
    outDir: 'lib',
    emptyOutDir: true,
    target: 'es2022',
    minify: false,
    sourcemap: false,
    lib: {
      entry: path.join(pluginDir, 'src', 'host', 'index.ts'),
      formats: ['es'],
      fileName: () => 'index.js'
    }
  }
})

console.log(`[dsh-plugin] host   -> lib/index.js`)

/* -------------------------------------------------------------- Client 半侧 */

const clientOutDir = libDir
await build({
  configFile: false,
  root: pluginDir,
  logLevel: 'warn',
  define: {
    __VOBS_VERSION__: JSON.stringify(vobsManifest.version)
  },
  resolve: {
    alias: workspaceAliases()
  },
  plugins: [vobsPlugin()],
  build: {
    outDir: 'lib',
    emptyOutDir: false,
    target: 'es2020',
    minify: false,
    sourcemap: false,
    cssCodeSplit: false,
    lib: {
      entry: path.join(pluginDir, 'src', 'client', 'index.tsx'),
      formats: ['cjs'],
      fileName: () => 'client.cjs'
    },
    rollupOptions: {
      // react 由 DSH 的平台模块表提供，任何情况下都不许打进产物。
      external: ['react'],
      output: {
        exports: 'named',
        inlineDynamicImports: true
      }
    }
  }
})

const rawClient = await readFile(path.join(clientOutDir, 'client.cjs'), 'utf8')
const clientBundle = wrapAsModuleLoaderFactory(rawClient, pluginManifest.name)

await writeFile(path.join(clientOutDir, 'client.js'), clientBundle, 'utf8')
await rm(path.join(clientOutDir, 'client.cjs'), { force: true })
await rm(path.join(clientOutDir, 'client.cjs.map'), { force: true })

console.log(`[dsh-plugin] client -> lib/client.js (${(clientBundle.length / 1024).toFixed(1)} KiB)`)

/**
 * 把 rollup 的 CJS 产物包成 DSH 客户端模块系统的一次 factory 注册。
 * factory 内部补上 `module` / `exports` 垫片，让 CJS 产物原样运行，
 * 返回 default 导出（本包的插件对象）。
 */
function wrapAsModuleLoaderFactory(code, id) {
  const body = code
    .replace(/^['"]use strict['"];?\s*\n?/u, '')
    .replace(/\/\/# sourceMappingURL=.*$/gmu, '')
    .trimEnd()

  return `// 由 scripts/build-dsh-plugin.mjs 生成，请勿手改；改 src/ 后运行 pnpm build:dsh-plugin。
// DSH 客户端模块协议：只注册 factory，模块副作用延后到首次物化。
window.__ModuleLoader__.load({id:${JSON.stringify(id)},factory:function(require){
"use strict";
var module={exports:{}};var exports=module.exports;
${body}
var out=module.exports;
return (out&&out.__esModule&&Object.prototype.hasOwnProperty.call(out,"default"))?out.default:out;
}});
`
}
