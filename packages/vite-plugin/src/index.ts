// Vite 插件：集成 Vobs 编译器

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { Plugin } from 'vite'
import { compileWithSourceMap, createI18nExtractor, type CompileOptions } from '@vobs/compiler'
import { VobsError } from '@vobs/runtime/error'
import { compileHtmlComponent } from './html-component.ts'

export interface VobsVitePluginOptions {
  include?: RegExp
  compiler?: CompileOptions
  hmr?: boolean
  /**
   * 模块级状态 HMR 保鲜（默认开启，仅 dev 生效）。开启后：
   * - 模块顶层 state() 声明编译为 hmrStateRef(...)，热更新重执行模块时复用既有信号，
   *   消除"新旧两份模块实例、两份状态"导致的编辑不生效/页面半边失灵；
   * - 声明了模块级 state 的 .ts 文件（store 类模块）也纳入 HMR 处理。
   */
  hmrState?: boolean
  extractI18n?: (key: string, filename: string) => void
  html?: boolean | { readonly extensions?: readonly string[] }
}

export function vobsPlugin(options: VobsVitePluginOptions = {}): Plugin {
  const include = options.include ?? /\.tsx(?:$|\?)/
  const htmlModules = new Set<string>()
  let productionBuild = false
  let hmrStateEnabled = (options.hmr ?? true) && (options.hmrState ?? true)

  return {
    name: 'vobs',

    enforce: 'pre',

    configResolved(config) {
      productionBuild = config.command === 'build'
      hmrStateEnabled = (options.hmr ?? true) && !productionBuild && (options.hmrState ?? true)
    },

    resolveId(source: string, importer: string | undefined) {
      if (!importer || !isHtmlComponent(source, options.html) || !isRelativeModule(source)) return null
      const cleanImporter = importer.split(/[?#]/u, 1)[0]
      const cleanSource = source.split(/[?#]/u, 1)[0]
      const resolved = path.resolve(path.dirname(cleanImporter), cleanSource)
      htmlModules.add(resolved)
      return resolved
    },

    async load(id: string) {
      if (!htmlModules.has(id)) return null
      return compileHtmlComponent(await readFile(id, 'utf8'), { filename: id })
    },

    transform(code: string, id: string) {
      const cleanId = id.split(/[?#]/u, 1)[0]
      const isTsx = cleanId.endsWith('.tsx')
      const isStateTs = isStateModulePath(cleanId)
      if (!isTsx && !isStateTs) return null
      if (options.include) {
        include.lastIndex = 0
        if (!include.test(id)) return null
      }

      // .ts 状态模块（store 类）：声明了模块级 state 才纳入编译与 HMR，
      // 避免对普通 .ts 全量重印。
      if (!isTsx && (!hmrStateEnabled || !isStatefulModule(code))) return null

      const extractor = options.extractI18n
        ? createI18nExtractor({ onKey: options.extractI18n })
        : undefined
      const hmr = options.hmr ?? !productionBuild
      const result = compileWithSourceMap(code, {
        ...options.compiler,
        // 生产构建默认剔除组件源码位置（错误定位走 source map）；显式配置优先。
        sourceLocation: options.compiler?.sourceLocation ?? !productionBuild,
        filename: id,
        // HMR 模块标识必须跨 ?t= 查询稳定（registry 复用语义依赖它），用干净路径。
        hmrModuleId: hmr ? cleanId : options.compiler?.hmrModuleId,
        plugins: [
          ...(options.compiler?.plugins ?? []),
          ...(extractor ? [extractor.plugin] : [])
        ]
      })
      const diagnostic = result.diagnostics.find(item => item.severity === 'error')
      if (diagnostic) {
        throw new VobsError({
          code: diagnostic.code,
          layer: 'compiler',
          message: diagnostic.message,
          location: diagnostic.location,
          codeFrame: diagnostic.codeFrame,
          fix: diagnostic.fix
        })
      }
      const hmrCode = hmr ? createHmrCode(cleanId) : ''
      return {
        code: `${result.code}${hmrCode}`,
        map: result.map
      }
    }
  }
}

/** 模块级 state 的 store 类 .ts 模块判定：从 @vobs 导入 state 且实际调用。 */
function isStatefulModule(code: string): boolean {
  return /\bimport\s+(?:type\s+)?\{[^}]*\bstate\b[^}]*\}\s*from\s*['"]@vobs\/(?:reactivity|vobs)['"]/u.test(code)
    && /(?<![\w$.])state\s*\(/u.test(code)
}

function isStateModulePath(cleanId: string): boolean {
  if (!cleanId.endsWith('.ts')) return false
  if (cleanId.endsWith('.d.ts')) return false
  if (cleanId.includes('node_modules')) return false
  return true
}

function isRelativeModule(source: string): boolean {
  return source.startsWith('./') || source.startsWith('../')
}

function isHtmlComponent(id: string, option: VobsVitePluginOptions['html']): boolean {
  if (option === false) return false
  const extensions = typeof option === 'object' && option.extensions?.length ? option.extensions : ['.html', '.htm']
  const cleanId = id.split(/[?#]/u, 1)[0]
  return extensions.some(extension => cleanId.endsWith(extension))
}


function createHmrCode(moduleId: string): string {
  const encodedId = JSON.stringify(moduleId)
  return `
import { disposeHmrModule, updateHmrModule } from '@vobs/vobs'

if (import.meta.hot) {
  import.meta.hot.accept((module) => {
    if (module) updateHmrModule(${encodedId}, module)
  })
  import.meta.hot.dispose(() => disposeHmrModule(${encodedId}))
}
`
}
