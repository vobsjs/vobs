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
   * Whether to emit source locations for component calls ({ file, line, column }; used for error locating and DevTools).
   * Defaults to true. Production builds should pass false to shrink the bundle; errors still carry the component name and positioning goes through the source map.
   */
  sourceLocation?: boolean
  /**
   * Whether to hoist fully static DOM subtrees into HTML templates (createTemplate/cloneTemplate,
   * which depend on document at runtime). Defaults to true; SSR/Node builds (vite build --ssr) must pass false,
   * otherwise the output crashes on load in a DOM-less environment.
   */
  hoistTemplates?: boolean
  /**
   * HMR module id (injected by the Vite plugin in dev, usually the module's absolute path). When provided, module-top-level
   * state() declarations are wrapped in hmrStateRef(...): on hot-update module re-execution the existing signal instances are reused,
   * avoiding the half-broken page caused by "two module instances, two copies of state".
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
