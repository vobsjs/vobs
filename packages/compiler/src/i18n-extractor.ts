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

/**
 * Collects statically addressable translation keys without changing emitted code.
 *
 * ## Known limitations (deliberate trade-offs, not TODOs)
 *
 * Matching only looks at **the callee's name**: `t('x')`, `i18n.t('x')`, `this.t('x')` are all collected,
 * so `obj.t('x')` (a plain method that happens to be named t) and `t` **shadowed by parameters/locals** are collected too.
 *
 * Why no scope analysis is done to exclude them: for a key collector, the two errors are **extremely asymmetric** —
 * over-collecting just adds a few unused keys (no side effects), while under-collecting means the UI really is missing a translation.
 * And any approximate shadowing analysis inevitably misjudges some cases (e.g. `const { t } = useI18n()` followed by `t(...)` calls),
 * which errs toward "under-collecting". So this chooses over-collecting, and documents the limitation here instead of leaving users to trip over it.
 *
 * To tighten it, `options.functions` can specify exact function names (default `['t']`).
 */
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
