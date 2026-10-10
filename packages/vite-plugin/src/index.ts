// Vite 插件：集成 Vobs 编译器

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { Plugin, ViteDevServer } from 'vite'
import { analyzeSource, compileWithSourceMap, createI18nExtractor, describeDiagnostics, type CompileOptions, type VobsSourceMap } from '@vobs/compiler'
import { VobsError, formatVobsError, type VobsErrorLocation, type VobsErrorOptions } from '@vobs/runtime/error'
import { compileHtmlComponent } from './html-component.ts'

/** 虚拟模块 id（`\0` 前缀是 rollup 的惯例，避免被当成真实文件解析）。 */
const GUARDRAILS_ID = '\0virtual:vobs-dev-guardrails'
/** 浏览器里的 URL 形式：vite 把 `\0` 编码成 `__x00__`。 */
const GUARDRAILS_URL = '/@id/__x00__virtual:vobs-dev-guardrails'
/** 护栏违规上报端点。 */
const VIOLATION_ENDPOINT = '/__vobs/violation'

/**
 * Windows 路径分隔符 → POSIX。
 *
 * 这不是样式偏好，而是**接口约定**：Vite/Rollup 的模块 id 一律用正斜杠，
 * 所以 `resolveId` 返回什么形态，`load` 随后收到的就是那个形态的**规范化结果**。
 * 此前 `resolveId` 返回 `path.resolve(...)` 的原始串（Windows 上是反斜杠），
 * 而 `load` 拿 `htmlModules.has(id)` 去查正斜杠 id —— `Set` 是精确匹配，永远不命中，
 * `load` 返回 null，裸 HTML 落到 `vite:import-analysis` 被当 JS 解析并抛
 * `Failed to parse source for import analysis`。整个 HTML 组件功能在 Windows 上失效。
 *
 * 只把反斜杠换成斜杠，不做 `resolve`/`realpath` 之类的规范化，
 * 以免改变大小写或消解符号链接（那会让 `htmlModules` 与实际 `readFile` 的目标不一致）。
 */
function toPosixPath(value: string): string {
  return value.replace(/\\/gu, '/')
}

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
  /** 项目根（`configResolved` 里取）—— 用于把绝对模块 id 归一成仓库相对路径。 */
  let projectRoot = ''

  /** dev 且未关闭时才装护栏。 */
  const guardrailsActive = (): boolean => !productionBuild && guardrailsEnabled

  /**
   * 传给编译器的**稳定**源名：项目相对 + POSIX 分隔符。
   *
   * ## 为什么不能直接用绝对 `id`
   *
   * 编译器会把源名写进产物的调试元数据（`resolveComponent(Comp, "<源名>", "Comp")`）。
   * 用绝对路径会有两个后果：
   *
   * 1. **构建产物不可复现**：Windows 上得到 `C:/Users/…`、Linux 上得到 `/home/runner/…`
   *    —— 同一份源码在不同平台产出不同字节。仓库的 CI 用
   *    `pnpm run build:dsh && git diff --exit-code` 校验"产物与源码同步"，
   *    于是**在 Windows 构建的产物永远无法通过 Linux 的校验**（实测差 ~100 字节）。
   * 2. **泄漏开发者机器路径**：这些路径随包发布出去，对使用者毫无意义。
   *
   * 归一成相对 POSIX 路径后，构建结果与平台无关，报错定位仍然可用（相对项目根）。
   *
   * 注意：只影响调试元数据与 sourcemap 的 `sources`，不改变任何运行时行为。
   */
  const stableSourceName = (id: string): string => {
    const clean = id.split(/[?#]/u, 1)[0]
    if (projectRoot === '' || !clean.startsWith(projectRoot)) return toPosixPath(clean)
    const relative = path.relative(projectRoot, clean)
    // `..` 开头说明它其实在项目根之外（如 monorepo 上层）—— 那时相对路径没有意义，保留原名
    return relative.startsWith('..') ? toPosixPath(clean) : toPosixPath(relative)
  }

  return {
    name: 'vobs',

    enforce: 'pre',

    configResolved(config) {
      productionBuild = config.command === 'build'
      hmrStateEnabled = (options.hmr ?? true) && !productionBuild && (options.hmrState ?? true)
      projectRoot = config.root ?? ''
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
      // 必须返回 POSIX 形态：load 收到的是 Vite 规范化后的正斜杠 id，
      // 反斜杠串在 htmlModules 里永远查不中（Windows 专属的整功能失效）。
      const resolved = toPosixPath(path.resolve(path.dirname(cleanImporter), cleanSource))
      htmlModules.add(resolved)
      return resolved
    },

    async load(id: string) {
      if (id === GUARDRAILS_ID) return guardrailsActive() ? createGuardrailsModule() : null
      // 防御性归一：即使某个调用方（或未来版本的 Vite）传回反斜杠形态也仍然命中
      if (!htmlModules.has(id) && !htmlModules.has(toPosixPath(id))) return null
      return compileHtmlComponent(await readFile(id, 'utf8'), { filename: stableSourceName(id) })
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
        filename: stableSourceName(id),
        // HMR 模块标识必须跨 ?t= 查询稳定（registry 复用语义依赖它），用干净路径。
        hmrModuleId: hmr ? cleanId : options.compiler?.hmrModuleId,
        // 显式配置优先；SSR 构建未显式配置时强制关闭（browser-only 优化）。
        hoistTemplates: options.compiler?.hoistTemplates ?? hoistTemplates,
        plugins: [
          ...(options.compiler?.plugins ?? []),
          ...(extractor ? [extractor.plugin] : [])
        ]
      })
      // 一次报全部：只取第一条的话，文件里有 5 处错误要构建 5 次才知道全貌
      const summary = describeDiagnostics(result.diagnostics)
      if (summary) {
        throw new VobsError({
          code: summary.primary.code,
          layer: 'compiler',
          message: summary.message,
          location: summary.primary.location,
          codeFrame: summary.primary.codeFrame,
          fix: summary.primary.fix
        })
      }
      /*
       * **warning 必须也报出来**（真实项目 2026-10-02 反馈）。
       *
       * 此前这里只处理错误：`describeDiagnostics` 内部
       * `diagnostics.filter(item => item.severity === 'error')`，没有错误就返回 `null`，
       * 于是**警告被静默丢弃**。实测后果：`VOBS_C105`（模块顶层 JSX）与
       * `VOBS_C104`（顶层条件 return，1.8.1 起降为 warning）在 `vite build` 里
       * **完全隐形** —— 只有 `vobs check` 能看到。用户的原话是
       * 「vite build 未拦属另一隐患」，这比"隐患"更严重：那两条诊断在主构建路径上
       * 等于不存在。
       *
       * 走 Vite 自己的告警通道（`this.warn`），构建输出与 dev server 都能看到；
       * 拿不到 PluginContext 时退回 `console.warn`（不静默）。
       *
       * 刻意**不**把 warning 升级成错误：它们的立论是启发式的（见 C104/C105 的注释），
       * 不该有挡构建的强度。要强拦可以在 CI 里把 warning 当失败。
       */
      const warnings = result.diagnostics.filter(item => item.severity === 'warning')
      /*
       * 分析器诊断（`C118`/`C232`/`C210` 静态规则）**也要在这里报**。
       *
       * 它们此前只在 `@vobs/cli` 的 `vobs check` 里可见 —— `vite dev`/`vite build`
       * **一条都不报**。后果：开发时看不到，只有人主动跑 `vobs check` 或 CI 才发现。
       * 这与「错了不能静默」直接冲突：**AI 改完代码、`vite build` 通过，但问题还在。**
       *
       * 规则本体已抽到 `@vobs/compiler`（vite-plugin 与 CLI 都依赖它），直接调用即可 ——
       * 见 `packages/compiler/src/analyze.ts` 的注释。
       */
      const analyzed = analyzeSource(code, cleanId)
      if (warnings.length > 0 || analyzed.length > 0) {
        const context = this as unknown as { warn?: (message: string) => unknown }
        const emit = typeof context.warn === 'function'
          ? (message: string): unknown => context.warn!(message)
          : (message: string): void => { console.warn(message) }
        const seen = new Set<string>()
        for (const warning of warnings) {
          const where = `${warning.location.file}:${warning.location.line}:${warning.location.column}`
          const text = `[vobs ${warning.code}] ${where}\n  ${warning.message}`
            + (warning.fix ? `\n  修法：${warning.fix}` : '')
          // 同一条诊断在同一文件里可能多处命中，按"代码+位置+消息"去重，避免刷屏
          const key = `${warning.code}|${where}|${warning.message}`
          if (seen.has(key)) continue
          seen.add(key)
          emit(text)
        }
        for (const item of analyzed) {
          // 分析器的 error 也走**告警通道**（不挡构建）：它是"写完之后、运行之前"的提示，
          // 让人构建不过会把开发流程卡死，而它并不是编译错误。
          const where = `${cleanId}:${item.line}:${item.column}`
          const key = `${item.code}|${where}|${item.message}`
          if (seen.has(key)) continue
          seen.add(key)
          emit(`[vobs ${item.code}] ${where}\n  ${item.message}`
            + (item.fix ? `\n  修法：${item.fix}` : '')
            + (item.snippet ? `\n  ${item.snippet}` : ''))
        }
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
