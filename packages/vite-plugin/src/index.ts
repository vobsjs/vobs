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
  extractI18n?: (key: string, filename: string) => void
  html?: boolean | { readonly extensions?: readonly string[] }
}

export function vobsPlugin(options: VobsVitePluginOptions = {}): Plugin {
  const include = options.include ?? /\.tsx(?:$|\?)/
  const htmlModules = new Set<string>()
  let productionBuild = false

  return {
    name: 'vobs',

    enforce: 'pre',

    configResolved(config) {
      productionBuild = config.command === 'build'
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
      include.lastIndex = 0
      if (!include.test(id)) return null

      const extractor = options.extractI18n
        ? createI18nExtractor({ onKey: options.extractI18n })
        : undefined
      const result = compileWithSourceMap(code, {
        ...options.compiler,
        // 生产构建默认剔除组件源码位置（错误定位走 source map）；显式配置优先。
        sourceLocation: options.compiler?.sourceLocation ?? !productionBuild,
        filename: id,
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
      const hmr = options.hmr ?? !productionBuild
      const hmrCode = hmr ? createHmrCode(id) : ''
      return {
        code: `${result.code}${hmrCode}`,
        map: result.map
      }
    }
  }
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
