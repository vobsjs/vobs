import ts from 'typescript'
import { VobsError } from '@vobs/runtime/error'
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

export function compile(code: string, options: CompileOptions = {}): string {
  const result = compileWithSourceMap(code, options)
  const firstError = result.diagnostics.find(diagnostic => diagnostic.severity === 'error')
  if (firstError) {
    throw new VobsError({
      code: firstError.code,
      layer: 'compiler',
      message: firstError.message,
      location: firstError.location,
      codeFrame: firstError.codeFrame,
      fix: firstError.fix
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
    hmrModuleId: options.hmrModuleId ?? null
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
  // 模板声明必须先于 runtime import 生成：声明里的 createTemplate 依赖
  // helperRef 注册别名，import 需要在别名全部就绪后再构建。
  const templateDeclarations = createTemplateDeclarations(state)
  let resultFile = ts.factory.updateSourceFile(sourceFile, [
    ...createRuntimeImports(state),
    ...templateDeclarations,
    ...statements
  ])
  resultFile = transformResidualJsx(state, resultFile)

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

function buildCodeFrame(
  sourceFile: ts.SourceFile,
  start: number,
  length: number
): { line: number; column: number; codeFrame: string } {
  const position = sourceFile.getLineAndCharacterOfPosition(start)
  const lineText = sourceFile.text.split(/\r?\n/u)[position.line] ?? ''
  const markerLength = Math.max(1, Math.min(length, Math.max(1, lineText.length - position.character)))
  return {
    line: position.line + 1,
    column: position.character + 1,
    codeFrame: `${position.line + 1} | ${lineText}\n${' '.repeat(String(position.line + 1).length + 3 + position.character)}${'^'.repeat(markerLength)}`
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
  if (isStaticElement(tagName, attributes, children)) {
    return ts.factory.createCallExpression(
      helperRef(state, 'cloneTemplate'),
      undefined,
      [registerTemplate(state, serializeStaticHtml(node))]
    )
  }

  const elementName = tagName.getText()
  const elementId = nextIdentifier(state, '_el')
  const statements: ts.Statement[] = [
    createConstStatement(
      state,
      elementId,
      ts.factory.createCallExpression(
        helperRef(state, 'createElement'),
        undefined,
        [ts.factory.createStringLiteral(elementName)]
      ),
      node
    )
  ]

  appendAttributes(state, statements, elementId, attributes)
  appendChildren(state, statements, elementId, children)
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

function transformResourceBoundary(
  state: CompileState,
  node: ts.JsxElement | ts.JsxSelfClosingElement,
  attributes: ts.JsxAttributes,
  children: readonly ts.JsxChild[]
): ts.Expression {
  const resource = getAttributeExpression(attributes, 'resource')
  if (!resource) throw new VobsError({ code: 'VOBS_C002', layer: 'compiler', message: 'ResourceBoundary 必须提供 resource 属性', fix: '为 ResourceBoundary 添加 resource={resource}。' })
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
  if (!fallback) throw new VobsError({ code: 'VOBS_C002', layer: 'compiler', message: 'ErrorBoundary 必须提供 fallback 属性', fix: '为 ErrorBoundary 添加 fallback={(error, retry) => ...}。' })
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
  if (!promise) throw new VobsError({ code: 'VOBS_C002', layer: 'compiler', message: 'AsyncBoundary 必须提供 promise 属性', fix: '为 AsyncBoundary 添加 promise={promise}。' })
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
  for (const attribute of attributes.properties) {
    if (ts.isJsxSpreadAttribute(attribute)) return false
    if (!ts.isJsxAttribute(attribute)) return false
    const name = attribute.name.getText()
    if (name === 'key' || name === 'ref' || name.startsWith('on')) return false
    if (isPropertyAttribute(name)) return false
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
      // 与 appendChildren 的文本规范化保持一致，保证提升前后 DOM 文本逐字相同。
      const text = child.text.replace(/\s+/g, ' ').trimStart()
      if (text.trim()) html += escapeHtmlText(text)
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
      statements.push(callStatement(state, 'addEventListener', [
        element,
        ts.factory.createStringLiteral(name.slice(2).toLowerCase()),
        initializer.expression
      ], attribute))
      continue
    }

    if (!initializer) {
      if (hasSpread) {
        statements.push(callStatement(state, isPropertyAttribute(name) ? 'setProperty' : 'setAttribute', [element, ts.factory.createStringLiteral(isPropertyAttribute(name) ? name : name === 'className' ? 'class' : name), isPropertyAttribute(name) ? ts.factory.createTrue() : ts.factory.createStringLiteral('')], attribute))
        continue
      }
      if (isPropertyAttribute(name)) staticProps.push(createStaticProperty(name, ts.factory.createTrue()))
      else staticProps.push(createStaticProperty(name === 'className' ? 'class' : name, ts.factory.createStringLiteral('')))
      continue
    }
    if (ts.isStringLiteral(initializer)) {
      if (hasSpread) {
        statements.push(callStatement(state, isPropertyAttribute(name) ? 'setProperty' : 'setAttribute', [element, ts.factory.createStringLiteral(isPropertyAttribute(name) ? name : name === 'className' ? 'class' : name), ts.factory.createStringLiteral(initializer.text)], attribute))
        continue
      }
      staticProps.push(createStaticProperty(isPropertyAttribute(name) ? name : name === 'className' ? 'class' : name,
        ts.factory.createStringLiteral(initializer.text)))
      continue
    }

    const attributeName = name === 'className' ? 'class' : name
    const propertyAttribute = isPropertyAttribute(name)
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

function isPropertyAttribute(name: string): boolean {
  return name === 'value' || name === 'checked' || name === 'selected' || name === 'disabled'
    || name === 'multiple' || name === 'readOnly' || name === 'required'
    || name === 'autofocus' || name === 'hidden' || name === 'tabIndex'
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
      const text = child.text.replace(/\s+/g, ' ').trimStart()
      if (text.trim()) {
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
      if (!containsJsx(expression) && !ts.isIdentifier(expression)) {
        const textId = nextIdentifier(state, '_text')
        statements.push(createConstStatement(state, textId, ts.factory.createCallExpression(helperRef(state, 'createText'), undefined, [ts.factory.createStringLiteral('')]), child))
        statements.push(callStatement(state, 'insertBefore', [element, textId, anchor], child))
        statements.push(callStatement(state, 'bindText', [textId, createGetter(expression)], child))
        continue
      }
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
 * 返回 null 表示没有任何分支产出节点（纯文本/数值场景走 insertDynamicValue 文本绑定）。
 */
function convertDynamicNodeExpression(state: CompileState, expression: ts.Expression): ts.ConditionalExpression | null {
  if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
    const right = unwrapExpression(expression.right)
    if (isJsxExpression(right)) {
      return createNodeConditional(expression.left, transformJsxExpression(state, right), null)
    }
    // 右侧是嵌套的动态节点表达式（如 cond && (sub ? <A/> : <B/>)）时递归转换，
    // 转换失败（纯文本分支）则整体回落为动态值绑定，保持语义可静态判定。
    const convertedRight = convertDynamicNodeExpression(state, right)
    if (convertedRight) return createNodeConditional(expression.left, convertedRight, null)
    return null
  }

  if (ts.isConditionalExpression(expression)) {
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
  if (!ts.isCallExpression(expression) || expression.arguments.length !== 1) return null
  if (!ts.isPropertyAccessExpression(expression.expression) || expression.expression.name.text !== 'map') return null

  const callback = expression.arguments[0]
  if (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) return null
  const body = unwrapExpression(callback.body)
  if (!isJsxExpression(body) || ts.isJsxFragment(body)) return null

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

function unwrapExpression(node: ts.Expression | ts.ConciseBody): ts.Expression {
  return ts.isParenthesizedExpression(node) ? node.expression : node as ts.Expression
}

function childToComponentExpression(state: CompileState, child: ts.JsxChild): ts.Expression[] {
  if (ts.isJsxText(child)) {
    const text = child.text.replace(/\s+/g, ' ').trim()
    return text ? [ts.factory.createStringLiteral(text)] : []
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
