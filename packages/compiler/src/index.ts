// @vobs/compiler 入口

export { compile, compileWithSourceMap, createCompiler } from './compile.ts'
export { createI18nExtractor } from './i18n-extractor.ts'
export type { I18nExtractor, I18nExtractorOptions } from './i18n-extractor.ts'
export type {
  AnalyzeContext,
  ASTNode,
  CompileResult,
  CompilerDiagnostic,
  CompileOptions,
  CompilerContext,
  CompilerOptions,
  CompilerPlugin,
  Program,
  TransformContext,
  VobsCompiler,
  VobsSourceMap
} from './plugin.ts'
