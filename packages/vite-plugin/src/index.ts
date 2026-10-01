// Vite 插件：集成 Vobs 编译器

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { Plugin, ViteDevServer } from 'vite'
import { compileWithSourceMap, createI18nExtractor, type CompileOptions, type VobsSourceMap } from '@vobs/compiler'
import { VobsError, formatVobsError, type VobsErrorLocation, type VobsErrorOptions } from '@vobs/runtime/error'
import { compileHtmlComponent } from './html-component.ts'

/** 虚拟模块 id（`\0` 前缀是 rollup 的惯例，避免被当成真实文件解析）。 */
const GUARDRAILS_ID = '\0virtual:vobs-dev-guardrails'
/** 浏览器里的 URL 形式：vite 把 `\0` 编码成 `__x00__`。 */
const GUARDRAILS_URL = '/@id/__x00__virtual:vobs-dev-guardrails'
/** 护栏违规上报端点。 */
const VIOLATION_ENDPOINT = '/__vobs/violation'

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
  /**
   * 开发期护栏（默认开启，仅 dev 生效）。开启后在页面里自动装上
   * `@vobs/vobs/dev` 的 `installDevGuardrails()`，并把违规回传到 dev server
   * 打印在终端 —— 这样 AI 读终端就能看到「effect 自订阅」这类静默错误的明确报错。
   *
   * 页面里没装 `@vobs/vobs` 时自动跳过，只在控制台留一句提示。
   */
  devGuardrails?: boolean
}

export function vobsPlugin(options: VobsVitePluginOptions = {}): Plugin {
  const include = options.include ?? /\.tsx(?:$|\?)/
  const htmlModules = new Set<string>()
  const guardrailsEnabled = options.devGuardrails ?? true
  let productionBuild = false
  let hmrStateEnabled = (options.hmr ?? true) && (options.hmrState ?? true)

  /** dev 且未关闭时才装护栏。 */
  const guardrailsActive = (): boolean => !productionBuild && guardrailsEnabled

  return {
    name: 'vobs',

    enforce: 'pre',

    configResolved(config) {
      productionBuild = config.command === 'build'
      hmrStateEnabled = (options.hmr ?? true) && !productionBuild && (options.hmrState ?? true)
    },

    transformIndexHtml() {
      if (!guardrailsActive()) return undefined
      // 只返回 tag 数组：返回 { html } 会**替换**整份 HTML（不是合并）
      return [{
        tag: 'script',
        attrs: { type: 'module', src: GUARDRAILS_URL },
        injectTo: 'head-prepend' as const
      }]
    },

    configureServer(server: ViteDevServer) {
      if (!guardrailsEnabled) return
      server.middlewares.use((req, res, next) => {
        if (req.method !== 'POST' || req.url?.split('?', 1)[0] !== VIOLATION_ENDPOINT) {
          next()
          return
        }
        let body = ''
        req.on('data', chunk => { body += String(chunk) })
        req.on('end', () => {
          printViolation(server, body)
          res.statusCode = 204
          res.end()
        })
      })
    },

    resolveId(source: string, importer: string | undefined) {
      if (source === GUARDRAILS_ID) return GUARDRAILS_ID
      if (!importer || !isHtmlComponent(source, options.html) || !isRelativeModule(source)) return null
      const cleanImporter = importer.split(/[?#]/u, 1)[0]
      const cleanSource = source.split(/[?#]/u, 1)[0]
      const resolved = path.resolve(path.dirname(cleanImporter), cleanSource)
      htmlModules.add(resolved)
      return resolved
    },

    async load(id: string) {
      if (id === GUARDRAILS_ID) return guardrailsActive() ? createGuardrailsModule() : null
      if (!htmlModules.has(id)) return null
      return compileHtmlComponent(await readFile(id, 'utf8'), { filename: id })
    },

    transform(code: string, id: string, transformOptions?: { readonly ssr?: boolean }): { code: string; map: VobsSourceMap } | null {
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
      // SSR/Node 构建必须关闭静态模板提升：createTemplate 依赖 document，产物在服务端加载即崩。
      const hoistTemplates = !transformOptions?.ssr
      const result = compileWithSourceMap(code, {
        ...options.compiler,
        // 生产构建默认剔除组件源码位置（错误定位走 source map）；显式配置优先。
        sourceLocation: options.compiler?.sourceLocation ?? !productionBuild,
        filename: id,
        // HMR 模块标识必须跨 ?t= 查询稳定（registry 复用语义依赖它），用干净路径。
        hmrModuleId: hmr ? cleanId : options.compiler?.hmrModuleId,
        // 显式配置优先；SSR 构建未显式配置时强制关闭（browser-only 优化）。
        hoistTemplates: options.compiler?.hoistTemplates ?? hoistTemplates,
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

/** 模块级 state 的 store 类 .ts 模块判定：从 @vobs 导入 state 且实际调用。 */function isStatefulModule(code: string): boolean {
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


/**
 * 注入到页面里的护栏模块。
 *
 * 两个刻意的选择：
 * 1. 用**动态** import 而不是静态 import：app 不一定依赖 `@vobs/vobs`（只用
 *    `@vobs/reactivity` 的项目也存在），静态 import 解析失败会直接让页面白屏 ——
 *    开发期护栏绝不该让开发环境变得更糟。
 * 2. 用 `.then()` 而不是顶层 await：TLA 需要浏览器与构建 target 都支持，而这里
 *    完全不需要 —— 护栏晚一个微任务装上没有任何影响。
 */
function createGuardrailsModule(): string {
  return `
const endpoint = ${JSON.stringify(VIOLATION_ENDPOINT)}

// 上报失败无所谓：护栏是开发期辅助，不影响应用本身
const report = payload => {
  fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  }).catch(() => {})
}

import('@vobs/vobs/dev').then(guardrails => {
  guardrails.installDevGuardrails?.({
    onViolation: ({ error, count }) => report({
      code: error.code,
      severity: error.severity,
      layer: error.layer,
      message: error.message,
      fix: error.fix,
      example: error.example,
      location: error.location,
      count
    })
  })
}).catch(error => {
  console.warn('[vobs] 开发期护栏未启用：页面没有安装 @vobs/vobs。', error?.message ?? error)
})
`
}

/** 把浏览器上报的违规打到 dev server 终端。重复命中（count > 1）不再打印。 */
function printViolation(server: ViteDevServer, body: string): void {
  let payload: VobsErrorOptions & { location?: VobsErrorLocation; count?: number }
  try {
    payload = JSON.parse(body) as typeof payload
  } catch {
    return
  }
  if (typeof payload?.code !== 'string' || (payload.count ?? 1) > 1) return
  server.config.logger.error(formatVobsError(new VobsError(payload), { environment: 'development' }), { timestamp: true })
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
