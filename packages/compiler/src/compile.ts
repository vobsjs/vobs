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

let generatedId = 0
let currentFilename = 'component.tsx'
let currentSourceFile: ts.SourceFile | null = null
let statementSources = new WeakMap<ts.Statement, SourcePosition>()
/** 源文件中已声明的绑定名（含嵌套作用域）：注入运行时 import 与生成临时变量时避开命名冲突。 */
let takenNames = new Set<string>()
/** 运行时 helper 的规范名 → 产物中的引用名（无冲突时与规范名相同）。 */
let helperAliases = new Map<string, string>()
/** 编译器自身产出的诊断（如不支持的 JSX 形态），与 TypeScript 解析诊断合并返回。 */
let compileDiagnostics: CompilerDiagnostic[] = []

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
  generatedId = 0
  const filename = options.filename ?? 'component.tsx'
  currentFilename = filename
  statementSources = new WeakMap()
  let sourceFile = ts.createSourceFile(
    filename,
    code,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  )
  currentSourceFile = sourceFile
  takenNames = collectDeclaredNames(sourceFile)
  helperAliases = new Map()
  compileDiagnostics = []
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
      resolveHelperName(name)
    },
    helperRef
  }

  for (const plugin of plugins) plugin.analyze?.(sourceFile, context)
  for (const plugin of plugins) {
    sourceFile = plugin.transform?.program?.(sourceFile, context) ?? sourceFile
  }
  for (const plugin of plugins) sourceFile = transformPluginNodes(sourceFile, plugin, context)

  const statements = sourceFile.statements.map(statement =>
    ts.isImportDeclaration(statement) ? rebuildImport(statement) : transformStatement(statement)
  )
  const resultFile = ts.factory.updateSourceFile(sourceFile, [...createRuntimeImports(), ...statements])

  const generated = ts.createPrinter().printFile(resultFile)
  return {
    code: generated,
    map: buildSourceMap(filename, code, generated, resultFile),
    diagnostics: [...diagnostics, ...compileDiagnostics]
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
function reportUnsupportedTag(tagName: ts.JsxTagNameExpression): void {
  const sourceFile = tagName.getSourceFile() ?? currentSourceFile
  if (!sourceFile) return
  const label = tagName.getText()
  const kindNote = tagName.kind === ts.SyntaxKind.JsxNamespacedName ? '（JSX 命名空间标签）' : ''
  const { line, column, codeFrame } = buildCodeFrame(sourceFile, tagName.getStart(sourceFile), tagName.getWidth(sourceFile))
  compileDiagnostics.push({
    code: 'VOBS_C101',
    severity: 'error',
    message: `不支持的 JSX 标签形态：<${label}>${kindNote}。组件必须是大写开头的标识符，DOM 元素必须是小写标签名。`,
    location: { file: currentFilename, line, column },
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
  filename: string,
  source: string,
  generated: string,
  resultFile: ts.SourceFile
): import('./plugin').VobsSourceMap {
  const reparsed = ts.createSourceFile(filename, generated, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const segments: MappingSegment[] = []
  walkPairedTrees(resultFile, reparsed, reparsed, segments)
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
      recordSegment(originalStatement, generatedStatement, reparsed, segments)
      walkPairedTrees(originalStatement, generatedStatement, reparsed, segments)
    }
    return
  }

  const originalChildren: ts.Node[] = []
  const generatedChildren: ts.Node[] = []
  ts.forEachChild(original, node => { originalChildren.push(node) })
  ts.forEachChild(generated, node => { generatedChildren.push(node) })
  if (originalChildren.length !== generatedChildren.length) return
  for (let index = 0; index < originalChildren.length; index++) {
    walkPairedTrees(originalChildren[index], generatedChildren[index], reparsed, segments)
  }
}

function recordSegment(
  originalStatement: ts.Statement,
  generatedStatement: ts.Statement,
  reparsed: ts.SourceFile,
  segments: MappingSegment[]
): void {
  const source = statementSources.get(originalStatement) ?? positionOfOriginalStatement(originalStatement)
  if (!source) return
  const position = reparsed.getLineAndCharacterOfPosition(generatedStatement.getStart(reparsed))
  segments.push({
    genLine: position.line,
    genCol: position.character,
    srcLine: source.line,
    srcCol: source.column
  })
}

function positionOfOriginalStatement(statement: ts.Statement): SourcePosition | null {
  if (statement.pos < 0 || !currentSourceFile) return null
  const { line, character } = currentSourceFile.getLineAndCharacterOfPosition(
    statement.getStart(currentSourceFile)
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
function resolveHelperName(name: string): string {
  const existing = helperAliases.get(name)
  if (existing) return existing
  let alias = name
  if (takenNames.has(alias)) {
    alias = `_vobs_${name}`
    let suffix = 1
    while (takenNames.has(alias)) alias = `_vobs_${name}_${suffix++}`
  }
  helperAliases.set(name, alias)
  return alias
}

/** Create a reference to a runtime helper in generated code, matching the injected import. */
function helperRef(name: string): ts.Identifier {
  return ts.factory.createIdentifier(resolveHelperName(name))
}

function createRuntimeImports(): ts.ImportDeclaration[] {
  const modules = new Map<string, ts.ImportSpecifier[]>()
  for (const [name, alias] of helperAliases) {
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

function rebuildImport(node: ts.ImportDeclaration): ts.ImportDeclaration {
  if (!ts.isStringLiteral(node.moduleSpecifier)) return node
  return tagStatement(ts.factory.createImportDeclaration(
    node.modifiers,
    node.importClause,
    ts.factory.createStringLiteral(node.moduleSpecifier.text),
    node.attributes
  ), node)
}

function transformStatement(node: ts.Statement): ts.Statement {
  if (ts.isFunctionDeclaration(node) && node.body) {
    return tagStatement(ts.factory.updateFunctionDeclaration(
      node,
      node.modifiers,
      node.asteriskToken,
      node.name,
      node.typeParameters,
      node.parameters,
      node.type,
      transformBlock(node.body)
    ), node)
  }

  if (ts.isVariableStatement(node)) return transformVariableStatement(node)
  if (ts.isExportAssignment(node) && containsJsx(node.expression)) {
    return tagStatement(ts.factory.updateExportAssignment(node, node.modifiers, transformEmbeddedExpression(node.expression)), node)
  }
  if (ts.isExpressionStatement(node) && containsJsx(node.expression)) {
    return tagStatement(ts.factory.updateExpressionStatement(node, transformEmbeddedExpression(node.expression)), node)
  }
  if (ts.isReturnStatement(node) && node.expression && containsJsx(node.expression)) {
    return tagStatement(ts.factory.updateReturnStatement(node, transformEmbeddedExpression(node.expression)), node)
  }
  return node
}

function transformVariableStatement(node: ts.VariableStatement): ts.VariableStatement {
  const declarations = node.declarationList.declarations.map(declaration => {
    const initializer = declaration.initializer
    if (!initializer || !containsJsx(initializer)) return declaration

    return ts.factory.updateVariableDeclaration(
      declaration,
      declaration.name,
      declaration.exclamationToken,
      declaration.type,
      transformEmbeddedExpression(initializer)
    )
  })

  if (declarations.every((declaration, index) => declaration === node.declarationList.declarations[index])) {
    return node
  }

  return tagStatement(ts.factory.updateVariableStatement(
    node,
    node.modifiers,
    ts.factory.updateVariableDeclarationList(node.declarationList, declarations)
  ), node)
}

function containsJsx(expression: ts.Expression): boolean {
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

function transformBlock(block: ts.Block): ts.Block {
  const statements = block.statements.map(statement => {
    if (!ts.isReturnStatement(statement) || !statement.expression) return transformStatement(statement)
    const expression = ts.isParenthesizedExpression(statement.expression)
      ? statement.expression.expression
      : statement.expression
    return isJsxExpression(expression)
      ? tagStatement(ts.factory.updateReturnStatement(statement, transformJsxExpression(expression)), statement)
      : statement
  })
  return ts.factory.updateBlock(block, statements)
}

function isJsxExpression(node: ts.Expression): node is ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment {
  return ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)
}

function transformJsxExpression(node: ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment): ts.Expression {
  if (ts.isJsxFragment(node)) return transformFragment(node.children)
  if (ts.isJsxElement(node)) {
    return transformElement(node, node.openingElement.tagName, node.openingElement.attributes, node.children)
  }
  return transformElement(node, node.tagName, node.attributes, [])
}

function transformElement(
  node: ts.JsxElement | ts.JsxSelfClosingElement,
  tagName: ts.JsxTagNameExpression,
  attributes: ts.JsxAttributes,
  children: readonly ts.JsxChild[]
): ts.Expression {
  if (isFragmentTag(tagName)) return transformFragment(children)
  if (!ts.isIdentifier(tagName)) {
    // <Foo.Bar>、<svg:rect> 等形态此前会静默编译成无效 DOM 标签（createElement("Foo.Bar")）。
    // 报结构化诊断后按原路径继续，保证产物结构稳定；compile()/Vite 插件会因 error 诊断直接失败。
    reportUnsupportedTag(tagName)
  }
  if (ts.isIdentifier(tagName) && tagName.text === 'ResourceBoundary') {
    return transformResourceBoundary(node, attributes, children)
  }
  if (ts.isIdentifier(tagName) && tagName.text === 'AsyncBoundary') {
    return transformAsyncBoundary(node, attributes, children)
  }
  if (ts.isIdentifier(tagName) && tagName.text === 'ErrorBoundary') {
    return transformErrorBoundary(node, attributes, children)
  }
  if (ts.isIdentifier(tagName) && tagName.text === 'Profiler') {
    return transformProfiler(node, attributes, children)
  }
  if (ts.isIdentifier(tagName) && /^[A-Z]/.test(tagName.text)) {
    return ts.factory.createCallExpression(
      helperRef('createComponent'),
      undefined,
      [
        ts.factory.createCallExpression(helperRef('resolveComponent'), undefined, [
          tagName,
          ts.factory.createStringLiteral(currentFilename),
          ts.factory.createStringLiteral(tagName.text)
        ]),
        createComponentProps(attributes, children),
        createSourceLocation(tagName)
      ]
    )
  }

  const elementName = tagName.getText()
  const elementId = nextIdentifier('_el')
  const statements: ts.Statement[] = [
    createConstStatement(
      elementId,
      ts.factory.createCallExpression(
        helperRef('createElement'),
        undefined,
        [ts.factory.createStringLiteral(elementName)]
      ),
      node
    )
  ]

  appendAttributes(statements, elementId, attributes)
  appendChildren(statements, elementId, children)
  statements.push(tagStatement(ts.factory.createReturnStatement(elementId), node))

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

function transformFragment(children: readonly ts.JsxChild[]): ts.Expression {
  const parent = nextIdentifier('_fragmentParent')
  const anchor = nextIdentifier('_fragmentAnchor')
  const statements: ts.Statement[] = []
  appendChildren(statements, parent, children, anchor)
  return ts.factory.createCallExpression(
    helperRef('createFragment'),
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
  node: ts.JsxElement | ts.JsxSelfClosingElement,
  attributes: ts.JsxAttributes,
  children: readonly ts.JsxChild[]
): ts.Expression {
  const resource = getAttributeExpression(attributes, 'resource')
  if (!resource) throw new VobsError({ code: 'VOBS_C002', layer: 'compiler', message: 'ResourceBoundary 必须提供 resource 属性', fix: '为 ResourceBoundary 添加 resource={resource}。' })
  const options: ts.ObjectLiteralElementLike[] = [
    ts.factory.createPropertyAssignment('resource', transformEmbeddedExpression(resource)),
    ts.factory.createPropertyAssignment('children', createBoundaryFactory(children))
  ]
  appendBoundaryOptionalProperty(options, attributes, 'loading')
  appendBoundaryOptionalProperty(options, attributes, 'empty')
  appendBoundaryOptionalProperty(options, attributes, 'fallback')
  return createBoundaryFragment(node, 'insertResourceBoundary', options)
}

function transformErrorBoundary(
  node: ts.JsxElement | ts.JsxSelfClosingElement,
  attributes: ts.JsxAttributes,
  children: readonly ts.JsxChild[]
): ts.Expression {
  const fallback = getAttributeExpression(attributes, 'fallback')
  if (!fallback) throw new VobsError({ code: 'VOBS_C002', layer: 'compiler', message: 'ErrorBoundary 必须提供 fallback 属性', fix: '为 ErrorBoundary 添加 fallback={(error, retry) => ...}。' })
  return createBoundaryFragment(node, 'insertErrorBoundary', [
    ts.factory.createPropertyAssignment('children', createBoundaryFactory(children)),
    ts.factory.createPropertyAssignment('fallback', transformEmbeddedExpression(fallback))
  ])
}

function transformAsyncBoundary(
  node: ts.JsxElement | ts.JsxSelfClosingElement,
  attributes: ts.JsxAttributes,
  children: readonly ts.JsxChild[]
): ts.Expression {
  const promise = getAttributeExpression(attributes, 'promise')
  if (!promise) throw new VobsError({ code: 'VOBS_C002', layer: 'compiler', message: 'AsyncBoundary 必须提供 promise 属性', fix: '为 AsyncBoundary 添加 promise={promise}。' })
  const options: ts.ObjectLiteralElementLike[] = [
    ts.factory.createPropertyAssignment('promise', transformEmbeddedExpression(promise)),
    ts.factory.createPropertyAssignment('children', createAsyncFactory(children))
  ]
  appendBoundaryOptionalProperty(options, attributes, 'loading')
  appendBoundaryOptionalProperty(options, attributes, 'fallback')
  const resetKey = getAttributeExpression(attributes, 'resetKey')
  if (resetKey) options.push(ts.factory.createPropertyAssignment('resetKey', createGetter(resetKey)))
  return createBoundaryFragment(node, 'insertAsyncBoundary', options)
}

function transformProfiler(
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
    ts.factory.createPropertyAssignment('id', transformEmbeddedExpression(id)),
    ts.factory.createPropertyAssignment('children', createBoundaryFactory(children))
  ]
  appendBoundaryOptionalProperty(options, attributes, 'onRender')
  return createBoundaryFragment(node, 'insertProfiler', options)
}

function createBoundaryFragment(
  node: ts.JsxElement | ts.JsxSelfClosingElement,
  helper: 'insertResourceBoundary' | 'insertErrorBoundary' | 'insertAsyncBoundary' | 'insertProfiler',
  options: readonly ts.ObjectLiteralElementLike[]
): ts.Expression {
  const parent = nextIdentifier('_boundaryParent')
  const anchor = nextIdentifier('_boundaryAnchor')
  return ts.factory.createCallExpression(
    helperRef('createFragment'),
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
      ts.factory.createBlock([callStatement(helper, [
        parent,
        anchor,
        ts.factory.createObjectLiteralExpression(options, true)
      ], node)], true)
    )]
  )
}

function createBoundaryFactory(children: readonly ts.JsxChild[]): ts.ArrowFunction {
  const content = transformFragment(children)
  return ts.factory.createArrowFunction(
    undefined,
    undefined,
    [],
    undefined,
    ts.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    content
  )
}

function createAsyncFactory(children: readonly ts.JsxChild[]): ts.ArrowFunction {
  const value = ts.factory.createIdentifier('value')
  const expressionChild = children.length === 1 && children[0].kind === ts.SyntaxKind.JsxExpression
    ? (children[0] as ts.JsxExpression).expression
    : undefined
  if (expressionChild && ts.isArrowFunction(expressionChild)) {
    const transformed = transformEmbeddedExpression(expressionChild)
    return transformed as ts.ArrowFunction
  }
  const content = transformFragment(children)
  return ts.factory.createArrowFunction(undefined, undefined, [
    ts.factory.createParameterDeclaration(undefined, undefined, value)
  ], undefined, ts.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken), content)
}

function appendBoundaryOptionalProperty(
  properties: ts.ObjectLiteralElementLike[],
  attributes: ts.JsxAttributes,
  name: string
): void {
  const expression = getAttributeExpression(attributes, name)
  if (expression) {
    const transformed = transformEmbeddedExpression(expression)
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

function transformEmbeddedExpression(expression: ts.Expression): ts.Expression {
  const result = ts.transform(expression, [context => root => {
    const visit: ts.Visitor = node => {
      if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
        return transformJsxExpression(node)
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

function appendAttributes(
  statements: ts.Statement[],
  element: ts.Identifier,
  attributes: ts.JsxAttributes
): void {
  const staticProps: ts.ObjectLiteralElementLike[] = []
  const hasSpread = attributes.properties.some(attribute => ts.isJsxSpreadAttribute(attribute))
  for (const attribute of attributes.properties) {
    if (ts.isJsxSpreadAttribute(attribute)) {
      statements.push(callStatement('spreadProps', [element, transformEmbeddedExpression(attribute.expression)], attribute))
      continue
    }
    if (!ts.isJsxAttribute(attribute)) continue
    const name = attribute.name.getText()
    if (name === 'key') continue
    if (name === 'ref') {
      const initializer = attribute.initializer
      if (initializer && ts.isJsxExpression(initializer) && initializer.expression) {
        statements.push(callStatement('setRef', [element, transformEmbeddedExpression(initializer.expression)], attribute))
      }
      continue
    }
    const initializer = attribute.initializer

    if (name.startsWith('on') && initializer && ts.isJsxExpression(initializer) && initializer.expression) {
      statements.push(callStatement('addEventListener', [
        element,
        ts.factory.createStringLiteral(name.slice(2).toLowerCase()),
        initializer.expression
      ], attribute))
      continue
    }

    if (!initializer) {
      if (hasSpread) {
        statements.push(callStatement(isPropertyAttribute(name) ? 'setProperty' : 'setAttribute', [element, ts.factory.createStringLiteral(isPropertyAttribute(name) ? name : name === 'className' ? 'class' : name), isPropertyAttribute(name) ? ts.factory.createTrue() : ts.factory.createStringLiteral('')], attribute))
        continue
      }
      if (isPropertyAttribute(name)) staticProps.push(createStaticProperty(name, ts.factory.createTrue()))
      else staticProps.push(createStaticProperty(name === 'className' ? 'class' : name, ts.factory.createStringLiteral('')))
      continue
    }
    if (ts.isStringLiteral(initializer)) {
      if (hasSpread) {
        statements.push(callStatement(isPropertyAttribute(name) ? 'setProperty' : 'setAttribute', [element, ts.factory.createStringLiteral(isPropertyAttribute(name) ? name : name === 'className' ? 'class' : name), ts.factory.createStringLiteral(initializer.text)], attribute))
        continue
      }
      staticProps.push(createStaticProperty(isPropertyAttribute(name) ? name : name === 'className' ? 'class' : name,
        ts.factory.createStringLiteral(initializer.text)))
      continue
    }

    const attributeName = name === 'className' ? 'class' : name
    const propertyAttribute = isPropertyAttribute(name)
    if (ts.isJsxExpression(initializer) && initializer.expression) {
      statements.push(callStatement(propertyAttribute ? 'bindProperty' : 'bindAttribute', [
        element,
        ts.factory.createStringLiteral(propertyAttribute ? name : attributeName),
        createGetter(initializer.expression)
      ], attribute))
    }
  }
  if (staticProps.length) statements.splice(1, 0, callStatement('setStaticProps', [
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
  statements: ts.Statement[],
  element: ts.Identifier,
  children: readonly ts.JsxChild[],
  anchor: ts.Expression = ts.factory.createNull()
): void {
  for (const child of children) {
    if (ts.isJsxText(child)) {
      const text = child.text.replace(/\s+/g, ' ').trimStart()
      if (text.trim()) {
        statements.push(callStatement('insertBefore', [
        element,
        ts.factory.createCallExpression(helperRef('createText'), undefined, [
          ts.factory.createStringLiteral(text)
        ]),
        anchor
      ], child))
      }
      continue
    }

    if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child) || ts.isJsxFragment(child)) {
      statements.push(callStatement('insertBefore', [
        element,
        transformJsxExpression(child),
        anchor
      ], child))
      continue
    }

    if (child.kind === ts.SyntaxKind.JsxExpression) {
      const expression = (child as ts.JsxExpression).expression
      if (!expression) continue
      const list = transformListExpression(element, expression, anchor)
      if (list) {
        statements.push(callStatement('insertList', list, child))
        continue
      }
      const dynamic = transformDynamicExpression(expression)
      if (dynamic) {
        statements.push(callStatement('insertDynamic', [element, anchor, dynamic], child))
        continue
      }
      if (!containsJsx(expression) && !ts.isIdentifier(expression)) {
        const textId = nextIdentifier('_text')
        statements.push(createConstStatement(textId, ts.factory.createCallExpression(helperRef('createText'), undefined, [ts.factory.createStringLiteral('')]), child))
        statements.push(callStatement('insertBefore', [element, textId, anchor], child))
        statements.push(callStatement('bindText', [textId, createGetter(expression)], child))
        continue
      }
      const value = transformEmbeddedExpression(expression)
      statements.push(callStatement('insertDynamicValue', [element, anchor, createGetter(value)], child))
    }
  }
}

function createComponentProps(
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
      properties.push(createGetterProperty(name, transformEmbeddedExpression(initializer.expression)))
    }
  }

  const childExpressions = children.flatMap(childToComponentExpression)
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

function transformDynamicExpression(expression: ts.Expression): ts.ArrowFunction | null {
  if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
    const right = unwrapExpression(expression.right)
    if (!isJsxExpression(right)) return null
    return createGetter(ts.factory.createConditionalExpression(
      expression.left,
      ts.factory.createToken(ts.SyntaxKind.QuestionToken),
      transformJsxExpression(right),
      ts.factory.createToken(ts.SyntaxKind.ColonToken),
      ts.factory.createNull()
    ))
  }

  if (ts.isConditionalExpression(expression)) {
    const whenTrue = transformDynamicBranch(expression.whenTrue)
    const whenFalse = transformDynamicBranch(expression.whenFalse)
    if (!whenTrue && !whenFalse) return null
    return createGetter(ts.factory.createConditionalExpression(
      expression.condition,
      ts.factory.createToken(ts.SyntaxKind.QuestionToken),
      whenTrue ?? ts.factory.createNull(),
      ts.factory.createToken(ts.SyntaxKind.ColonToken),
      whenFalse ?? ts.factory.createNull()
    ))
  }

  return null
}

function transformDynamicBranch(expression: ts.Expression): ts.Expression | null {
  const branch = unwrapExpression(expression)
  if (isJsxExpression(branch)) return transformJsxExpression(branch)
  if (branch.kind === ts.SyntaxKind.NullKeyword || branch.kind === ts.SyntaxKind.FalseKeyword) return branch
  return null
}

function transformListExpression(
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
  const renderItem = transformListCallback(callback, transformJsxExpression(body))
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

function childToComponentExpression(child: ts.JsxChild): ts.Expression[] {
  if (ts.isJsxText(child)) {
    const text = child.text.replace(/\s+/g, ' ').trim()
    return text ? [ts.factory.createStringLiteral(text)] : []
  }
  if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child) || ts.isJsxFragment(child)) {
    return [transformJsxExpression(child)]
  }
  if (child.kind === ts.SyntaxKind.JsxExpression) {
    const expression = (child as ts.JsxExpression).expression
    return expression ? [transformEmbeddedExpression(expression)] : []
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

function callStatement(name: string, args: ts.Expression[], source?: ts.Node): ts.ExpressionStatement {
  const statement = ts.factory.createExpressionStatement(
    ts.factory.createCallExpression(helperRef(name), undefined, args)
  )
  return source ? tagStatement(statement, source) : statement
}

function createConstStatement(name: ts.Identifier, initializer: ts.Expression, source?: ts.Node): ts.VariableStatement {
  const statement = ts.factory.createVariableStatement(
    undefined,
    ts.factory.createVariableDeclarationList([
      ts.factory.createVariableDeclaration(name, undefined, undefined, initializer)
    ], ts.NodeFlags.Const)
  )
  return source ? tagStatement(statement, source) : statement
}

/** Record where an emitted statement originated from, for source map generation. */
function tagStatement<T extends ts.Statement>(statement: T, source: ts.Node): T {
  const position = positionOfNode(source)
  if (position) statementSources.set(statement, position)
  return statement
}

function positionOfNode(node: ts.Node): SourcePosition | null {
  // ts.transform 产生的节点副本可能丢失 sourceFile 引用，回退到当前编译的源文件。
  const sourceFile = node.getSourceFile() ?? currentSourceFile
  if (!sourceFile || node.pos < 0) return null
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
  return { line, column: character }
}

function nextIdentifier(prefix: string): ts.Identifier {
  let name: string
  do {
    name = `${prefix}${generatedId++}`
  } while (takenNames.has(name))
  return ts.factory.createIdentifier(name)
}
