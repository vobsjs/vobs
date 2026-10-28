/**
 * C232 根治（2026-10-28）的路由判定：三元 / `&&` 链中提取「条件 + keyed map call」。
 *
 * 命中即由编译器路由为 `insertShow`（条件容器 + 容器内标准 insertList）——
 * cond 与列表拆成两层订阅：cond 只管容器挂载/卸载，列表按 key 复用，不再整列重建。
 * analyze（C232 警告）与 compile（产物生成）共用本判定，保证「不警告的形态一定被路由」。
 */
import ts from 'typescript'

/** 剥掉对运行时取值没有影响的包装：括号、`as` / `satisfies` 断言、非空断言。 */
export function unwrapExpr(node: ts.Expression): ts.Expression {
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

function returnsJsx(node: ts.Node): boolean {
  let seen = false
  const visit = (child: ts.Node): void => {
    if (seen) return
    if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child) || ts.isJsxFragment(child)) {
      seen = true
      return
    }
    // 不进入嵌套函数：内层组件返回 JSX 不代表外层是组件
    if (child !== node && ts.isFunctionLike(child)) return
    ts.forEachChild(child, visit)
  }
  ts.forEachChild(node, visit)
  return seen
}

/** keyed map call：`.map(回调)`，回调为函数且产出 JSX（与编译器 insertList 通道的识别一致）。 */
export function isKeyedListCall(node: ts.Node): boolean {
  if (!ts.isCallExpression(node)) return false
  if (!ts.isPropertyAccessExpression(node.expression) || node.expression.name.text !== 'map') return false
  const callback = node.arguments[0]
  return callback !== undefined && ts.isFunctionLike(callback) && returnsJsx(callback)
}

/** 空分支：null / false / undefined（unwrap 后）。 */
export function isEmptyBranch(node: ts.Expression): boolean {
  const u = unwrapExpr(node)
  return u.kind === ts.SyntaxKind.NullKeyword
    || u.kind === ts.SyntaxKind.FalseKeyword
    || u.kind === ts.SyntaxKind.UndefinedKeyword
}

export interface ShowListShape {
  /** 路由到 insertShow 的条件；null = 恒真（分支本身是顶层 map）。 */
  condition: ts.Expression | null
  mapCall: ts.Expression
}

/**
 * 从三元 / `&&` 链中提取「条件 + keyed map call」。
 *
 * 支持：`cond ? list : null`、`cond ? null : list`（条件取反）、`cond && list`、
 * 嵌套组合（`a && b && list`、`cond ? (x ? list : null) : null` —— 条件按链合并）。
 * 不支持（返回 null，继续走多态插入 + C232 警告）：两支都是 list、list 与节点混排、
 * 非 JSX 产出的 map。
 */
export function routeShowList(expression: ts.Expression): ShowListShape | null {
  const u = unwrapExpr(expression)

  if (ts.isCallExpression(u)) {
    return isKeyedListCall(u) ? { condition: null, mapCall: u } : null
  }

  if (ts.isConditionalExpression(u)) {
    const a = routeShowList(u.whenTrue)
    if (a !== null && isEmptyBranch(u.whenFalse)) {
      return a.condition === null
        ? { condition: u.condition, mapCall: a.mapCall }
        : { condition: createAnd(u.condition, a.condition), mapCall: a.mapCall }
    }
    const b = routeShowList(u.whenFalse)
    if (b !== null && isEmptyBranch(u.whenTrue)) {
      const condition = negate(u.condition)
      return b.condition === null
        ? { condition, mapCall: b.mapCall }
        : { condition: createAnd(condition, b.condition), mapCall: b.mapCall }
    }
    return null
  }

  if (ts.isBinaryExpression(u) && u.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
    const r = routeShowList(u.right)
    if (r !== null) {
      return r.condition === null
        ? { condition: u.left, mapCall: r.mapCall }
        : { condition: createAnd(u.left, r.condition), mapCall: r.mapCall }
    }
    return null
  }

  return null
}

function negate(condition: ts.Expression): ts.Expression {
  return ts.factory.createPrefixUnaryExpression(ts.SyntaxKind.ExclamationToken, condition)
}

function createAnd(left: ts.Expression, right: ts.Expression): ts.Expression {
  return ts.factory.createBinaryExpression(
    left,
    ts.factory.createToken(ts.SyntaxKind.AmpersandAmpersandToken),
    right
  )
}
