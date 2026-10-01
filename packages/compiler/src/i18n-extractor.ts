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
 * ## 已知限制（刻意的取舍，不是待办）
 *
 * 匹配只看**被调用者的名字**：`t('x')`、`i18n.t('x')`、`this.t('x')` 都收，
 * 因此 `obj.t('x')`（名字恰好叫 t 的普通方法）与**被参数/局部变量遮蔽**的 `t` 也会被收进来。
 *
 * 为什么不做作用域分析把它排除掉：对一个词条收集器，两种错的代价**极不对称** ——
 * 多收只是多几条用不到的词条（无副作用），漏收则意味着界面上真的没有翻译。
 * 而任何近似的遮蔽分析都必然误判一部分（比如 `const { t } = useI18n()` 之后再调 `t(...)`），
 * 那是往"漏收"的方向错。所以这里选择多收，并把限制写在这里而不是留给使用者踩。
 *
 * 要收紧的话，`options.functions` 可以指定精确的函数名（默认 `['t']`）。
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
