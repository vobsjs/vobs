import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { Plugin } from 'vite'
import { DSH_REACT_GLOBAL } from './react.js'

/**
 * rollup 产物的最小结构声明。
 *
 * 不直接引用 rollup 的类型：`vite` 没有把它们再导出，而为一个构建插件引入
 * rollup 作为依赖不划算。这里只声明本插件真正读写的字段。
 */
interface DshOutputChunk {
  type: 'chunk'
  fileName: string
  code: string
  map?: unknown
  /** rollup 给出的静态导入的模块 id（含 external）。 */
  imports?: readonly string[]
  /** 动态 import() 的模块 id。 */
  dynamicImports?: readonly string[]
}

interface DshOutputAsset {
  type: 'asset'
  fileName: string
}

type DshOutputBundle = Record<string, DshOutputChunk | DshOutputAsset>

/** 平台内置模块：由 DSH 的模块表提供，任何情况下都不许打进产物。 */
const DEFAULT_PLATFORM_MODULES = ['react'] as const

export interface DshBundleOptions {
  /** 浏览器模块 id，默认取所属 package.json 的 name。 */
  id?: string
  /**
   * 客户端入口。给了就顺手补上 `build.lib`（cjs / 单文件），
   * 不给则完全交给使用方自己的 build 配置。
   */
  entry?: string
  /** 额外需要外置的平台模块，默认已含 `react`。 */
  platformModules?: readonly string[]
  /** 产物文件名，默认 `client.js`。 */
  fileName?: string
  /** 关掉 React 引导注入（自己调用 `useDshReact` 时才需要关）。默认开启。 */
  react?: boolean
}

/**
 * 把 rollup 的 CJS 产物包成 DSH 客户端模块系统的一次 factory 注册。
 *
 * 产物形态：
 * ```js
 * window.__ModuleLoader__.load({ id: '<包名>', factory: function (require) {
 *   "use strict";
 *   var module = { exports: {} }; var exports = module.exports;
 *   globalThis.__VOBS_DSH_REACT__ = require('react');   // 平台模块，不进产物
 *   ...原 bundle...
 *   return module.exports.default ?? module.exports;
 * }});
 * ```
 *
 * @param code - rollup 产出的 CJS 代码
 * @param id - 浏览器模块身份，即包名
 * @param options - `react: false` 时跳过引导注入
 */
export function wrapAsModuleLoaderFactory(code: string, id: string, options: { react?: boolean } = {}): string {
  const body = code
    .replace(/^['"]use strict['"];?\s*\n?/u, '')
    .replace(/\/\/# sourceMappingURL=.*$/gmu, '')
    .trimEnd()

  const bootstrap =
    options.react === false
      ? ''
      : `globalThis[${JSON.stringify(DSH_REACT_GLOBAL)}]=require("react");\n`

  return `// 由 @vobs/dsh 的 dshBundle() 生成，请勿手改；改 src/ 后重新构建。
// DSH 客户端模块协议：只注册 factory，模块副作用延后到首次物化。
window.__ModuleLoader__.load({id:${JSON.stringify(id)},factory:function(require){
"use strict";
var module={exports:{}};var exports=module.exports;
${bootstrap}${body}
var out=module.exports;
return (out&&out.__esModule&&Object.prototype.hasOwnProperty.call(out,"default"))?out.default:out;
}});
`
}

/** 把使用方的 external 配置与本插件的平台模块合并成一个判定函数。 */
function makeExternalJudge(
  original: unknown,
  platform: readonly string[]
): (source: string, importer: string | undefined, isResolved: boolean) => boolean {
  return (source: string, importer: string | undefined, isResolved: boolean): boolean => {
    if (platform.includes(source)) return true
    if (typeof original === 'function') {
      return (original as (s: string, i?: string, r?: boolean) => unknown)(source, importer, isResolved) === true
    }
    if (Array.isArray(original)) return (original as readonly string[]).includes(source)
    if (typeof original === 'string') return original === source
    if (original instanceof RegExp) return original.test(source)
    return false
  }
}

function readManifest(root: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as Record<string, unknown>
  } catch {
    return undefined
  }
}

/** 从 exports 里取一个子路径，兼容字符串与一层条件对象。 */
function resolveExportPath(manifest: Record<string, unknown> | undefined, key: string): string | undefined {
  const exportsField = (manifest?.exports ?? {}) as Record<string, unknown>
  const entry = exportsField[key]
  if (typeof entry === 'string') return entry
  if (typeof entry === 'object' && entry !== null) {
    const record = entry as Record<string, unknown>
    for (const condition of ['default', 'import', 'require']) {
      const value = record[condition]
      if (typeof value === 'string') return value
    }
  }
  return undefined
}

/**
 * vobs → DSH 客户端插件的构建插件。
 *
 * 它替插件作者处理三件最容易出错的事：
 *   1. **产物形态** —— 自动包成 `window.__ModuleLoader__.load({ id, factory })`；
 *   2. **产物纯度** —— 产出自包含（单 chunk、无独立 asset、无动态 import），违反就构建失败，
 *      而不是装进 DSH 之后才发现；
 *   3. **平台模块** —— `react` 保持 external 并注入引导，绝不打进产物。
 *
 * 用法：
 * ```ts
 * // vite.config.ts
 * import { defineConfig } from 'vite'
 * import { vobsPlugin } from '@vobs/vite-plugin'
 * import { dshBundle } from '@vobs/dsh/vite'
 *
 * export default defineConfig({
 *   plugins: [vobsPlugin(), dshBundle({ entry: 'src/client/index.tsx' })],
 * })
 * ```
 */
export function dshBundle(options: DshBundleOptions = {}): Plugin {
  let fileName = options.fileName ?? 'client.js'
  const platform = [...DEFAULT_PLATFORM_MODULES, ...(options.platformModules ?? [])]
  let root = process.cwd()
  let packageName: string | undefined

  return {
    name: 'vobs:dsh-bundle',

    config(config) {
      const projectRoot = typeof config.root === 'string' ? config.root : process.cwd()
      const build = (config.build ??= {})

      // 由 package.json 的 exports["./client"] 反推产物应该落在哪 ——
      // 默认 vite 会写到 dist/，而 DSH 清单指向的通常是 lib/client.js。
      const declared = resolveExportPath(readManifest(projectRoot), './client')
      if (declared !== undefined) {
        const target = path.resolve(projectRoot, declared.replace(/^\.\//u, ''))
        fileName = path.basename(target)
        const expectedOutDir = path.relative(projectRoot, path.dirname(target)) || '.'
        if (build.outDir === undefined) {
          build.outDir = expectedOutDir
        } else if (path.normalize(String(build.outDir)) !== path.normalize(expectedOutDir)) {
          this.warn(
            `dshBundle: build.outDir 是 ${String(build.outDir)}，但 package.json 的 exports["./client"] 指向 ${declared}。` +
              '两者不一致时 DSH 会加载不到产物。'
          )
        }
      }

      if (options.entry !== undefined && build.lib === undefined) {
        build.lib = {
          entry: options.entry,
          formats: ['cjs'],
          fileName: () => 'client.cjs'
        }
      }
      build.rollupOptions ??= {}
      build.rollupOptions.external = makeExternalJudge(build.rollupOptions.external, platform)
    },

    configResolved(resolved) {
      root = resolved.root
      const manifest = readManifest(root)
      if (typeof manifest?.name === 'string') packageName = manifest.name

      const dsh = manifest?.dsh as Record<string, unknown> | undefined
      if (manifest !== undefined && dsh?.client === undefined) {
        this.warn(
          'package.json 里没有 dsh.client 声明，DSH 不会把这个包当作客户端插件。' +
            '需要形如 { "dsh": { "bundle": { "patch": "./cordis.patch.yml" }, "client": { "platform": "web" } } }。'
        )
      }
    },

    generateBundle(outputOptions, bundle: DshOutputBundle) {
      const items = Object.values(bundle)
      const chunks = items.filter((item): item is DshOutputChunk => item.type === 'chunk')
      const assetNames = items.filter((item): item is DshOutputAsset => item.type === 'asset').map(item => item.fileName)
      const sidecarMaps = assetNames.filter(name => name.endsWith('.map'))
      const foreignAssets = assetNames.filter(name => !name.endsWith('.map'))

      if (foreignAssets.length > 0) {
        this.error(
          `dshBundle: DSH 只接受自包含的单文件 bundle，但产出了独立资源：${foreignAssets.join(', ')}。` +
            'CSS 请内联为字符串（例如注入 shadow root），或关掉 cssCodeSplit。'
        )
      }

      if (chunks.length !== 1) {
        this.error(
          `dshBundle: 产物必须自包含，但生成了 ${chunks.length} 个 chunk（${chunks.map(c => c.fileName).join(', ')}）。` +
            '请设置 build.rollupOptions.output.inlineDynamicImports = true，并去掉动态 import()。'
        )
      }

      if (outputOptions.format !== 'cjs') {
        this.error(
          `dshBundle: DSH 的 factory 协议需要 CJS 产物，当前格式是 ${outputOptions.format}。` +
            "请设置 build.lib.formats = ['cjs']。"
        )
      }

      /*
       * 产物里不允许残留任何非平台模块的 import。
       *
       * 用 chunk 的元数据判定，**不要在产物文本上跑正则** —— `@vobs/*` 会作为示例代码、
       * 文档字符串出现在内容里（开发台面板就展示了 vobs 的 import 写法），按文本匹配会把
       * 「作为内容展示的 import」当成「没打包进去的依赖」，构建直接失败。
       */
      const platformSet = new Set(platform)
      const foreignImports = [...new Set(
        chunks.flatMap(item => [...(item.imports ?? []), ...(item.dynamicImports ?? [])])
          .filter(id => !platformSet.has(id))
      )]
      if (foreignImports.length > 0) {
        this.error(
          `dshBundle: 产物不是自包含的，残留了未打包的依赖：${foreignImports.join(', ')}。` +
            'DSH 的模块加载器解析不了裸导入 —— 检查 rollupOptions.external 是否把这些包外置了。'
        )
      }

      const chunk = chunks[0]
      if (chunk === undefined) return

      for (const map of sidecarMaps) {
        delete bundle[map]
      }
      if (sidecarMaps.length > 0) {
        this.warn('dshBundle: 外壳包装会让 sourcemap 偏移失效，已丢弃 .map 产物；如需调试请关掉 build.sourcemap。')
      }

      const id = options.id ?? packageName
      if (id === undefined) {
        this.error('dshBundle: 无法确定浏览器模块 id。给 dshBundle({ id }) 传一个，或确保 root 下有 package.json 且带 name。')
      }

      const previousName = chunk.fileName
      chunk.code = wrapAsModuleLoaderFactory(chunk.code, String(id), { react: options.react })
      chunk.map = null
      if (previousName !== fileName) {
        delete bundle[previousName]
        chunk.fileName = fileName
        bundle[fileName] = chunk
      }
    }
  }
}
