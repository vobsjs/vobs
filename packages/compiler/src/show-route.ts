/**
 * The routing decision for the C232 root fix (2026-10-28): extract "condition + keyed map call" from ternary / `&&` chains.
 *
 * On a hit the compiler routes it to `insertShow` (a conditional container + standard insertList inside the container) —
 * cond and the list are split into two subscription layers: cond only manages container mount/unmount, the list reuses by key, no more whole-list rebuilds.
 * analyze (the C232 warning) and compile (output generation) share this decision, guaranteeing "whatever is not warned about is definitely routed".
 */
import ts from 'typescript'

/** Strips wrappers that have no effect on runtime value extraction: parentheses, `as` / `satisfies` assertions, non-null assertions. */
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
    // Do not descend into nested functions: an inner component returning JSX does not make the outer one a component
    if (child !== node && ts.isFunctionLike(child)) return
    ts.forEachChild(child, visit)
  }
  ts.forEachChild(node, visit)
  return seen
}

/** A keyed map call: `.map(callback)` where the callback is a function producing JSX (matching the compiler's insertList channel detection). */
export function isKeyedListCall(node: ts.Node): boolean {
  if (!ts.isCallExpression(node)) return false
  if (!ts.isPropertyAccessExpression(node.expression) || node.expression.name.text !== 'map') return false
  const callback = node.arguments[0]
  return callback !== undefined && ts.isFunctionLike(callback) && returnsJsx(callback)
}

/** An empty branch: null / false / undefined (after unwrap). */
export function isEmptyBranch(node: ts.Expression): boolean {
  const u = unwrapExpr(node)
  return u.kind === ts.SyntaxKind.NullKeyword
    || u.kind === ts.SyntaxKind.FalseKeyword
    || u.kind === ts.SyntaxKind.UndefinedKeyword
}

export interface ShowListShape {
  /** The condition routed to insertShow; null = always true (the branch itself is a top-level map). */
  condition: ts.Expression | null
  mapCall: ts.Expression
}

/**
 * Extract "condition + keyed map call" from a ternary / `&&` chain.
 *
 * Supported: `cond ? list : null`, `cond ? null : list` (condition negated), `cond && list`,
 * nested combinations (`a && b && list`, `cond ? (x ? list : null) : null` — conditions merged along the chain).
 * Not supported (returns null; polymorphic insertion + the C232 warning continue): both branches are lists, lists mixed with nodes,
 * or a map that does not produce JSX.
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
