import ts from 'typescript'
import { VobsError } from '@vobs/runtime/error'
import { domAttributeName, isPropertyName } from '@vobs/runtime/dom-props'
import { isSvgTag } from '@vobs/runtime/svg'
import { resolveEventName } from './dom-events'
import type {
  CompilerContext,
  CompilerOptions,
  CompilerPlugin,
  CompileOptions,
  CompileResult,
  CompilerDiagnostic,
  VobsCompiler
} from './plugin'

/**
 * 单次编译的全部可变状态。
 *
 * 此前这些字段是模块级变量，编译器因此不可重入：嵌套调用 compile()
 * （如插件内部再次编译片段）会互相污染状态。现在每次 compile 调用
 * 创建独立的 CompileState 并显式穿参，编译器对并发与嵌套完全安全。
 */
interface CompileState {
  /** 临时标识符计数器（_el0、_el1…）。 */
  generatedId: number
  filename: string
  /** 最初解析出的源文件。插件 program 变换后的树节点无法回溯原始位置时，用它兜底取行列。 */
  sourceFile: ts.SourceFile
  /** 生成语句 → 原始源码位置，用于 source map 生成。 */
  statementSources: WeakMap<ts.Statement, SourcePosition>
  /** 源文件中已声明的绑定名（含嵌套作用域）：注入运行时 import 与生成临时变量时避开命名冲突。 */
  takenNames: Set<string>
  /** 运行时 helper 的规范名 → 产物中的引用名（无冲突时与规范名相同）。 */
  helperAliases: Map<string, string>
  /** 静态模板声明：HTML → 模块级模板变量，按内容去重，输出在 import 之后。 */
  templates: Map<string, ts.Identifier>
  /** 是否为组件调用生成源码位置（生产构建传 false 剔除，减小产物体积）。 */
  sourceLocation: boolean
  /** 从 @vobs/reactivity / @vobs/vobs 导入的 `state` 别名（含 as 别名），用于 debugName 自动推断。 */
  stateAliases: ReadonlySet<string>
  /** 非 import 的本地声明绑定名：`state` 被本地声明遮蔽时禁用 debugName 推断。 */
  localBindings: ReadonlySet<string>
  /** 编译器自身产出的诊断（如不支持的 JSX 形态），与 TypeScript 解析诊断合并返回。 */
  diagnostics: CompilerDiagnostic[]
  /** HMR 模块标识：提供后模块顶层 state() 声明包装为 hmrStateRef，跨热更新保活信号。 */
  hmrModuleId: string | null
  /** 是否把完全静态的 DOM 子树提升为 HTML 模板（createTemplate 依赖 document，SSR/Node 构建必须关闭）。 */
  hoistTemplates: boolean
  /**
   * 当前正在编译的 DOM 子树是否位于 SVG 命名空间内（>0 表示是）。
   *
   * 标签名只能决定「SVG 专属标签」（svg/g/rect…，运行时按 SVG_TAGS 处理），但
   * a / title / style / script 与 HTML 同名 —— 在 `<svg>` 里它们必须是 SVG 元素。
   * 光看名字会把 `<svg><a href="…">` 建成 HTML 锚点（CHANGELOG 自认的已知问题）。
   * 编译器知道祖先链，所以由它显式告诉运行时用哪个命名空间。
   * `<foreignObject>` 会把它的子树切回 HTML，所以是「深度」而不是布尔。
   */
  svgDepth: number
}

interface SourcePosition {
  readonly line: number
  readonly column: number
}

export function createCompiler(options: CompilerOptions = {}): VobsCompiler {
  const basePlugins = options.plugins ?? []

  return {
    compile(code: string, overrides: CompileOptions = {}): string {
      return compile(code, {
        ...overrides,
        plugins: [...basePlugins, ...(overrides.plugins ?? [])]
      })
    },
    compileWithSourceMap(code: string, overrides: CompileOptions = {}): CompileResult {
      return compileWithSourceMap(code, {
        ...overrides,
        plugins: [...basePlugins, ...(overrides.plugins ?? [])]
      })
    }
  }
}

/**
 * 把「同一次编译里的全部错误」拼进一条消息。
 *
 * 原来 compile() / Vite 插件都只取第一条（`find`），于是文件里有 5 处错误时，
 * 开发者要构建 5 次、每次修一处才知道全貌 —— 诊断一次只给一条是最费时间的形态。
 * 主错误保留它的 location / codeFrame，其余以清单附在后面。
 */
export function describeDiagnostics(diagnostics: readonly CompilerDiagnostic[]): {
  readonly primary: CompilerDiagnostic
  readonly message: string
} | null {
  const errors = diagnostics.filter(item => item.severity === 'error')
  if (errors.length === 0) return null
  const [primary] = errors
  if (errors.length === 1) return { primary, message: primary.message }

  const rest = errors.slice(1).map(item => {
    const where = `${item.location.file}:${item.location.line}:${item.location.column}`
    return `  ${item.code}  ${where}  ${item.message}`
  })
  return {
    primary,
    message: `${primary.message}\n\n同一文件还有 ${errors.length - 1} 处错误：\n${rest.join('\n')}`
  }
}

export function compile(code: string, options: CompileOptions = {}): string {
  const result = compileWithSourceMap(code, options)
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
  return result.code
}

export function compileWithSourceMap(code: string, options: CompileOptions = {}): CompileResult {
  const filename = options.filename ?? 'component.tsx'
  let sourceFile = ts.createSourceFile(
    filename,
    code,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  )
  const state: CompileState = {
    generatedId: 0,
    filename,
    sourceFile,
    statementSources: new WeakMap(),
    takenNames: collectDeclaredNames(sourceFile),
    helperAliases: new Map(),
    templates: new Map(),
    sourceLocation: options.sourceLocation ?? true,
    stateAliases: collectStateAliases(sourceFile),
    localBindings: collectLocallyDeclaredNames(sourceFile),
    diagnostics: [],
    hmrModuleId: options.hmrModuleId ?? null,
    hoistTemplates: options.hoistTemplates ?? true,
    svgDepth: 0
  }
  const cleanFilename = filename.split(/[?#]/u, 1)[0] || filename
  const diagnostics = ts.transpileModule(code, {
    // Vite appends query strings (for example `?direct`) to module IDs;
    // strip them so TypeScript still recognizes TSX syntax for diagnostics.
    fileName: cleanFilename,
    reportDiagnostics: true,
    compilerOptions: { jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.Latest }
  }).diagnostics?.map(diagnostic => toCompilerDiagnostic(diagnostic, sourceFile, cleanFilename)) ?? []
  const plugins = options.plugins ?? []
  validatePlugins(plugins)

  const context: CompilerContext = {
    filename,
    factory: ts.factory,
    addRuntimeImport(name: string): void {
      resolveHelperName(state, name)
    },
    helperRef: (name: string) => helperRef(state, name)
  }

  for (const plugin of plugins) plugin.analyze?.(sourceFile, context)
  for (const plugin of plugins) {
    sourceFile = plugin.transform?.program?.(sourceFile, context) ?? sourceFile
  }
  for (const plugin of plugins) sourceFile = transformPluginNodes(sourceFile, plugin, context)

  const statements = sourceFile.statements.map(statement =>
    ts.isImportDeclaration(statement) ? rebuildImport(state, statement) : transformStatement(state, statement, true)
  )
  // 残留 JSX（主转换未覆盖的早返回/嵌套分支）必须先于 runtime import 与模板声明转换：
  // 兜底过程会注册新的 helper 别名（如 insertDynamicValue）与 _tpl 模板声明，
  // 若在其之后才构建 import 与声明，生成的引用将指向未定义的标识符（运行时 ReferenceError）。
  sourceFile = transformResidualJsx(state, ts.factory.updateSourceFile(sourceFile, statements))
  // 模板声明必须先于 runtime import 生成：声明里的 createTemplate 依赖
  // helperRef 注册别名，import 需要在别名全部就绪后再构建。
  const templateDeclarations = createTemplateDeclarations(state)
  const resultFile = ts.factory.updateSourceFile(sourceFile, [
    ...createRuntimeImports(state),
    ...templateDeclarations,
    ...sourceFile.statements
  ])

  const generated = ts.createPrinter().printFile(resultFile)
  return {
    code: generated,
    map: buildSourceMap(state, filename, code, generated, resultFile),
    diagnostics: [...diagnostics, ...state.diagnostics]
  }
}

function toCompilerDiagnostic(
  diagnostic: ts.Diagnostic,
  sourceFile: ts.SourceFile,
  filename: string
): CompilerDiagnostic {
  const start = diagnostic.start ?? 0
  const length = diagnostic.length ?? 1
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
  const { line, column, codeFrame } = buildCodeFrame(sourceFile, start, length)
  return {
    code: `VOBS_C${String(diagnostic.code).padStart(3, '0')}`,
    severity: diagnostic.category === ts.DiagnosticCategory.Warning ? 'warning' : 'error',
    message,
    location: { file: filename, line, column },
    codeFrame
  }
}

/** 制表符展开宽度：只为让 codeFrame 里的 ^ 对齐，不改动源码本身。 */
const CODE_FRAME_TAB_WIDTH = 4

/**
 * 插入符要按**显示宽度**定位，不是字符数。
 *
 * `lineText` 里的 tab 在终端里占多列，而原来按字符数 `' '.repeat(character)` 补位，
 * 带缩进的代码（用 tab 缩进的仓库很常见）会把 `^` 指到右边好几列之外 —— 诊断里最关键的
 * 那个定位就废了。展开 tab 并同步计数即可。
 */
function displayWidthOf(text: string, end: number): number {
  let width = 0
  const limit = Math.min(end, text.length)
  for (let index = 0; index < limit; index += 1) {
    width += text[index] === '\t' ? CODE_FRAME_TAB_WIDTH : 1
  }
  return width
}

function buildCodeFrame(
  sourceFile: ts.SourceFile,
  start: number,
  length: number
): { line: number; column: number; codeFrame: string } {
  const position = sourceFile.getLineAndCharacterOfPosition(start)
  const rawLine = sourceFile.text.split(/\r?\n/u)[position.line] ?? ''
  const lineText = rawLine.replace(/\t/gu, ' '.repeat(CODE_FRAME_TAB_WIDTH))
  const gutter = String(position.line + 1).length + 3
  const caretStart = displayWidthOf(rawLine, position.character)
  const caretLength = Math.max(
    1,
    Math.min(
      displayWidthOf(rawLine, position.character + length) - caretStart,
      Math.max(1, lineText.length - caretStart)
    )
  )
  return {
    line: position.line + 1,
    column: position.character + 1,
    codeFrame: `${position.line + 1} | ${lineText}\n${' '.repeat(gutter + caretStart)}${'^'.repeat(caretLength)}`
  }
}

/**
 * 不支持的 JSX 标签形态（成员表达式 `<Foo.Bar>`、命名空间 `<svg:rect>` 等）。
 * 诊断以 error 级返回，compile() 与 Vite 插件会直接失败，不再静默产出无效 DOM 标签。
 */
function reportUnsupportedTag(state: CompileState, tagName: ts.JsxTagNameExpression): void {
  const sourceFile = tagName.getSourceFile() ?? state.sourceFile
  if (!sourceFile) return
  const label = tagName.getText()
  const kindNote = tagName.kind === ts.SyntaxKind.JsxNamespacedName ? '（JSX 命名空间标签）' : ''
  const { line, column, codeFrame } = buildCodeFrame(sourceFile, tagName.getStart(sourceFile), tagName.getWidth(sourceFile))
  state.diagnostics.push({
    code: 'VOBS_C101',
    severity: 'error',
    message: `不支持的 JSX 标签形态：<${label}>${kindNote}。组件必须是大写开头的标识符，DOM 元素必须是小写标签名。`,
    location: { file: state.filename, line, column },
    codeFrame,
    fix: `把 <${label}> 改为 <Component /> 形式的组件或小写 DOM 标签；Fragment 请使用 <Fragment> 或 <>...</>。`
  })
}

/**
 * `on*` 属性名的诊断。
 *
 * 只在**不可能是对**的情况下报 error；能工作与自定义事件都只报警告 ——
 * 目的不是拦人，而是把「绑到不存在的事件上、回调永不触发且毫无声音」这件事说出来。
 */
function reportEventName(state: CompileState, attribute: ts.JsxAttribute, name: string): void {
  const resolved = resolveEventName(name)
  if (resolved === undefined) return
  const sourceFile = attribute.getSourceFile() ?? state.sourceFile
  if (!sourceFile) return

  const { eventName, camelCase, known } = resolved
  let severity: CompilerDiagnostic['severity']
  let message: string
  let fix: string

  if (!camelCase && !known) {
    // once → "ce"：既不符合驼峰约定，又不是任何已知事件 —— 一定是写错了属性名
    severity = 'error'
    message = `"${name}" 被当成事件处理器，绑到的事件名是 "${eventName}"：既不符合 on + 大写字母的约定，也不是已知的 DOM 事件。回调永远不会触发，而且不会有任何报错。`
    fix = `事件处理器写成 on + 大写字母开头（如 onClick / onDoubleClick）；若这本来不是事件处理器，请换个属性名，或在 effect 里用 addEventListener 显式绑定。`
  } else if (!camelCase) {
    // onclick → "click"：能工作，但不是约定写法
    severity = 'warning'
    message = `"${name}" 能工作（绑到 "${eventName}"），但事件属性按约定要写成 on + 大写字母开头。小写形式只是碰巧对得上，换个名字就会静默失效（"once" 会绑到 "ce"）。`
    fix = `改成 on${name.slice(2, 3).toUpperCase()}${name.slice(3)}。`
  } else if (!known) {
    // onFoo → "foo"：可能是自定义事件，也可能是拼错
    severity = 'warning'
    message = `"${name}" 绑到的事件名 "${eventName}" 不是已知的 DOM 事件。若是自定义事件（dispatchEvent）可以忽略；若是拼写错误，回调不会触发且不会有任何报错。`
    fix = `确认事件名拼写，或确认 "${eventName}" 确实由你的代码 dispatchEvent 出来。`
  } else {
    return
  }

  const { line, column, codeFrame } = buildCodeFrame(sourceFile, attribute.getStart(sourceFile), attribute.getWidth(sourceFile))
  state.diagnostics.push({
    code: 'VOBS_C102',
    severity,
    message,
    location: { file: state.filename, line, column },
    codeFrame,
    fix
  })
}

interface MappingSegment {
  readonly genLine: number
  readonly genCol: number
  readonly srcLine: number
  readonly srcCol: number
}

/**
 * Build a real statement-level source map. The generated file is re-parsed and
 * paired structurally with the compiled tree (statements map 1:1 inside every
 * block), so each emitted statement points back to the JSX or original
 * statement it was produced from.
 */
function buildSourceMap(
  state: CompileState,
  filename: string,
  source: string,
  generated: string,
  resultFile: ts.SourceFile
): import('./plugin').VobsSourceMap {
  const reparsed = ts.createSourceFile(filename, generated, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const segments: MappingSegment[] = []
  walkPairedTrees(state, resultFile, reparsed, reparsed, segments)
  segments.sort((a, b) => a.genLine - b.genLine || a.genCol - b.genCol)
  return {
    version: 3,
    file: filename,
    sources: [filename],
    sourcesContent: [source],
    names: [],
    mappings: encodeMappings(segments, generated.split('\n').length)
  }
}

/** Statements only nest inside these container kinds. */
function statementLists(node: ts.Node): readonly ts.Statement[] | null {
  if (ts.isSourceFile(node) || ts.isBlock(node) || ts.isModuleBlock(node)) return node.statements
  if (ts.isCaseClause(node) || ts.isDefaultClause(node)) return node.statements
  return null
}

/**
 * Pair the compiled tree with the re-parsed generated tree node by node.
 * Both trees were printed from the same AST, so their shapes are identical;
 * any divergence (length mismatch) simply abandons that subtree.
 */
function walkPairedTrees(
  state: CompileState,
  original: ts.Node,
  generated: ts.Node,
  reparsed: ts.SourceFile,
  segments: MappingSegment[]
): void {
  const originalStatements = statementLists(original)
  const generatedStatements = statementLists(generated)
  if (originalStatements && generatedStatements) {
    if (originalStatements.length !== generatedStatements.length) return
    for (let index = 0; index < originalStatements.length; index++) {
      const originalStatement = originalStatements[index]
      const generatedStatement = generatedStatements[index]
      recordSegment(state, originalStatement, generatedStatement, reparsed, segments)
      walkPairedTrees(state, originalStatement, generatedStatement, reparsed, segments)
    }
    return
  }

  const originalChildren: ts.Node[] = []
  const generatedChildren: ts.Node[] = []
  ts.forEachChild(original, node => { originalChildren.push(node) })
  ts.forEachChild(generated, node => { generatedChildren.push(node) })
  if (originalChildren.length !== generatedChildren.length) return
  for (let index = 0; index < originalChildren.length; index++) {
    walkPairedTrees(state, originalChildren[index], generatedChildren[index], reparsed, segments)
  }
}

function recordSegment(
  state: CompileState,
  originalStatement: ts.Statement,
  generatedStatement: ts.Statement,
  reparsed: ts.SourceFile,
  segments: MappingSegment[]
): void {
  const source = state.statementSources.get(originalStatement) ?? positionOfOriginalStatement(state, originalStatement)
  if (!source) return
  const position = reparsed.getLineAndCharacterOfPosition(generatedStatement.getStart(reparsed))
  segments.push({
    genLine: position.line,
    genCol: position.character,
    srcLine: source.line,
    srcCol: source.column
  })
}

function positionOfOriginalStatement(state: CompileState, statement: ts.Statement): SourcePosition | null {
  if (statement.pos < 0 || !state.sourceFile) return null
  const { line, character } = state.sourceFile.getLineAndCharacterOfPosition(
    statement.getStart(state.sourceFile)
  )
  return { line, column: character }
}

function encodeMappings(segments: readonly MappingSegment[], lineCount: number): string {
  const lines: string[][] = Array.from({ length: lineCount }, () => [])
  let prevGenLine = -1
  let prevGenCol = 0
  let prevSrcLine = 0
  let prevSrcCol = 0
  for (const segment of segments) {
    if (segment.genLine !== prevGenLine) {
      prevGenCol = 0
      prevGenLine = segment.genLine
    }
    const values = [
      segment.genCol - prevGenCol,
      0,
      segment.srcLine - prevSrcLine,
      segment.srcCol - prevSrcCol
    ]
    lines[segment.genLine].push(values.map(encodeVlq).join(''))
    prevGenCol = segment.genCol
    prevSrcLine = segment.srcLine
    prevSrcCol = segment.srcCol
  }
  return lines.map(line => line.join(',')).join(';')
}

const base64Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function encodeVlq(value: number): string {
  let encoded = value < 0 ? ((-value) << 1) | 1 : value << 1
  let result = ''
  do {
    let digit = encoded & 31
    encoded >>>= 5
    if (encoded > 0) digit |= 32
    result += base64Chars[digit]
  } while (encoded > 0)
  return result
}

function validatePlugins(plugins: readonly CompilerPlugin[]): void {
  const names = new Set<string>()
  for (const plugin of plugins) {
    if (!plugin.name) throw new VobsError({ code: 'VOBS_C007', layer: 'compiler', message: '编译器插件必须提供 name', fix: '为插件添加稳定且唯一的 name。' })
    if (names.has(plugin.name)) throw new VobsError({ code: 'VOBS_C007', layer: 'compiler', message: `检测到重复插件: ${plugin.name}`, fix: '为每个编译器插件使用唯一的 name。' })
    names.add(plugin.name)
  }
}

function transformPluginNodes(
  sourceFile: ts.SourceFile,
  plugin: CompilerPlugin,
  context: CompilerContext
): ts.SourceFile {
  const transformNode = plugin.transform?.node ?? plugin.transformNode
  if (!transformNode) return sourceFile

  const transformer: ts.TransformerFactory<ts.SourceFile> = transformContext => root => {
    const visit: ts.Visitor = node => {
      const replacement = transformNode(node, context)
      if (replacement === null) return undefined
      return ts.visitEachChild(replacement ?? node, visit, transformContext)
    }
    return ts.visitNode(root, visit) as ts.SourceFile
  }

  const result = ts.transform(sourceFile, [transformer])
  try {
    return result.transformed[0]
  } finally {
    result.dispose()
  }
}

/**
 * Collect every binding name declared anywhere in the source (imports, variables,
 * functions, parameters, ... including nested scopes). If a helper name is bound
 * in ANY scope, the injected runtime import must switch to an alias: generated
 * references uniformly use the alias, so user code is never captured or duplicated.
 */
function collectDeclaredNames(sourceFile: ts.SourceFile): Set<string> {
  const names = new Set<string>()
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && isBindingName(node)) names.add(node.text)
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return names
}

/** 收集从 @vobs/reactivity / @vobs/vobs 导入的 `state` 绑定名（含 `as` 别名）。 */
function collectStateAliases(sourceFile: ts.SourceFile): Set<string> {
  const aliases = new Set<string>()
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
    const module = statement.moduleSpecifier.text
    if (module !== '@vobs/reactivity' && module !== '@vobs/vobs') continue
    const clause = statement.importClause
    if (!clause?.namedBindings || !ts.isNamedImports(clause.namedBindings)) continue
    for (const element of clause.namedBindings.elements) {
      if (element.propertyName ? element.propertyName.text === 'state' : element.name.text === 'state') {
        aliases.add(element.name.text)
      }
    }
  }
  return aliases
}

/** 与 collectDeclaredNames 相同，但跳过 import 声明：用于判断 helper 名是否被本地声明遮蔽。 */
function collectLocallyDeclaredNames(sourceFile: ts.SourceFile): Set<string> {
  const names = new Set<string>()
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) return
    if (ts.isIdentifier(node) && isBindingName(node)) names.add(node.text)
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return names
}

/** 标识符是否为某个声明的绑定名（import、变量、函数、参数、类成员等）。 */
function isBindingName(node: ts.Identifier): boolean {
  const parent = node.parent
  if (!parent) return false
  // 属性访问（document.createElement）与 JSX 属性名不是绑定名
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false
  if (ts.isQualifiedName(parent) && parent.right === node) return false
  if (ts.isJsxAttribute(parent)) return false
  return (parent as { name?: ts.Node }).name === node
}

/**
 * Resolve the reference name for a runtime helper. The plain name is kept when
 * the source never binds it; otherwise a collision-free alias is allocated and
 * the injected import uses the same alias (`import { createElement as _vobs_createElement }`).
 */
function resolveHelperName(state: CompileState, name: string): string {
  const existing = state.helperAliases.get(name)
  if (existing) return existing
  let alias = name
  if (state.takenNames.has(alias)) {
    alias = `_vobs_${name}`
    let suffix = 1
    while (state.takenNames.has(alias)) alias = `_vobs_${name}_${suffix++}`
  }
  state.helperAliases.set(name, alias)
  return alias
}

/** Create a reference to a runtime helper in generated code, matching the injected import. */
function helperRef(state: CompileState, name: string): ts.Identifier {
  return ts.factory.createIdentifier(resolveHelperName(state, name))
}

function createRuntimeImports(state: CompileState): ts.ImportDeclaration[] {
  const modules = new Map<string, ts.ImportSpecifier[]>()
  for (const [name, alias] of state.helperAliases) {
    const module = name === 'insertResourceBoundary' ? '@vobs/resource' : '@vobs/vobs'
    const imported = modules.get(module) ?? []
    imported.push(ts.factory.createImportSpecifier(
      false,
      alias === name ? undefined : ts.factory.createIdentifier(name),
      ts.factory.createIdentifier(alias)
    ))
    modules.set(module, imported)
  }
  return [...modules.entries()].map(([module, imported]) => ts.factory.createImportDeclaration(
    undefined,
    ts.factory.createImportClause(
      false,
      undefined,
      ts.factory.createNamedImports(imported)
    ),
    ts.factory.createStringLiteral(module)
  ))
}

function rebuildImport(state: CompileState, node: ts.ImportDeclaration): ts.ImportDeclaration {
  if (!ts.isStringLiteral(node.moduleSpecifier)) return node
  return tagStatement(state, ts.factory.createImportDeclaration(
    node.modifiers,
    node.importClause,
    ts.factory.createStringLiteral(node.moduleSpecifier.text),
    node.attributes
  ), node)
}

function transformStatement(state: CompileState, node: ts.Statement, moduleScope = false): ts.Statement {
  if (ts.isFunctionDeclaration(node) && node.body) {
    return tagStatement(state, ts.factory.updateFunctionDeclaration(
      node,
      node.modifiers,
      node.asteriskToken,
      node.name,
      node.typeParameters,
      node.parameters,
      node.type,
      transformBlock(state, node.body)
    ), node)
  }

  if (ts.isVariableStatement(node)) return transformVariableStatement(state, node, moduleScope)
  if (ts.isExportAssignment(node) && containsJsx(node.expression)) {
    return tagStatement(state, ts.factory.updateExportAssignment(node, node.modifiers, transformEmbeddedExpression(state, node.expression)), node)
  }
  if (ts.isExpressionStatement(node) && containsJsx(node.expression)) {
    return tagStatement(state, ts.factory.updateExpressionStatement(node, transformEmbeddedExpression(state, node.expression)), node)
  }
  if (ts.isReturnStatement(node) && node.expression && containsJsx(node.expression)) {
    return tagStatement(state, ts.factory.updateReturnStatement(node, transformEmbeddedExpression(state, node.expression)), node)
  }
  return node
}

function transformVariableStatement(state: CompileState, node: ts.VariableStatement, moduleScope = false): ts.VariableStatement {
  let changed = false
  const declarations = node.declarationList.declarations.map(declaration => {
    const initializer = declaration.initializer
    if (!initializer) return declaration

    let nextInitializer = inferStateDebugName(state, declaration, initializer) ?? initializer
    if (containsJsx(nextInitializer)) {
      nextInitializer = transformEmbeddedExpression(state, nextInitializer)
    } else if (moduleScope && state.hmrModuleId !== null) {
      // HMR 状态保鲜仅限模块顶层：函数内局部 state 每次调用都应创建新信号
      nextInitializer = wrapStateWithHmrRef(state, declaration, nextInitializer) ?? nextInitializer
    }
    if (nextInitializer === initializer) return declaration

    changed = true
    return ts.factory.updateVariableDeclaration(
      declaration,
      declaration.name,
      declaration.exclamationToken,
      declaration.type,
      nextInitializer
    )
  })

  if (!changed) return node

  return tagStatement(state, ts.factory.updateVariableStatement(
    node,
    node.modifiers,
    ts.factory.updateVariableDeclarationList(node.declarationList, declarations)
  ), node)
}

/**
 * `const name = state(initial)` 在未显式传入 debugName 时从变量名推断：
 * `const username = state('')` → `state('', 'username')`，使 DevTools 信号名称与源码命名一致。
 * 仅当 `state` 确认来自 @vobs/reactivity / @vobs/vobs、未被本地声明遮蔽、
 * 且调用只带一个参数时启用；其余形态保持原样。
 */
function inferStateDebugName(
  state: CompileState,
  declaration: ts.VariableDeclaration,
  initializer: ts.Expression
): ts.Expression | undefined {
  if (state.stateAliases.size === 0) return undefined
  if (!ts.isIdentifier(declaration.name)) return undefined

  let call = initializer
  while (ts.isParenthesizedExpression(call) || ts.isAsExpression(call) || ts.isTypeAssertionExpression(call) || ts.isSatisfiesExpression(call)) {
    call = call.expression
  }
  if (!ts.isCallExpression(call)) return undefined
  const callee = call.expression
  if (!ts.isIdentifier(callee) || !state.stateAliases.has(callee.text)) return undefined
  if (state.localBindings.has(callee.text)) return undefined
  if (call.arguments.length !== 1) return undefined

  return ts.factory.createCallExpression(callee, call.typeArguments, [
    ...call.arguments,
    ts.factory.createStringLiteral(declaration.name.text)
  ])
}

/**
 * HMR 状态保鲜：模块热更新重执行时，模块级 state() 会创建全新信号实例，与未重执行的
 * 导入方持有旧实例并存，形成"两份状态"（症状：编辑不生效、页面半边失灵，全量刷新也无法
 * 消除）。开启 hmrModuleId 后，模块顶层的 state 声明改经运行时注册表取值：
 * `const x = state(init)` → `const x = hmrStateRef(moduleId, 'x', () => state(init, 'x'))`。
 * 首次执行照常创建；模块重执行时直接复用既有信号，模块逻辑（副作用、导出绑定）照常重跑。
 */
function wrapStateWithHmrRef(
  state: CompileState,
  declaration: ts.VariableDeclaration,
  initializer: ts.Expression
): ts.Expression | undefined {
  let call = initializer
  while (ts.isParenthesizedExpression(call) || ts.isAsExpression(call) || ts.isTypeAssertionExpression(call) || ts.isSatisfiesExpression(call)) {
    call = call.expression
  }
  if (!ts.isCallExpression(call)) return undefined
  const callee = call.expression
  if (!ts.isIdentifier(callee) || !state.stateAliases.has(callee.text)) return undefined
  if (state.localBindings.has(callee.text)) return undefined
  if (!ts.isIdentifier(declaration.name)) return undefined
  return ts.factory.createCallExpression(helperRef(state, 'hmrStateRef'), undefined, [
    ts.factory.createStringLiteral(`${state.hmrModuleId}#${declaration.name.text}`),
    ts.factory.createArrowFunction(
      undefined,
      undefined,
      [],
      undefined,
      ts.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
      initializer
    )
  ])
}

function containsJsx(expression: ts.Expression | ts.SourceFile): boolean {
  let found = false
  const visit = (node: ts.Node): void => {
    if (isJsxExpression(node as ts.Expression)) {
      found = true
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(expression)
  return found
}

function transformBlock(state: CompileState, block: ts.Block): ts.Block {
  const statements = block.statements.map(statement => {
    if (!ts.isReturnStatement(statement) || !statement.expression) return transformStatement(state, statement)
    const expression = ts.isParenthesizedExpression(statement.expression)
      ? statement.expression.expression
      : statement.expression
    return isJsxExpression(expression)
      ? tagStatement(state, ts.factory.updateReturnStatement(statement, transformJsxExpression(state, expression)), statement)
      : statement
  })
  return ts.factory.updateBlock(block, statements)
}

function isJsxExpression(node: ts.Expression): node is ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment {
  return ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)
}

function transformJsxExpression(state: CompileState, node: ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment): ts.Expression {
  if (ts.isJsxFragment(node)) return transformFragment(state, node.children)
  if (ts.isJsxElement(node)) {
    return transformElement(state, node, node.openingElement.tagName, node.openingElement.attributes, node.children)
  }
  return transformElement(state, node, node.tagName, node.attributes, [])
}

function transformElement(
  state: CompileState,
  node: ts.JsxElement | ts.JsxSelfClosingElement,
  tagName: ts.JsxTagNameExpression,
  attributes: ts.JsxAttributes,
  children: readonly ts.JsxChild[]
): ts.Expression {
  if (isFragmentTag(tagName)) return transformFragment(state, children)
  if (!ts.isIdentifier(tagName)) {
    // <Foo.Bar>、<svg:rect> 等形态此前会静默编译成无效 DOM 标签（createElement("Foo.Bar")）。
    // 报结构化诊断后按原路径继续，保证产物结构稳定；compile()/Vite 插件会因 error 诊断直接失败。
    reportUnsupportedTag(state, tagName)
  }
  if (ts.isIdentifier(tagName) && tagName.text === 'ResourceBoundary') {
    return transformResourceBoundary(state, node, attributes, children)
  }
  if (ts.isIdentifier(tagName) && tagName.text === 'AsyncBoundary') {
    return transformAsyncBoundary(state, node, attributes, children)
  }
  if (ts.isIdentifier(tagName) && tagName.text === 'ErrorBoundary') {
    return transformErrorBoundary(state, node, attributes, children)
  }
  if (ts.isIdentifier(tagName) && tagName.text === 'Profiler') {
    return transformProfiler(state, node, attributes, children)
  }
  if (ts.isIdentifier(tagName) && /^[A-Z]/.test(tagName.text)) {
    const args: ts.Expression[] = [
      ts.factory.createCallExpression(helperRef(state, 'resolveComponent'), undefined, [
        tagName,
        ts.factory.createStringLiteral(state.filename),
        ts.factory.createStringLiteral(tagName.text)
      ]),
      createComponentProps(state, attributes, children)
    ]
    // 源码位置仅用于错误定位与 DevTools；生产构建可整体剔除（错误仍带组件名，定位走 source map）。
    if (state.sourceLocation) args.push(createSourceLocation(tagName))
    return ts.factory.createCallExpression(helperRef(state, 'createComponent'), undefined, args)
  }

  // 静态模板提升：完全静态的 DOM 子树（无事件/动态绑定/spread/property 属性）序列化为
  // 模块级模板，运行时一次 cloneNode 替代 createElement + setStaticProps + 逐子插入。
  // hoistTemplates=false（SSR/Node 构建）时跳过：createTemplate 依赖 document。
  //
  // SVG 子树内一律不提升：模板串是**用 HTML 解析器**解析的，`<g>`/`<rect>` 会变成
  // HTMLUnknownElement、`<a>`/`<title>` 会变成 HTML 元素 —— 都是静默不渲染/渲染错。
  // （isStaticElement 只会因标签名是 SVG 专属标签而拒绝，而 a/title/style 与 HTML 同名，
  // 名字这条线索不足以判断，所以在这里按编译器已知的命名空间整体关掉。）
  if (state.hoistTemplates && state.svgDepth === 0 && isStaticElement(tagName, attributes, children)) {
    return ts.factory.createCallExpression(
      helperRef(state, 'cloneTemplate'),
      undefined,
      [registerTemplate(state, serializeStaticHtml(node))]
    )
  }

  const elementName = tagName.getText()
  const elementId = nextIdentifier(state, '_el')
  /*
   * 命名空间由编译器决定（见 CompileState.svgDepth 的说明）：
   * 在 SVG 子树里、但名字不是 SVG 专属标签的（a / title / style / script），
   * 必须显式走 SVG 创建，否则会建出 HTML 元素 —— 而且不报错。
   */
  const createHelper = state.svgDepth > 0 && !isSvgTag(elementName) ? 'createSvgElement' : 'createElement'
  const statements: ts.Statement[] = [
    createConstStatement(
      state,
      elementId,
      ts.factory.createCallExpression(
        helperRef(state, createHelper),
        undefined,
        [ts.factory.createStringLiteral(elementName)]
      ),
      node
    )
  ]

  appendAttributes(state, statements, elementId, attributes)

  // <svg> 的子树进入 SVG 命名空间；<foreignObject> 的子树切回 HTML；其余继承。
  const outerSvgDepth = state.svgDepth
  if (elementName === 'svg') state.svgDepth = outerSvgDepth + 1
  else if (elementName === 'foreignObject') state.svgDepth = 0
  appendChildren(state, statements, elementId, children)
  state.svgDepth = outerSvgDepth
  statements.push(tagStatement(state, ts.factory.createReturnStatement(elementId), node))

  return ts.factory.createCallExpression(
    ts.factory.createArrowFunction(
      undefined,
      undefined,
      [],
      undefined,
      ts.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
      ts.factory.createBlock(statements, true)
    ),
    undefined,
    []
  )
}

function isFragmentTag(tagName: ts.JsxTagNameExpression): boolean {
  return tagName.getText() === 'Fragment' || tagName.getText() === 'Vobs.Fragment'
}

function transformFragment(state: CompileState, children: readonly ts.JsxChild[]): ts.Expression {
  const parent = nextIdentifier(state, '_fragmentParent')
  const anchor = nextIdentifier(state, '_fragmentAnchor')
  const statements: ts.Statement[] = []
  appendChildren(state, statements, parent, children, anchor)
  return ts.factory.createCallExpression(
    helperRef(state, 'createFragment'),
    undefined,
    [ts.factory.createArrowFunction(
      undefined,
      undefined,
      [
        ts.factory.createParameterDeclaration(undefined, undefined, parent),
        ts.factory.createParameterDeclaration(undefined, undefined, anchor)
      ],
      undefined,
      ts.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
      ts.factory.createBlock(statements, true)
    )]
  )
}

/**
 * 边界组件缺少必需属性。
 *
 * 原来直接 `throw new VobsError` —— 于是 `compileWithSourceMap`（非抛出版本的 API）
 * 会抛异常而不是返回诊断，诊断里既没有位置，也一次只能看到这一个问题。
 * 改成推一条带位置的诊断并让编译继续，与其它诊断走同一条路径。
 */
function reportMissingBoundaryProp(
  state: CompileState,
  node: ts.JsxElement | ts.JsxSelfClosingElement,
  component: string,
  prop: string,
  fix: string
): void {
  const sourceFile = node.getSourceFile() ?? state.sourceFile
  if (!sourceFile) return
  const tagName = ts.isJsxElement(node) ? node.openingElement.tagName : node.tagName
  const { line, column, codeFrame } = buildCodeFrame(sourceFile, tagName.getStart(sourceFile), tagName.getWidth(sourceFile))
  state.diagnostics.push({
    code: 'VOBS_C002',
    severity: 'error',
    message: `${component} 必须提供 ${prop} 属性。`,
    location: { file: state.filename, line, column },
    codeFrame,
    fix
  })
}

function transformResourceBoundary(
  state: CompileState,
  node: ts.JsxElement | ts.JsxSelfClosingElement,
  attributes: ts.JsxAttributes,
  children: readonly ts.JsxChild[]
): ts.Expression {
  const resource = getAttributeExpression(attributes, 'resource')
  if (!resource) {
    reportMissingBoundaryProp(state, node, 'ResourceBoundary', 'resource', '为 ResourceBoundary 添加 resource={resource}。')
    return ts.factory.createNull()
  }
  const options: ts.ObjectLiteralElementLike[] = [
    ts.factory.createPropertyAssignment('resource', transformEmbeddedExpression(state, resource)),
    ts.factory.createPropertyAssignment('children', createBoundaryFactory(state, children))
  ]
  appendBoundaryOptionalProperty(state, options, attributes, 'loading')
  appendBoundaryOptionalProperty(state, options, attributes, 'empty')
  appendBoundaryOptionalProperty(state, options, attributes, 'fallback')
  return createBoundaryFragment(state, node, 'insertResourceBoundary', options)
}

function transformErrorBoundary(
  state: CompileState,
  node: ts.JsxElement | ts.JsxSelfClosingElement,
  attributes: ts.JsxAttributes,
  children: readonly ts.JsxChild[]
): ts.Expression {
  const fallback = getAttributeExpression(attributes, 'fallback')
  if (!fallback) {
    reportMissingBoundaryProp(state, node, 'ErrorBoundary', 'fallback', '为 ErrorBoundary 添加 fallback={(error, retry) => ...}。')
    return ts.factory.createNull()
  }
  return createBoundaryFragment(state, node, 'insertErrorBoundary', [
    ts.factory.createPropertyAssignment('children', createBoundaryFactory(state, children)),
    ts.factory.createPropertyAssignment('fallback', transformEmbeddedExpression(state, fallback))
  ])
}

function transformAsyncBoundary(
  state: CompileState,
  node: ts.JsxElement | ts.JsxSelfClosingElement,
  attributes: ts.JsxAttributes,
  children: readonly ts.JsxChild[]
): ts.Expression {
  const promise = getAttributeExpression(attributes, 'promise')
  if (!promise) {
    reportMissingBoundaryProp(state, node, 'AsyncBoundary', 'promise', '为 AsyncBoundary 添加 promise={promise}。')
    return ts.factory.createNull()
  }
  const options: ts.ObjectLiteralElementLike[] = [
    ts.factory.createPropertyAssignment('promise', transformEmbeddedExpression(state, promise)),
    ts.factory.createPropertyAssignment('children', createAsyncFactory(state, children))
  ]
  appendBoundaryOptionalProperty(state, options, attributes, 'loading')
  appendBoundaryOptionalProperty(state, options, attributes, 'fallback')
  const resetKey = getAttributeExpression(attributes, 'resetKey')
  if (resetKey) options.push(ts.factory.createPropertyAssignment('resetKey', createGetter(resetKey)))
  return createBoundaryFragment(state, node, 'insertAsyncBoundary', options)
}

function transformProfiler(
  state: CompileState,
  node: ts.JsxElement | ts.JsxSelfClosingElement,
  attributes: ts.JsxAttributes,
  children: readonly ts.JsxChild[]
): ts.Expression {
  const idAttribute = attributes.properties.find(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText() === 'id')
  const id = idAttribute && ts.isJsxAttribute(idAttribute) && idAttribute.initializer && ts.isStringLiteral(idAttribute.initializer)
    ? ts.factory.createStringLiteral(idAttribute.initializer.text)
    : idAttribute && ts.isJsxAttribute(idAttribute) && idAttribute.initializer && ts.isJsxExpression(idAttribute.initializer)
      ? idAttribute.initializer.expression
      : null
  if (!id) throw new VobsError({ code: 'VOBS_C002', layer: 'compiler', message: 'Profiler 必须提供 id 属性', fix: '为 Profiler 添加 id="ComponentName"。' })
  const options: ts.ObjectLiteralElementLike[] = [
    ts.factory.createPropertyAssignment('id', transformEmbeddedExpression(state, id)),
    ts.factory.createPropertyAssignment('children', createBoundaryFactory(state, children))
  ]
  appendBoundaryOptionalProperty(state, options, attributes, 'onRender')
  return createBoundaryFragment(state, node, 'insertProfiler', options)
}

function createBoundaryFragment(
  state: CompileState,
  node: ts.JsxElement | ts.JsxSelfClosingElement,
  helper: 'insertResourceBoundary' | 'insertErrorBoundary' | 'insertAsyncBoundary' | 'insertProfiler',
  options: readonly ts.ObjectLiteralElementLike[]
): ts.Expression {
  const parent = nextIdentifier(state, '_boundaryParent')
  const anchor = nextIdentifier(state, '_boundaryAnchor')
  return ts.factory.createCallExpression(
    helperRef(state, 'createFragment'),
    undefined,
    [ts.factory.createArrowFunction(
      undefined,
      undefined,
      [
        ts.factory.createParameterDeclaration(undefined, undefined, parent),
        ts.factory.createParameterDeclaration(undefined, undefined, anchor)
      ],
      undefined,
      ts.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
      ts.factory.createBlock([callStatement(state, helper, [
        parent,
        anchor,
        ts.factory.createObjectLiteralExpression(options, true)
      ], node)], true)
    )]
  )
}

function createBoundaryFactory(state: CompileState, children: readonly ts.JsxChild[]): ts.ArrowFunction {
  const content = transformFragment(state, children)
  return ts.factory.createArrowFunction(
    undefined,
    undefined,
    [],
    undefined,
    ts.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    content
  )
}

function createAsyncFactory(state: CompileState, children: readonly ts.JsxChild[]): ts.ArrowFunction {
  const value = ts.factory.createIdentifier('value')
  const expressionChild = children.length === 1 && children[0].kind === ts.SyntaxKind.JsxExpression
    ? (children[0] as ts.JsxExpression).expression
    : undefined
  if (expressionChild && ts.isArrowFunction(expressionChild)) {
    const transformed = transformEmbeddedExpression(state, expressionChild)
    return transformed as ts.ArrowFunction
  }
  const content = transformFragment(state, children)
  return ts.factory.createArrowFunction(undefined, undefined, [
    ts.factory.createParameterDeclaration(undefined, undefined, value)
  ], undefined, ts.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken), content)
}

function appendBoundaryOptionalProperty(
  state: CompileState,
  properties: ts.ObjectLiteralElementLike[],
  attributes: ts.JsxAttributes,
  name: string
): void {
  const expression = getAttributeExpression(attributes, name)
  if (expression) {
    const transformed = transformEmbeddedExpression(state, expression)
    const value = isJsxExpression(unwrapExpression(expression))
      ? createGetter(transformed)
      : transformed
    properties.push(ts.factory.createPropertyAssignment(name, value))
  }
}

function getAttributeExpression(attributes: ts.JsxAttributes, name: string): ts.Expression | null {
  for (const attribute of attributes.properties) {
    if (!ts.isJsxAttribute(attribute) || attribute.name.getText() !== name) continue
    if (attribute.initializer && ts.isJsxExpression(attribute.initializer)) {
      return attribute.initializer.expression ?? null
    }
  }
  return null
}

function transformEmbeddedExpression(state: CompileState, expression: ts.Expression): ts.Expression {
  const result = ts.transform(expression, [context => root => {
    const visit: ts.Visitor = node => {
      if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
        return transformJsxExpression(state, node)
      }
      return ts.visitEachChild(node, visit, context)
    }
    return ts.visitNode(root, visit) as ts.Expression
  }])
  try {
    return result.transformed[0]
  } finally {
    result.dispose()
  }
}


function transformResidualJsx(state: CompileState, sourceFile: ts.SourceFile): ts.SourceFile {
  if (!containsJsx(sourceFile)) return sourceFile
  const result = ts.transform(sourceFile, [context => root => {
    const visit: ts.Visitor = node => {
      if (ts.isReturnStatement(node) && node.expression && containsJsx(node.expression)) {
        return ts.factory.updateReturnStatement(node, transformEmbeddedExpression(state, node.expression))
      }
      if (isJsxExpression(node as ts.Expression)) {
        return transformJsxExpression(state, node as ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment)
      }
      return ts.visitEachChild(node, visit, context)
    }
    return ts.visitNode(root, visit) as ts.SourceFile
  }])
  try {
    return result.transformed[0]
  } finally {
    result.dispose()
  }
}

/**
 * 静态元素判定：DOM 标签 + 全部属性为字符串字面量或无值 + 全部子节点为文本或递归静态元素。
 * 保守排除项（语义或序列化等价性无把握，走原路径）：
 * - property 属性（value/checked/disabled 等）：HTML attribute 与 setProperty 初始语义存在差异；
 * - 事件（on*）、ref、spread、key：本身是动态行为；
 * - 嵌套组件/Fragment/Boundary：不是纯 DOM 子树。
 */
function isStaticElement(
  tagName: ts.JsxTagNameExpression,
  attributes: ts.JsxAttributes,
  children: readonly ts.JsxChild[]
): boolean {
  if (!ts.isIdentifier(tagName) || !/^[a-z]/.test(tagName.text)) return false
  /*
   * SVG 子树不能提升成模板。
   *
   * 模板走的是 HTML 解析器（<template>.innerHTML），`<g>`、`<rect>` 解析出来是
   * HTMLUnknownElement —— 命名空间错了，整棵图形都不渲染，而且**没有任何报错**。
   * createElement 那条路径（ops.ts）已经按标签名走 createElementNS，唯独提升这条漏了。
   * 任一后代是 SVG 标签就整棵不提升，递归天然覆盖这一点。
   */
  if (isSvgTag(tagName.text)) return false
  for (const attribute of attributes.properties) {
    if (ts.isJsxSpreadAttribute(attribute)) return false
    if (!ts.isJsxAttribute(attribute)) return false
    const name = attribute.name.getText()
    if (name === 'key' || name === 'ref' || name.startsWith('on')) return false
    if (isPropertyName(name)) return false
    const initializer = attribute.initializer
    if (initializer && !ts.isStringLiteral(initializer)) return false
  }
  for (const child of children) {
    if (ts.isJsxText(child)) continue
    if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) {
      const nested = ts.isJsxElement(child)
        ? { tagName: child.openingElement.tagName, attributes: child.openingElement.attributes, children: child.children }
        : { tagName: child.tagName, attributes: child.attributes, children: [] as readonly ts.JsxChild[] }
      if (!isStaticElement(nested.tagName, nested.attributes, nested.children)) return false
      continue
    }
    return false
  }
  return true
}

/** Serialize a fully-static JSX element to HTML, preserving the compiler's text normalization. */
function serializeStaticHtml(node: ts.JsxElement | ts.JsxSelfClosingElement): string {
  const { tagName, attributes, children } = ts.isJsxElement(node)
    ? { tagName: node.openingElement.tagName, attributes: node.openingElement.attributes, children: node.children }
    : { tagName: node.tagName, attributes: node.attributes, children: [] as readonly ts.JsxChild[] }
  return serializeStaticElement(tagName, attributes, children)
}

function serializeStaticElement(
  tagName: ts.JsxTagNameExpression,
  attributes: ts.JsxAttributes,
  children: readonly ts.JsxChild[]
): string {
  const name = tagName.getText()
  let html = `<${name}`
  for (const attribute of attributes.properties) {
    if (!ts.isJsxAttribute(attribute)) continue
    const attributeName = attribute.name.getText() === 'className' ? 'class' : attribute.name.getText()
    const initializer = attribute.initializer
    if (!initializer) {
      html += ` ${attributeName}=""`
      continue
    }
    if (ts.isStringLiteral(initializer)) {
      html += ` ${attributeName}="${escapeHtmlAttribute(initializer.text)}"`
    }
  }
  html += '>'

  for (const child of children) {
    if (ts.isJsxText(child)) {
      // 与 appendChildren 共用同一套规范化（含元素之间那个合法空格），保证提升前后一致。
      const text = transformJsxText(child.text)
      if (text !== '') html += escapeHtmlText(text)
      continue
    }
    if (ts.isJsxElement(child)) {
      html += serializeStaticElement(
        child.openingElement.tagName,
        child.openingElement.attributes,
        child.children
      )
      continue
    }
    if (ts.isJsxSelfClosingElement(child)) {
      html += serializeStaticElement(child.tagName, child.attributes, [])
    }
  }
  html += `</${name}>`
  return html
}

function escapeHtmlAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

function escapeHtmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Register a hoisted template declaration; identical HTML shares one declaration. */
function registerTemplate(state: CompileState, html: string): ts.Expression {
  const existing = state.templates.get(html)
  if (existing) return existing
  const identifier = nextIdentifier(state, '_tpl')
  state.templates.set(html, identifier)
  return identifier
}

function createTemplateDeclarations(state: CompileState): ts.Statement[] {
  return [...state.templates.entries()].map(([html, identifier]) =>
    ts.factory.createVariableStatement(undefined, ts.factory.createVariableDeclarationList([
      ts.factory.createVariableDeclaration(identifier, undefined, undefined, ts.factory.createCallExpression(
        helperRef(state, 'createTemplate'),
        undefined,
        [ts.factory.createStringLiteral(html)]
      ))
    ], ts.NodeFlags.Const))
  )
}

function appendAttributes(
  state: CompileState,
  statements: ts.Statement[],
  element: ts.Identifier,
  attributes: ts.JsxAttributes
): void {
  const staticProps: ts.ObjectLiteralElementLike[] = []
  const hasSpread = attributes.properties.some(attribute => ts.isJsxSpreadAttribute(attribute))
  for (const attribute of attributes.properties) {
    if (ts.isJsxSpreadAttribute(attribute)) {
      statements.push(callStatement(state, 'spreadProps', [element, transformEmbeddedExpression(state, attribute.expression)], attribute))
      continue
    }
    if (!ts.isJsxAttribute(attribute)) continue
    const name = attribute.name.getText()
    if (name === 'key') continue
    if (name === 'ref') {
      const initializer = attribute.initializer
      if (initializer && ts.isJsxExpression(initializer) && initializer.expression) {
        statements.push(callStatement(state, 'setRef', [element, transformEmbeddedExpression(state, initializer.expression)], attribute))
      }
      continue
    }
    const initializer = attribute.initializer

    if (name.startsWith('on') && initializer && ts.isJsxExpression(initializer) && initializer.expression) {
      const resolved = resolveEventName(name)
      if (resolved === undefined) {
        // 只有 "on" 本身：既不是事件属性也不是有意义的名字
        reportEventName(state, attribute, name)
        continue
      }
      reportEventName(state, attribute, name)
      statements.push(callStatement(state, 'addEventListener', [
        element,
        ts.factory.createStringLiteral(resolved.eventName),
        initializer.expression
      ], attribute))
      continue
    }

    if (!initializer) {
      if (hasSpread) {
        statements.push(callStatement(state, isPropertyName(name) ? 'setProperty' : 'setAttribute', [element, ts.factory.createStringLiteral(isPropertyName(name) ? name : domAttributeName(name)), isPropertyName(name) ? ts.factory.createTrue() : ts.factory.createStringLiteral('')], attribute))
        continue
      }
      if (isPropertyName(name)) staticProps.push(createStaticProperty(name, ts.factory.createTrue()))
      else staticProps.push(createStaticProperty(domAttributeName(name), ts.factory.createStringLiteral('')))
      continue
    }
    if (ts.isStringLiteral(initializer)) {
      if (hasSpread) {
        statements.push(callStatement(state, isPropertyName(name) ? 'setProperty' : 'setAttribute', [element, ts.factory.createStringLiteral(isPropertyName(name) ? name : domAttributeName(name)), ts.factory.createStringLiteral(initializer.text)], attribute))
        continue
      }
      staticProps.push(createStaticProperty(isPropertyName(name) ? name : domAttributeName(name),
        ts.factory.createStringLiteral(initializer.text)))
      continue
    }

    const attributeName = domAttributeName(name)
    const propertyAttribute = isPropertyName(name)
    if (ts.isJsxExpression(initializer) && initializer.expression) {
      statements.push(callStatement(state, propertyAttribute ? 'bindProperty' : 'bindAttribute', [
        element,
        ts.factory.createStringLiteral(propertyAttribute ? name : attributeName),
        createGetter(initializer.expression)
      ], attribute))
    }
  }
  if (staticProps.length) statements.splice(1, 0, callStatement(state, 'setStaticProps', [
    element,
    ts.factory.createObjectLiteralExpression(staticProps, true)
  ], attributes))
}

function createStaticProperty(name: string, value: ts.Expression): ts.PropertyAssignment {
  return ts.factory.createPropertyAssignment(ts.factory.createStringLiteral(name), value)
}


/**
 * JSX 文本节点的空白规范化 —— 按 Babel/React 的规则，**不是简单 trim**。
 *
 * 原来三处都用 `replace(/\s+/g, ' ').trimStart()`，于是
 *   <p><b>a</b> <i>b</i></p>
 * 里那个**合法的空格**被删掉，渲染成 "ab"，而 React / Solid 都渲染 "a b"。
 * 静态提升路径与动态路径都这么干，所以两边的注释虽然写着「逐字相同」，
 * 保的是一致的错语义。
 *
 * 正确规则：
 *   - 不含换行的文本**原样保留**（元素之间的一个空格属于这类）
 *   - 含换行的：逐行 trim、空行丢弃、保留下来的行之间用一个空格连接
 * 于是缩进换行会被吃掉（与 React 一致），而单行内的空格保住。
 */
export function transformJsxText(raw: string): string {
  if (!raw.includes('\n') && !raw.includes('\r')) return raw
  const lines = raw.split(/\r\n|\n|\r/u)
  let lastNonEmpty = 0
  for (let index = 0; index < lines.length; index += 1) {
    if (/[^ \t]/u.test(lines[index])) lastNonEmpty = index
  }
  let result = ''
  for (let index = 0; index < lines.length; index += 1) {
    let line = lines[index].replace(/\t/gu, ' ')
    if (index !== 0) line = line.replace(/^ +/u, '')
    if (index !== lines.length - 1) line = line.replace(/ +$/u, '')
    if (line !== '') {
      if (index !== lastNonEmpty) line += ' '
      result += line
    }
  }
  return result
}

function appendChildren(
  state: CompileState,
  statements: ts.Statement[],
  element: ts.Identifier,
  children: readonly ts.JsxChild[],
  anchor: ts.Expression = ts.factory.createNull()
): void {
  for (const child of children) {
    if (ts.isJsxText(child)) {
      const text = transformJsxText(child.text)
      if (text !== '') {
        statements.push(callStatement(state, 'insertBefore', [
        element,
        ts.factory.createCallExpression(helperRef(state, 'createText'), undefined, [
          ts.factory.createStringLiteral(text)
        ]),
        anchor
      ], child))
      }
      continue
    }

    if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child) || ts.isJsxFragment(child)) {
      statements.push(callStatement(state, 'insertBefore', [
        element,
        transformJsxExpression(state, child),
        anchor
      ], child))
      continue
    }

    if (child.kind === ts.SyntaxKind.JsxExpression) {
      const expression = (child as ts.JsxExpression).expression
      if (!expression) continue
      const list = transformListExpression(state, element, expression, anchor)
      if (list) {
        statements.push(callStatement(state, 'insertList', list, child))
        continue
      }
      const dynamic = transformDynamicExpression(state, expression)
      if (dynamic) {
        statements.push(callStatement(state, 'insertDynamic', [element, anchor, dynamic], child))
        continue
      }
      // 其余表达式（函数调用、成员访问、字面量、标识符……）一律走 insertDynamicValue
      // 多态插入：值类型在运行时分发——字符串/数值命中自建文本节点的原地更新快路径
      // （等价 bindText 性能），节点/Fragment/数组正确挂载。编译期不猜测调用返回类型，
      // 返回节点的辅助函数（如 renderXxx()）与返回字符串的 t('...') 同样安全。
      const value = transformEmbeddedExpression(state, expression)
      statements.push(callStatement(state, 'insertDynamicValue', [element, anchor, createGetter(value)], child))
    }
  }
}

function createComponentProps(
  state: CompileState,
  attributes: ts.JsxAttributes,
  children: readonly ts.JsxChild[]
): ts.ObjectLiteralExpression {
  const properties: ts.ObjectLiteralElementLike[] = []

  for (const attribute of attributes.properties) {
    if (ts.isJsxSpreadAttribute(attribute)) {
      properties.push(ts.factory.createSpreadAssignment(attribute.expression))
      continue
    }

    const name = propertyName(attribute.name.getText())
    if (attribute.name.getText() === 'key') continue
    const initializer = attribute.initializer
    if (!initializer) {
      properties.push(ts.factory.createPropertyAssignment(name, ts.factory.createTrue()))
    } else if (ts.isStringLiteral(initializer)) {
      properties.push(ts.factory.createPropertyAssignment(name, ts.factory.createStringLiteral(initializer.text)))
    } else if (ts.isJsxExpression(initializer) && initializer.expression) {
      properties.push(createGetterProperty(name, transformEmbeddedExpression(state, initializer.expression)))
    }
  }

  const childExpressions = children.flatMap(child => childToComponentExpression(state, child))
  if (childExpressions.length === 1) {
    properties.push(createGetterProperty('children', childExpressions[0]))
  } else if (childExpressions.length > 1) {
    properties.push(createGetterProperty('children', ts.factory.createArrayLiteralExpression(childExpressions)))
  }

  return ts.factory.createObjectLiteralExpression(properties, true)
}

function createSourceLocation(node: ts.Node): ts.ObjectLiteralExpression {
  const sourceFile = node.getSourceFile()
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
  return ts.factory.createObjectLiteralExpression([
    ts.factory.createPropertyAssignment('file', ts.factory.createStringLiteral(sourceFile.fileName)),
    ts.factory.createPropertyAssignment('line', ts.factory.createNumericLiteral(position.line + 1)),
    ts.factory.createPropertyAssignment('column', ts.factory.createNumericLiteral(position.character + 1))
  ], true)
}

function transformDynamicExpression(state: CompileState, expression: ts.Expression): ts.ArrowFunction | null {
  const converted = convertDynamicNodeExpression(state, expression)
  return converted ? createGetter(converted) : null
}

/**
 * 把产出节点的动态表达式（`cond ? <A/> : <B/>`、`cond && <A/>`，含任意嵌套组合）
 * 转换为条件表达式树；各分支中的 JSX 递归编译为节点工厂，由 insertDynamic 挂载/卸载。
 *
 * **只有所有分支都能产出节点时**才走这条快路径。任一分支是列表（`.map`）、文本、
 * 数值等非节点表达式时整体返回 null，由调用方回落 insertDynamicValue 多态插入 ——
 * 否则那个分支会被编译成 `null`，内容**静默消失**。
 */
function convertDynamicNodeExpression(state: CompileState, expression: ts.Expression): ts.ConditionalExpression | null {
  if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
    const right = unwrapExpression(expression.right)
    if (isJsxExpression(right)) {
      return createNodeConditional(expression.left, transformJsxExpression(state, right), null)
    }
    // 右侧是嵌套的动态节点表达式（如 cond && (sub ? <A/> : <B/>)）时递归转换，
    // 转换失败（列表/文本分支）则整体回落为动态值绑定，保持语义可静态判定。
    const convertedRight = convertDynamicNodeExpression(state, right)
    if (convertedRight) return createNodeConditional(expression.left, convertedRight, null)
    return null
  }

  if (ts.isConditionalExpression(expression)) {
    if (!isDynamicNodeBranch(expression.whenTrue) || !isDynamicNodeBranch(expression.whenFalse)) {
      return null
    }
    const whenTrue = transformDynamicBranch(state, expression.whenTrue)
    const whenFalse = transformDynamicBranch(state, expression.whenFalse)
    if (!whenTrue && !whenFalse) return null
    return ts.factory.createConditionalExpression(
      expression.condition,
      ts.factory.createToken(ts.SyntaxKind.QuestionToken),
      whenTrue ?? ts.factory.createNull(),
      ts.factory.createToken(ts.SyntaxKind.ColonToken),
      whenFalse ?? ts.factory.createNull()
    )
  }

  return null
}

/**
 * 该分支是否**保证**能编译成节点工厂。
 *
 * 只有 JSX、显式的 null/false、以及内部每一层都满足这个条件的嵌套三元/`&&` 才算。
 * 列表表达式（`.map`）、文本、数值一律不算 —— 它们必须交给 insertDynamicValue，
 * 否则会被写成 `null` 分支而丢失。
 */
function isDynamicNodeBranch(expression: ts.Expression): boolean {
  const branch = unwrapExpression(expression)
  if (isJsxExpression(branch)) return true
  if (branch.kind === ts.SyntaxKind.NullKeyword || branch.kind === ts.SyntaxKind.FalseKeyword) return true
  if (ts.isConditionalExpression(branch)) {
    return isDynamicNodeBranch(branch.whenTrue) && isDynamicNodeBranch(branch.whenFalse)
  }
  if (ts.isBinaryExpression(branch) && branch.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
    return isDynamicNodeBranch(branch.right)
  }
  return false
}

function createNodeConditional(
  condition: ts.Expression,
  whenTrue: ts.Expression,
  whenFalse: ts.Expression | null
): ts.ConditionalExpression {
  return ts.factory.createConditionalExpression(
    condition,
    ts.factory.createToken(ts.SyntaxKind.QuestionToken),
    whenTrue,
    ts.factory.createToken(ts.SyntaxKind.ColonToken),
    whenFalse ?? ts.factory.createNull()
  )
}

/**
 * 转换单个分支：JSX → 节点工厂；null/false 原样保留；嵌套的三元与 `&&`
 * 动态节点表达式递归转换（此前嵌套三元只编译第一个分支，其余分支被静默丢弃）。
 * 其余表达式（字符串、数值等）返回 null，由调用方回落为 null 分支。
 */
function transformDynamicBranch(state: CompileState, expression: ts.Expression): ts.Expression | null {
  const branch = unwrapExpression(expression)
  if (isJsxExpression(branch)) return transformJsxExpression(state, branch)
  if (branch.kind === ts.SyntaxKind.NullKeyword || branch.kind === ts.SyntaxKind.FalseKeyword) return branch
  if (ts.isConditionalExpression(branch)
    || (ts.isBinaryExpression(branch) && branch.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken)) {
    return convertDynamicNodeExpression(state, branch)
  }
  return null
}

function transformListExpression(
  state: CompileState,
  parent: ts.Identifier,
  expression: ts.Expression,
  anchor: ts.Expression
): ts.Expression[] | null {
  if (!ts.isCallExpression(expression) || expression.arguments.length === 0) return null
  if (!ts.isPropertyAccessExpression(expression.expression) || expression.expression.name.text !== 'map') return null

  const callback = expression.arguments[0]
  if (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) return null

  // 回调体：单个 JSX 表达式，或块体里恰好一个 return
  const rawBody = ts.isBlock(callback.body) ? singleReturnExpression(callback.body) : unwrapExpression(callback.body)
  if (rawBody === null) {
    const reason = listDegradeReason(callback.body)
    if (reason !== null) reportListDegrade(state, expression, reason)
    return null
  }
  const body = unwrapExpression(rawBody)
  if (!isJsxExpression(body)) {
    return null
  }
  if (ts.isJsxFragment(body)) {
    reportListDegrade(state, expression, 'fragment')
    return null
  }

  const key = findKeyExpression(body)
  const renderItem = transformListCallback(callback, transformJsxExpression(state, body))
  const args: ts.Expression[] = [
    parent,
    anchor,
    createGetter(expression.expression.expression),
    renderItem
  ]
  if (key) args.push(createKeyCallback(callback, key))
  return args
}

function transformListCallback(
  callback: ts.ArrowFunction | ts.FunctionExpression,
  body: ts.Expression
): ts.Expression {
  if (ts.isArrowFunction(callback)) {
    return ts.factory.updateArrowFunction(
      callback,
      callback.modifiers,
      callback.typeParameters,
      callback.parameters,
      callback.type,
      callback.equalsGreaterThanToken,
      body
    )
  }

  return ts.factory.updateFunctionExpression(
    callback,
    callback.modifiers,
    callback.asteriskToken,
    callback.name,
    callback.typeParameters,
    callback.parameters,
    callback.type,
    ts.factory.createBlock([ts.factory.createReturnStatement(body)], true)
  )
}

function createKeyCallback(
  callback: ts.ArrowFunction | ts.FunctionExpression,
  key: ts.Expression
): ts.ArrowFunction {
  return ts.factory.createArrowFunction(
    undefined,
    undefined,
    callback.parameters,
    undefined,
    ts.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    key
  )
}

function findKeyExpression(node: ts.JsxElement | ts.JsxSelfClosingElement): ts.Expression | null {
  const attributes = ts.isJsxElement(node) ? node.openingElement.attributes : node.attributes
  for (const attribute of attributes.properties) {
    if (!ts.isJsxAttribute(attribute) || attribute.name.getText() !== 'key') continue
    if (attribute.initializer && ts.isJsxExpression(attribute.initializer)) {
      return attribute.initializer.expression ?? null
    }
  }
  return null
}

/**
 * 剥掉对运行时取值没有影响的包装：括号、`as` / `satisfies` 断言、非空断言。
 *
 * 此前只剥括号，于是 `items.map(item => (<li />) as any)` 里的 `as any`（很常见，
 * 用来压住类型报错）会让编译器认不出列表，静默退化成多态插入 —— keyed 复用与 key 一起失效。
 */
function unwrapExpression(node: ts.Expression | ts.ConciseBody): ts.Expression {
  let current = node as ts.Expression
  for (;;) {
    if (ts.isParenthesizedExpression(current)) {
      current = current.expression
      continue
    }
    if (ts.isAsExpression(current) || ts.isSatisfiesExpression(current) || ts.isNonNullExpression(current)) {
      current = current.expression
      continue
    }
    return current
  }
}

/** 块体里「恰好一个 return」→ 那个表达式；否则 null。 */
function singleReturnExpression(block: ts.Block): ts.Expression | null {
  if (block.statements.length !== 1) return null
  const only = block.statements[0]
  return ts.isReturnStatement(only) && only.expression !== undefined ? only.expression : null
}

/**
 * 列表退化的原因 —— 只在「看起来该是列表、却没被识别」时返回原因，报警告用。
 * 返回字符串/数值的 map（`items.map(i => i.name)`）本来就不是节点列表，不算退化。
 */
function listDegradeReason(body: ts.ConciseBody): 'fragment' | 'statements' | null {
  if (!ts.isBlock(body)) {
    const unwrapped = unwrapExpression(body)
    return ts.isJsxFragment(unwrapped) ? 'fragment' : null
  }
  const returns = body.statements.filter(ts.isReturnStatement)
  const returnsJsx = returns.some(item => item.expression !== undefined
    && isJsxExpression(unwrapExpression(item.expression)))
  if (!returnsJsx) return null
  return ts.isJsxFragment(unwrapExpression(returns[0].expression as ts.Expression)) ? 'fragment' : 'statements'
}

/**
 * 列表退化告警。
 *
 * 退化成多态插入后**功能仍然正常**，但每一项每轮重建、key 与 keyed 复用全部失效 ——
 * 长列表性能会差一个量级，而且没有任何提示。这里把沉默去掉（只警告，不阻断编译）。
 */
function reportListDegrade(
  state: CompileState,
  call: ts.CallExpression,
  reason: 'fragment' | 'statements'
): void {
  const sourceFile = call.getSourceFile() ?? state.sourceFile
  if (!sourceFile) return
  const message = reason === 'fragment'
    ? '列表项是 Fragment：这个 .map 会退化成多态插入（每轮重建每一项），key 与 keyed 复用全部失效。把 Fragment 里的内容并进单个元素即可。'
    : 'map 回调体里有多个语句：编译器只认「单个 JSX 表达式」或「恰好一个 return」，因此这个列表退化成多态插入，key 与 keyed 复用全部失效。把计算提到 map 之外，或让回调体只返回一个元素。'
  const { line, column, codeFrame } = buildCodeFrame(sourceFile, call.getStart(sourceFile), call.getWidth(sourceFile))
  state.diagnostics.push({
    code: 'VOBS_C103',
    severity: 'warning',
    message,
    location: { file: state.filename, line, column },
    codeFrame,
    fix: reason === 'fragment'
      ? `用一个元素替代 Fragment，例如 <li>…</li> 而不是 <><li>…</li></>。`
      : `把 map 回调改成单个 JSX 表达式（或恰好一个 return），计算搬到 map 外面。`
  })
}

function childToComponentExpression(state: CompileState, child: ts.JsxChild): ts.Expression[] {
  if (ts.isJsxText(child)) {
    const text = transformJsxText(child.text)
    return text !== '' ? [ts.factory.createStringLiteral(text)] : []
  }
  if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child) || ts.isJsxFragment(child)) {
    return [transformJsxExpression(state, child)]
  }
  if (child.kind === ts.SyntaxKind.JsxExpression) {
    const expression = (child as ts.JsxExpression).expression
    return expression ? [transformEmbeddedExpression(state, expression)] : []
  }
  return []
}

function propertyName(name: string): ts.PropertyName {
  return /^[$A-Z_a-z][$\w]*$/u.test(name)
    ? ts.factory.createIdentifier(name)
    : ts.factory.createStringLiteral(name)
}

function createGetter(expression: ts.Expression): ts.ArrowFunction {
  return ts.factory.createArrowFunction(
    undefined,
    undefined,
    [],
    undefined,
    ts.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    expression
  )
}

function createGetterProperty(name: string | ts.PropertyName, expression: ts.Expression): ts.GetAccessorDeclaration {
  return ts.factory.createGetAccessorDeclaration(
    undefined,
    typeof name === 'string' ? propertyName(name) : name,
    [],
    undefined,
    ts.factory.createBlock([ts.factory.createReturnStatement(expression)], true)
  )
}

function callStatement(state: CompileState, name: string, args: ts.Expression[], source?: ts.Node): ts.ExpressionStatement {
  const statement = ts.factory.createExpressionStatement(
    ts.factory.createCallExpression(helperRef(state, name), undefined, args)
  )
  return source ? tagStatement(state, statement, source) : statement
}

function createConstStatement(state: CompileState, name: ts.Identifier, initializer: ts.Expression, source?: ts.Node): ts.VariableStatement {
  const statement = ts.factory.createVariableStatement(
    undefined,
    ts.factory.createVariableDeclarationList([
      ts.factory.createVariableDeclaration(name, undefined, undefined, initializer)
    ], ts.NodeFlags.Const)
  )
  return source ? tagStatement(state, statement, source) : statement
}

/** Record where an emitted statement originated from, for source map generation. */
function tagStatement<T extends ts.Statement>(state: CompileState, statement: T, source: ts.Node): T {
  const position = positionOfNode(state, source)
  if (position) state.statementSources.set(statement, position)
  return statement
}

function positionOfNode(state: CompileState, node: ts.Node): SourcePosition | null {
  // ts.transform 产生的节点副本可能丢失 sourceFile 引用，回退到当前编译的源文件。
  const sourceFile = node.getSourceFile() ?? state.sourceFile
  if (!sourceFile || node.pos < 0) return null
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
  return { line, column: character }
}

function nextIdentifier(state: CompileState, prefix: string): ts.Identifier {
  let name: string
  do {
    name = `${prefix}${state.generatedId++}`
  } while (state.takenNames.has(name))
  return ts.factory.createIdentifier(name)
}
