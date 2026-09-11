import ts from 'typescript'

export type ASTNode = ts.Node
export type Program = ts.SourceFile

export interface CompilerContext {
  readonly filename: string
  readonly factory: typeof ts.factory
  addRuntimeImport(name: string): void
  /**
   * Create a reference to a runtime helper in generated code. When the source
   * binds the same name, the compiler imports the helper under an alias and
   * this returns the aliased identifier, so plugin-generated calls never
   * collide with user bindings.
   */
  helperRef(name: string): ts.Identifier
}

export type AnalyzeContext = CompilerContext
export type TransformContext = CompilerContext

export interface CompilerPlugin {
  readonly name: string
  analyze?: (program: Program, context: AnalyzeContext) => void
  transform?: {
    program?: (program: Program, context: TransformContext) => Program | undefined
    node?: (node: ASTNode, context: TransformContext) => ASTNode | null | undefined
  }
  /** @deprecated Use transform.node for new plugins. */
  transformNode?: (node: ASTNode, context: TransformContext) => ASTNode | null | undefined
}

export interface CompilerOptions {
  plugins?: readonly CompilerPlugin[]
}

export interface CompileOptions extends CompilerOptions {
  filename?: string
  /**
   * 是否为组件调用生成源码位置（{ file, line, column }，用于错误定位与 DevTools）。
   * 默认 true。生产构建应传 false 以减小产物体积，省略后错误仍带组件名，定位走 source map。
   */
  sourceLocation?: boolean
  /**
   * HMR 模块标识（dev 由 Vite 插件注入，通常为模块绝对路径）。提供后，模块顶层的
   * state() 声明会包装为 hmrStateRef(...)：热更新重执行模块时复用既有信号实例，
   * 避免"新旧两份模块实例、两份状态"导致的页面半边失灵。
   */
  hmrModuleId?: string
}

export interface VobsSourceMap {
  readonly version: 3
  readonly file: string
  readonly sources: string[]
  readonly sourcesContent: string[]
  readonly names: string[]
  readonly mappings: string
}

export interface CompileResult {
  readonly code: string
  readonly map: VobsSourceMap
  readonly diagnostics: readonly CompilerDiagnostic[]
}

export interface CompilerDiagnostic {
  readonly code: string
  readonly severity: 'error' | 'warning'
  readonly message: string
  readonly location: {
    readonly file: string
    readonly line: number
    readonly column: number
  }
  readonly codeFrame?: string
  readonly fix?: string
}

export interface VobsCompiler {
  compile(code: string, options?: CompileOptions): string
  compileWithSourceMap(code: string, options?: CompileOptions): CompileResult
}
