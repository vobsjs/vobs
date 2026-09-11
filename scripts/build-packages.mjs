import { copyFile, mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'tsup'

const root = fileURLToPath(new URL('..', import.meta.url))
// Keep this list aligned with the public package release allowlist.
const corePackages = ['reactivity', 'runtime', 'dom', 'vobs', 'compiler', 'icon-core', 'notification', 'auth', 'i18n', 'layout', 'resource', 'theme', 'ui', 'kit', 'router', 'forms', 'table', 'captcha', 'devtools', 'devtools-ui', 'dict', 'http', 'jwt-auth', 'logger', 'preferences', 'queue', 'ssr', 'storage', 'sync', 'tailwind', 'test-utils', 'transition', 'upload', 'vite-plugin', 'cli', 'payment']
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
      // 独立的 .d.ts（如 jsx.d.ts 全局类型声明）不是构建入口，tsup 不会为它们生成产物，
      // 这里直接复制进 dist（已存在的目标说明是 tsup 生成的同入口类型，不覆盖）。
      // 注意先于通用 .ts$ 判断：.d.ts 同样以 .ts 结尾。
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
  // workspace 依赖走 @vobs/* 正则；其余 dependencies/peerDependencies（如 typescript、parse5）
  // 必须显式外置，否则会被内联进 dist（node_modules 软链接与 workspace 路径导致自动外置失效）
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
      // platform: node 自动外置 Node 内置模块
      options.platform = 'node'
      options.keepNames = true
      if (options.format === 'cjs') {
        // esbuild 在 CJS 产物中会把 import.meta 变成空对象（运行时崩溃）。
        // define 值只允许标识符/字面量，因此先替换成标识符，再用 banner 注入实现；
        // ESM 产物保留原生 import.meta.url
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
