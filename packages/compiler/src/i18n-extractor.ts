import ts from 'typescript'
import type { CompilerPlugin } from './plugin'

export interface I18nExtractorOptions {
  readonly functions?: readonly string[]
  readonly onKey?: (key: string, filename: string) => void
}

export interface I18nExtractor {
  readonly plugin: CompilerPlugin
  getKeys(): readonly string[]
  reset(): void
}

/** Collects statically addressable translation keys without changing emitted code. */
export function createI18nExtractor(options: I18nExtractorOptions = {}): I18nExtractor {
  const names = new Set(options.functions ?? ['t'])
  const keys = new Set<string>()
  const plugin: CompilerPlugin = {
    name: 'i18n-extractor',
    analyze(program, context) {
      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && isTranslationCall(node.expression, names)) {
          const key = readStaticKey(node.arguments[0])
          if (key) {
            keys.add(key)
            options.onKey?.(key, context.filename)
          }
        }
        ts.forEachChild(node, visit)
      }
      visit(program)
    }
  }
  return {
    plugin,
    getKeys: () => [...keys].sort(),
    reset: () => keys.clear()
  }
}

function isTranslationCall(expression: ts.LeftHandSideExpression, names: Set<string>): boolean {
  if (ts.isIdentifier(expression)) return names.has(expression.text)
  return ts.isPropertyAccessExpression(expression) && names.has(expression.name.text)
}

function readStaticKey(argument: ts.Expression | undefined): string | undefined {
  if (!argument) return undefined
  if (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) return argument.text
  return undefined
}
