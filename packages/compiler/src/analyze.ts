/**
 * **Static analysis rules** for vobs source code (a list of problems found without running the app).
 *
 * ## Why this lives in `@vobs/compiler` and not the CLI
 *
 * These rules must be visible to both `vobs check` and `vite dev`/`vite build` —
 * if they only fired in check, **the AI fixes the code, `vite build` passes, but the problem is still there**,
 * which directly conflicts with "errors must not be silent".
 *
 * And `@vobs/vite-plugin` needs these rules but **cannot depend on the CLI** (the dependency direction would be inverted — the CLI is an
 * application-side tool). So they live in `@vobs/compiler`, which both sides already depend on: compiler diagnostics (`C104`–`C108`) and
 * analyzer diagnostics (`C118`/`C210`/`C232`/`C233`/`C234`) sit here together, so both channels get all the rules.
 */
import ts from 'typescript'
import { VOBS_C210 as C210_CODE, vobsC210Fix } from '@vobs/runtime'
import { isKeyedListCall, routeShowList, unwrapExpr } from './show-route'

export interface CheckDiagnostic {
  /** Stable error code; AI and docs look it up by this. */
  readonly code: string
  readonly severity: 'error' | 'warning'
  readonly message: string
  /** How to fix it. Reporting an error without this is worthless to an AI. */
  readonly fix: string
  /** Path relative to the target directory. */
  readonly file: string
  readonly line: number
  readonly column: number
  /** The original text of the offending line, for quick locating. */
  readonly snippet: string
}

/** An effect writes a signal it itself depends on. */
export const VOBS_C210 = C210_CODE
/** A list written in a branch position — keyed reuse is lost. */
export const VOBS_C232 = 'VOBS_C232'
/** A signal read in the component body and stored in a local variable — the body runs once, so it never updates afterwards. */
export const VOBS_C118 = 'VOBS_C118'
/** An array signal mutated in place via a mutator — the reference is unchanged, so subscribers never update. */
export const VOBS_C233 = 'VOBS_C233'
/** state() called without a debug name — runtime diagnostics show "(unnamed signal)", so it cannot be located. */
export const VOBS_C120 = 'VOBS_C120'
/** A signal outside deps is read inside an on callback — reads in the untrack scope establish no subscription. */
export const VOBS_C234 = 'VOBS_C234'

function returnsJsx(node: ts.Node): boolean {
  let seen = false
  const visit = (child: ts.Node): void => {
    if (seen) return
    if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child) || ts.isJsxFragment(child)) {
      seen = true
      return
    }
    // Do not descend into nested functions: an inner component returning JSX does not make the outer one a component
    if (child !== node && (ts.isFunctionLike(child))) return
    ts.forEachChild(child, visit)
  }
  ts.forEachChild(node, visit)
  return seen
}

/**
 * A `X.value`-shaped memory read; returns the receiver's text (`count` and `props.name` both count).
 *
 * Text rather than an identifier: signals are often passed in from elsewhere (`props.name.value`),
 * and accepting only bare identifiers would miss all of those.
 */
function signalNameOf(node: ts.Node): string | undefined {
  if (!ts.isPropertyAccessExpression(node)) return undefined
  if (node.name.text !== 'value') return undefined
  return node.expression.getText()
}

function lineSnippet(source: ts.SourceFile, node: ts.Node): string {
  const { line } = source.getLineAndCharacterOfPosition(node.getStart(source))
  return (source.text.split(/\r?\n/u)[line] ?? '').trim()
}

function diagnosticAt(
  source: ts.SourceFile,
  file: string,
  node: ts.Node,
  rest: Omit<CheckDiagnostic, 'file' | 'line' | 'column' | 'snippet'>
): CheckDiagnostic {
  const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source))
  return {
    ...rest,
    file,
    line: line + 1,
    column: character + 1,
    snippet: lineSnippet(source, node)
  }
}

const isWriteOperator = (kind: ts.SyntaxKind): boolean =>
  kind === ts.SyntaxKind.EqualsToken
  || kind === ts.SyntaxKind.PlusEqualsToken
  || kind === ts.SyntaxKind.MinusEqualsToken
  || kind === ts.SyntaxKind.AsteriskEqualsToken
  || kind === ts.SyntaxKind.SlashEqualsToken

/* ------------------------------------------------- Rule A: effect self-subscription */

/**
 * Names declared in an effect's **outer scope** whose initializer is **clearly not a signal**.
 *
 * ## Why it exists (a measured false-positive class)
 *
 * Same-name shadowing inside the effect body is already handled; but same-named locals **declared in the component body** still false-positived:
 *
 * ```ts
 * const count = state(0)          // outer signal
 * function P() {
 *   const count = { value: 0 }    // ← declared in the **component body** (not inside the effect)
 *   effect(() => { count.value = 1 })   // not a signal, yet treated as self-subscription
 * }
 * ```
 *
 * ## Test: is the initializer a **call**
 *
 * Signals are almost always produced by calls, so:
 *
 * | Shape | Verdict | Reason |
 * |---|---|---|
 * | `const c = { value: 0 }` | **not a signal** → skip | object literal |
 * | `const c = props.count` | **not a signal** → skip | property access |
 * | `const c = state(0)` | keep checking | a call — but genuinely a signal, correct |
 * | `const c = createStore()` | **keep checking** | a call — **unknowns are conservatively kept** (custom factory) |
 * | no initializer / destructuring | keep checking | undecidable |
 *
 * The last two rows are the crux of this test: **keep anything that might be factory-produced**,
 * so "signals imported from elsewhere" (no local declaration) and "custom store factories" are never wrongly eliminated.
 */
function collectNonSignalLocals(from: ts.Node): Set<string> {
  const nonSignal = new Set<string>()
  let node: ts.Node | undefined = from
  while (node !== undefined && !ts.isSourceFile(node)) {
    // `isFunctionLike` also matches signature declarations (no body), hence the optional-property access
    const fnBody = ts.isFunctionLike(node) ? (node as { body?: ts.ConciseBody }).body : undefined
    if (fnBody !== undefined && ts.isBlock(fnBody)) {
      const scan = (child: ts.Node): void => {
        // Do not descend into inner functions: they have their own scope, handled by their own round
        if (ts.isFunctionLike(child)) return
        if (ts.isVariableDeclaration(child) && ts.isIdentifier(child.name)
          && child.initializer !== undefined) {
          let init: ts.Expression = child.initializer
          while (ts.isParenthesizedExpression(init) || ts.isAsExpression(init)
            || ts.isTypeAssertionExpression(init)) {
            init = init.expression
          }
          // call/new → could be a signal factory → leave it to the later checks, do not exclude here
          if (!ts.isCallExpression(init) && !ts.isNewExpression(init)) {
            nonSignal.add(child.name.text)
          }
        }
        ts.forEachChild(child, scan)
      }
      ts.forEachChild(fnBody, scan)
    }
    node = node.parent
  }
  return nonSignal
}

function ruleEffectSelfSubscription(source: ts.SourceFile, file: string): CheckDiagnostic[] {
  const found: CheckDiagnostic[] = []

  const inspectEffectBody = (body: ts.Node): void => {
    const reads = new Map<string, ts.Node>()
    const writes = new Map<string, ts.Node>()

    /*
     * **Scope shadowing set**: names **declared** inside the effect callback body (including nested).
     *
     * Why needed: this rule compares read/write sets by **signal variable name**, so a "same-named local object" would be false-positived.
     * The measured false-positive shape (1/7 in the adversarial tests):
     *
     * ```ts
     * const count = state(0)              // outer signal
     * effect(() => {
     *   const count = { value: 0 }        // ← **redeclared** inside the effect body
     *   count.value = count.value + 1     // not a signal, yet treated as self-subscription
     * })
     * ```
     *
     * Calling it "shadowing" is accurate: the inner declaration covers the outer signal name. Since the name is
     * **redeclared** in the effect body, `X.value` should no longer be treated as that outer signal.
     *
     * Only names are collected, with no type judgment — but the **direction is safe**: a hit means skip (under-report),
     * not report (over-report). Under-reporting costs far less than false positives (the `C104` lesson:
     * 18 hits, 16 false positives; the cost was the whole team starting to ignore warnings).
     */
    const shadowed = new Set<string>()
    const collectDeclarations = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) shadowed.add(node.name.text)
      else if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isClassDeclaration(node))
        && node.name !== undefined && ts.isIdentifier(node.name)) shadowed.add(node.name.text)
      else if (ts.isParameter(node) && ts.isIdentifier(node.name)) shadowed.add(node.name.text)
      else if (ts.isCatchClause(node) && node.variableDeclaration !== undefined
        && ts.isIdentifier(node.variableDeclaration.name)) shadowed.add(node.variableDeclaration.name.text)
      ts.forEachChild(node, collectDeclarations)
    }
    // Note: `body` is the callback body; every declaration inside counts as shadowing (nested functions' too — the conservative direction)
    ts.forEachChild(body, collectDeclarations)
    // Parameters count too (the x in `effect((x) => { x.value = 1 })` is a parameter, not a signal)
    if (ts.isFunctionLike(body.parent)) {
      for (const parameter of body.parent.parameters) {
        if (ts.isIdentifier(parameter.name)) shadowed.add(parameter.name.text)
      }
    }
    /*
     * Local names in the **outer scope** (component body) that are "clearly not signals" are shadowed too — see collectNonSignalLocals.
     * This pass is **more precise** than the in-body one (only non-call initializers are excluded), because same-named outer locals are common
     * (`const count = props.count` and the like); a blanket rule would miss many real self-subscriptions.
     */
    for (const name of collectNonSignalLocals(body)) shadowed.add(name)

    const visit = (node: ts.Node, insideUntrack: boolean): void => {
      // Nested functions have their own subscription semantics; they do not count in this effect's reads/writes
      if (node !== body && ts.isFunctionLike(node)) return

      // Writes inside untrack(...) establish no subscription → exactly the correct form
      const nextUntracked = insideUntrack
        || (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'untrack')

      if (ts.isBinaryExpression(node) && isWriteOperator(node.operatorToken.kind)) {
        const name = signalNameOf(node.left)
        if (name !== undefined && !nextUntracked && !shadowed.has(name)) writes.set(name, node)
      } else if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node))
        && (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken)) {
        // `count.value++` is both a read and a write — the classic self-subscription shape
        const name = signalNameOf(node.operand)
        if (name !== undefined && !shadowed.has(name)) {
          if (!nextUntracked) writes.set(name, node)
          reads.set(name, node)
        }
      } else if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
        && node.expression.name.text === 'set') {
        const setName = node.expression.expression.getText()
        if (!nextUntracked && !shadowed.has(setName)) writes.set(setName, node)
      } else {
        const name = signalNameOf(node)
        if (name !== undefined && !shadowed.has(name)) {
          const parent = node.parent
          // Only the left side of an assignment-family operator is not a "read"; the left of `count.value < 1` is still a read
          const isAssignmentTarget = ts.isBinaryExpression(parent)
            && isWriteOperator(parent.operatorToken.kind)
            && parent.left === node
          if (!isAssignmentTarget) reads.set(name, node)
        }
      }

      ts.forEachChild(node, child => visit(child, nextUntracked))
    }

    visit(body, false)

    for (const [name, writeNode] of writes) {
      if (!reads.has(name)) continue
      found.push(diagnosticAt(source, file, writeNode, {
        /*
         * **error**: real self-subscriptions are worth failing CI over; the known false-positive shape (same-name shadowing) has
         * already been eliminated by the scope resolution above.
         *
         * Note: this rule still compares **by variable name**, not "actually subscribed". The real hard gate
         * remains the runtime guardrails (judged by the actual dependency set, precise across functions/modules).
         */
        code: VOBS_C210,
        severity: 'error',
        message: `effect writes the signal "${name}" it itself depends on — this write re-schedules it, forming a self-subscription loop`,
        // The fix text is **shared with** the runtime guardrails (diagnostic-text in @vobs/runtime) —
        // there used to be two copies; when 1.8.5 improved the runtime copy, this one was not synced and users saw the stale advice in vite.
        fix: vobsC210Fix(name)
      }))
    }
  }

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
      && (node.expression.text === 'effect' || node.expression.text === 'renderEffect')) {
      const callback = node.arguments[0]
      if (callback !== undefined && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) {
        inspectEffectBody(callback.body)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)

  return found
}

/* -------------------------------------- Rule B: list written in a branch position (C232) */

function ruleListInBranch(source: ts.SourceFile, file: string): CheckDiagnostic[] {
  const found: CheckDiagnostic[] = []
  const message = 'A list written in a ternary/&& branch — it goes through polymorphic insertion and loses keyed reuse; '
    + 'moreover, **a change of the branch condition itself also rebuilds the entire list**'
  const fix = 'Hoist the list into a **direct** child expression: write the conditional branch first, then write {items.map(...)} separately. '
    + 'When a ternary mixes nodes and a list, the list branch will not compile into insertList. '
    + '(Measured output comparison: in a branch it is insertDynamicValue(el, null, () => cond.value ? items.map(…) : null), '
    + 'while a direct child expression yields insertList(el, null, () => items, renderItem) — the former rebuilds every node on each re-run, '
    + 'and a cond change triggers a rebuild too (that getter reads it); the latter reuses/moves by key and only subscribes to the list source.) '
    + 'The impact depends on **item count and statefulness**: a few stateless buttons are negligible; '
    + 'dozens of items, or items holding focus/input/scroll state, must be fixed. '
    + '(Since 2026-10-28, simple shapes like `cond ? list : null` / `cond && list` are auto-routed by the compiler '
    + 'to insertShow — keyed reuse inside a conditional container; this rule no longer warns on them. '
    + 'What still warns are shapes the compiler cannot safely rewrite, such as nodes and lists mixed together.)'

  /*
   * Strictly isomorphic to the compiler's appendChildren: C232 only matters for lists that would go through insertDynamicValue.
   * - JsxExpression top level: a routeShowList hit = already routed by the compiler to insertShow (the whole subtree is absorbed,
   *   the condition compiled into a getter, the list branch going through in-container insertList) — skip, neither report nor descend.
   * - Not routed: check the keyed map in top-level ternary/&& branches (after unwrap), and descend into the subtree
   *   (the inner part of nested shapes still goes through polymorphic insertion, so it is reported as usual).
   */
  const visit = (node: ts.Node, routed: boolean): void => {
    if (routed) return
    if (ts.isJsxExpression(node)) {
      const expression = node.expression
      if (expression === undefined) return
      if (routeShowList(expression) !== null) return
      visit(unwrapExpr(expression), false)
      return
    }
    if (ts.isConditionalExpression(node)) {
      const trueList = isKeyedListCall(unwrapExpr(node.whenTrue))
      const falseList = isKeyedListCall(unwrapExpr(node.whenFalse))
      if (trueList) found.push(diagnosticAt(source, file, node.whenTrue, { code: VOBS_C232, severity: 'warning', message, fix }))
      if (falseList) found.push(diagnosticAt(source, file, node.whenFalse, { code: VOBS_C232, severity: 'warning', message, fix }))
      visit(node.whenTrue, false)
      visit(node.whenFalse, false)
      return
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      if (isKeyedListCall(unwrapExpr(node.right))) {
        found.push(diagnosticAt(source, file, node.right, { code: VOBS_C232, severity: 'warning', message, fix }))
      }
      visit(node.right, false)
      return
    }
    ts.forEachChild(node, child => visit(child, false))
  }
  visit(source, false)

  return found
}

/* --------------------------------- Rule C: signal read in the component body stored in a local (C118) */

function containsSignalRead(node: ts.Node): boolean {
  let seen = false
  const visit = (child: ts.Node): void => {
    if (seen) return
    // Reads inside function bodies are **deferred** (event handlers, timers, callbacks) and do not count as "reading a signal in the component body".
    // This check must come first: the read in `const handler = () => { signal.value }` is perfectly fine.
    if (ts.isFunctionLike(child)) return
    if (signalNameOf(child) !== undefined) {
      seen = true
      return
    }
    ts.forEachChild(child, visit)
  }
  visit(node)
  return seen
}

/**
 * Get a function's **own binding name** (used to tell whether it is "being called as a component").
 *
 * Covers `const render = () => {…}`, `function render() {…}`, `const o = { render() {…} }`;
 * anonymous functions (callbacks, IIFEs) return `undefined`.
 */
function ownNameOf(fn: ts.FunctionLikeDeclaration): string | undefined {
  if (fn.name !== undefined && ts.isIdentifier(fn.name)) return fn.name.text
  const parent = fn.parent
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text
  if (ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name)) return parent.name.text
  return undefined
}

/**
 * The set of identifiers **called inside JSX expressions** (the `{render()}` kind).
 *
 * ## Why collect it separately
 *
 * C118's premise is "this function body runs only once". But `render` in `{render()}` **re-runs on every evaluation** —
 * its `const shown = n.value` is fresh every round, and the code is perfectly correct.
 *
 * But `returnsJsx(render)` would classify such a render helper as a "component" → false positive (a measured leftover).
 *
 * ## Why only "calls" are collected, not "references"
 *
 * Accepting only callees is to **preserve true positives**:
 * - `{render()}` → a call → helper → skip ✓
 * - `component={P}` / `<RouterView component={P}/>` → a mere reference, not called → **P is still checked** ✓
 * - `<P/>` → a JSX tag, never inside a JsxExpression to begin with → still checked ✓
 */
function collectCalledInJsx(root: ts.Node): Set<string> {
  const called = new Set<string>()
  const visit = (node: ts.Node): void => {
    if (ts.isJsxExpression(node) && node.expression !== undefined) {
      const scan = (child: ts.Node): void => {
        if (ts.isCallExpression(child) && ts.isIdentifier(child.expression)) {
          called.add(child.expression.text)
        }
        ts.forEachChild(child, scan)
      }
      scan(node.expression)
    }
    ts.forEachChild(node, visit)
  }
  visit(root)
  return called
}

function ruleSignalCapturedInBody(source: ts.SourceFile, file: string): CheckDiagnostic[] {
  const found: CheckDiagnostic[] = []
  const calledInJsx = collectCalledInJsx(source)

  const inspectComponent = (fn: ts.FunctionLikeDeclaration): void => {
    /*
     * **A function called by a JSX expression is a helper, not a component.**
     *
     * ```tsx
     * const render = () => { const shown = n.value + 1; return <b>{shown}</b> }
     * return <div>{render()}</div>      // ← re-runs on every evaluation → shown is fresh
     * ```
     *
     * Its shape is identical to `export const Page = () => {…}` (a real component),
     * but the **call site** separates the two: the compiler never "manually calls" a component inside JSX.
     */
    const ownName = ownNameOf(fn)
    if (ownName !== undefined && calledInJsx.has(ownName)) return

    const body = fn.body
    if (body === undefined || !ts.isBlock(body) || !returnsJsx(fn)) return

    /*
     * **Immediately invoked functions are not components** (a measured false positive, from the real project Labelune).
     *
     * ```tsx
     * {qExpanded.value === job.id ? (
     *   <div>
     *     {(() => {                          // ← an IIFE at a JSX **child position**
     *       const failedShown = ...signal.value...
     *       return (<>...</>)
     *     })()}
     *   </div>
     * ) : null}
     * ```
     *
     * Expressions at JSX child positions are **dynamic** — this IIFE re-runs whenever a dependency changes,
     * so its `const x = signal.value` is **not** a run-once snapshot; the code is correct.
     *
     * But `returnsJsx(fn)` would classify it as a "component" and report C118 — a **false positive**.
     */
    /*
     * **Mind the parentheses**: in `(() => {...})()`, that arrow's **parent is a
     * `ParenthesizedExpression`, not a `CallExpression`** — checking one level of `parent` cannot catch it.
     */
    let callee: ts.Node = fn
    let up: ts.Node | undefined = fn.parent
    while (up !== undefined && ts.isParenthesizedExpression(up)) {
      callee = up
      up = up.parent
    }
    if (up !== undefined && ts.isCallExpression(up) && up.expression === callee) return

    // In the component body: "reads a signal + stores into a const"
    const captured: { name: string; node: ts.VariableDeclaration }[] = []
    // In the component body: "props property + stored into a const" (deadly-sin §4 snapshot family, 2026-10-28):
    // vobs dynamic props are getter properties (recomputed on every read); `const st = props.state`
    // stored in a local variable is a run-once snapshot — using st directly in JSX always yields the initial value.
    const propsCaptured: { name: string; node: ts.VariableDeclaration }[] = []
    for (const statement of body.statements) {
      if (!ts.isVariableStatement(statement)) continue
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) continue
        if (containsSignalRead(declaration.initializer)) {
          captured.push({ name: declaration.name.text, node: declaration })
          continue
        }
        if (ts.isPropertyAccessExpression(declaration.initializer)
          && ts.isIdentifier(declaration.initializer.expression)
          && declaration.initializer.expression.text === 'props') {
          propsCaptured.push({ name: declaration.name.text, node: declaration })
        }
      }
    }

    if (captured.length === 0 && propsCaptured.length === 0) return

    // Whether these names are used inside JSX expressions; ones that are **called** (`{st()}`) are in getter form and do not count as snapshots
    const usedInJsx = new Set<string>()
    const calledInJsxBody = new Set<string>()
    const visit = (node: ts.Node): void => {
      if (ts.isJsxExpression(node) && node.expression !== undefined) {
        const scan = (child: ts.Node): void => {
          if (ts.isIdentifier(child)) usedInJsx.add(child.text)
          if (ts.isCallExpression(child) && ts.isIdentifier(child.expression)) calledInJsxBody.add(child.expression.text)
          ts.forEachChild(child, scan)
        }
        scan(node.expression)
      }
      ts.forEachChild(node, visit)
    }
    visit(body)

    for (const item of captured) {
      if (!usedInJsx.has(item.name)) continue
      found.push(diagnosticAt(source, file, item.node, {
        code: VOBS_C118,
        severity: 'warning',
        message: `A signal is read in the component body and stored into "${item.name}" — the component body runs only once, so this value never updates afterwards`,
        fix: `Put the read into a dynamic expression (use .value directly in JSX), or turn it into a memo-derived value: `
          + `const ${item.name} = memo(() => ...).`
      }))
    }

    for (const item of propsCaptured) {
      if (!usedInJsx.has(item.name) || calledInJsxBody.has(item.name)) continue
      found.push(diagnosticAt(source, file, item.node, {
        code: VOBS_C118,
        severity: 'warning',
        message: `A props property is stored into "${item.name}" in the component body — dynamic props are getters (recomputed on every read), `
          + `and storing one in a local variable is a run-once snapshot that keeps the initial value forever`,
        fix: `Switch to getter form and call it in JSX: const ${item.name} = () => props.<prop>, `
          + `used as {${item.name}()}; or write props.<prop> directly in JSX.`
      }))
    }
  }

  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) {
      inspectComponent(node)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)

  return found
}

/* --------------------------------- Rule D: array signal mutated in place (C233) */

/** In-place array mutators: these calls modify **the same reference**, so the signal never notifies subscribers. */
const ARRAY_MUTATORS = new Set([
  'push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin'
])

/**
 * Tell whether the name at a mutation point is **shadowed by a same-named local**.
 *
 * Walk up the parent chain; each function passed checks its **parameters** and **body declarations** (including nested —
 * the conservative direction: more exclusions = fewer reports. In real code, "an inner callback declares the same name while the mutation
 * point uses the outer signal" is extremely unlikely; under-reporting costs far less than false positives — see the C104 lesson).
 */
function shadowedByName(from: ts.Identifier, name: string): boolean {
  let parent: ts.Node | undefined = from.parent
  while (parent !== undefined && !ts.isSourceFile(parent)) {
    if (ts.isFunctionLike(parent)) {
      const fn = parent as ts.FunctionLikeDeclaration
      for (const parameter of fn.parameters) {
        if (ts.isIdentifier(parameter.name) && parameter.name.text === name) return true
      }
      const body = fn.body
      if (body !== undefined && ts.isBlock(body)) {
        let hit = false
        const scan = (child: ts.Node): void => {
          if (hit) return
          if (ts.isVariableDeclaration(child) && ts.isIdentifier(child.name) && child.name.text === name) {
            /*
             * **A declaration bound to state(...) is the signal itself, not shadowing** — otherwise the mutation
             * point would always be misjudged as same-name shadowing by "the signal's own declaration" and the rule would
             * never fire (the very first adversarial case exposed this bug). Only this kind is excluded: an inner **non-signal**
             * same-named declaration (`const list = { value: [] }`) is a real shadow.
             */
            let init: ts.Expression | undefined = child.initializer
            while (init !== undefined && (ts.isParenthesizedExpression(init) || ts.isAsExpression(init))) {
              init = init.expression
            }
            const isSignalBinding = init !== undefined && ts.isCallExpression(init)
              && ts.isIdentifier(init.expression) && init.expression.text === 'state'
            if (!isSignalBinding) hit = true
            return
          }
          ts.forEachChild(child, scan)
        }
        scan(body)
        if (hit) return true
      }
    }
    parent = parent.parent
  }
  return false
}

/**
 * In-place mutation of array signals (silent failure #1 once recorded in `silent-failures.md`; the diagnostic was added 2026-10-28).
 *
 * ```ts
 * const list = state([1])
 * list.value.push(2)   // reference unchanged → no notification → subscribers never update
 * ```
 *
 * ## Test (per silentNote's original demand: confirm the binding before speaking up)
 *
 * Only receivers whose **name is verifiably bound to `state(...)`** are reported — exactly the
 * **binding analysis** that was missing back then. A plain array's `.push()` is perfectly normal code; not one is reported.
 * Same-name shadowing (inner redeclarations/parameters) is excluded; `untrack` is no exception either
 * (reference swapping has nothing to do with subscriptions; in-place mutation never reaches subscribers).
 *
 * The direction is conservative: only direct `state` identifier calls count (custom store factories are not recognized = under-report, never false-positive),
 * and severity starts at warning — whether to upgrade to error awaits repo-wide measured false positives.
 */
/**
 * Whether a field assignment's receiver sits on the **`.value` chain** of a state-bound signal
 * (`X.value.name = …` / deep `X.value.a.b = …`) → returns that identifier `X`; otherwise null.
 */
function fieldMutationOwner(left: ts.Node, stateBindings: Set<string>): ts.Identifier | null {
  let current = left
  while (ts.isPropertyAccessExpression(current)) {
    const up = current.expression
    if (ts.isPropertyAccessExpression(up) && up.name.text === 'value'
      && ts.isIdentifier(up.expression) && stateBindings.has(up.expression.text)) {
      return up.expression
    }
    current = up
  }
  return null
}

function ruleSignalArrayMutation(source: ts.SourceFile, file: string): CheckDiagnostic[] {
  const found: CheckDiagnostic[] = []

  // Collect across the file the names "bound to state(...) calls" — the binding analysis silentNote spoke of
  const stateBindings = collectStateBindings(source)
  if (stateBindings.size === 0) return found

  const visit = (node: ts.Node): void => {
    // Shape 1: <name>.value.<mutator>(...) — three-level array mutation + call
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && ts.isPropertyAccessExpression(node.expression.expression)) {
      const mutator = node.expression.name
      const receiver = node.expression.expression
      if (ARRAY_MUTATORS.has(mutator.text) && receiver.name.text === 'value'
        && ts.isIdentifier(receiver.expression)) {
        const name = receiver.expression.text
        if (stateBindings.has(name) && !shadowedByName(receiver.expression, name)) {
          found.push(diagnosticAt(source, file, node, {
            code: VOBS_C233,
            severity: 'warning',
            message: `Array signal "${name}" is mutated in place via ${mutator.text}() — the reference is unchanged, `
              + `so the JSX subscribed to it never updates`,
            fix: `Array updates must swap the reference: push via ${name}.value = [...${name}.value, newItem]; `
              + `likewise copy before sort/truncate: ${name}.value = [...${name}.value].sort(...).`
          }))
        }
      }
    }
    // Shape 2 (the symmetric gap, 2026-10-28): <name>.value.<...field...> = newValue — in-place object field assignment.
    // Changing an inner field leaves the reference unchanged, so subscribers likewise never update — the same pit as array mutation, differently spelled.
    // Walk the property chain for an X.value prefix: one level (X.value.name) and deep (X.value.a.b) both count.
    if (ts.isBinaryExpression(node) && isWriteOperator(node.operatorToken.kind)
      && ts.isPropertyAccessExpression(node.left)) {
      const ownerIdentifier = fieldMutationOwner(node.left, stateBindings)
      if (ownerIdentifier !== null && !shadowedByName(ownerIdentifier, ownerIdentifier.text)) {
        const owner = ownerIdentifier.text
        found.push(diagnosticAt(source, file, node, {
          code: VOBS_C233,
          severity: 'warning',
          message: `An inner field of signal "${owner}" is mutated in place — the reference is unchanged, so the JSX subscribed to it never updates`,
          fix: `Object updates must swap the reference wholesale: ${owner}.value = { ...${owner}.value, field: newValue } `
            + `(deep fields are spread level by level along the path). In-place field/array mutation never triggers updates; only a changed reference does.`
        }))
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)

  return found
}

/* ------------------------------------ Rule E: state() without a debug name (C120) */

/**
 * state() without a debug name (the static forward-move of Finora's deadly sin §1-3, 2026-10-28).
 *
 * In C210/C211 runtime errors the signal shows up as **"(unnamed signal)"** — a signal without the second argument
 * cannot be located while debugging (several signals on the page all share that name). The runtime cannot warn before the error;
 * the static rule can say it right at the **creation site**.
 *
 * The fix text directly suggests **the same name as the variable** (`state(0, 'count')`) — the conventional form,
 * which AI and humans can copy verbatim. Spread arguments are skipped (the argument count is undecidable; under-report, never false-positive).
 */
function ruleUnnamedSignal(source: ts.SourceFile, file: string): CheckDiagnostic[] {
  const found: CheckDiagnostic[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'state'
      && node.arguments.length < 2
      && !node.arguments.some(item => ts.isSpreadElement(item))) {
      // Suggested name: const count = state(0) → suggest 'count'; other scenarios get a generic hint
      let suggested: string | undefined
      const parent = node.parent
      if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) suggested = parent.name.text
      found.push(diagnosticAt(source, file, node, {
        code: VOBS_C120,
        severity: 'warning',
        message: 'state() is called without a debug name — runtime diagnostics (e.g. C210 self-subscription) will show it as "(unnamed signal)", '
          + 'and with several signals on the page it is impossible to tell which one',
        fix: suggested !== undefined
          ? `Pass a debug name matching the variable as the second argument: state(<initial>, '${suggested}').`
          : `Pass a debug name as the second argument (usually matching the variable): state(<initial>, 'name').`
      }))
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

/**
 * Collect across the file the names "bound to `state(...)` calls" — the binding analysis shared by C233 / C234.
 */
function collectStateBindings(source: ts.SourceFile): Set<string> {
  const stateBindings = new Set<string>()
  const collectBindings = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined) {
      let init: ts.Expression = node.initializer
      while (ts.isParenthesizedExpression(init) || ts.isAsExpression(init)) init = init.expression
      if (ts.isCallExpression(init) && ts.isIdentifier(init.expression) && init.expression.text === 'state') {
        stateBindings.add(node.name.text)
      }
    }
    ts.forEachChild(node, collectBindings)
  }
  collectBindings(source)
  return stateBindings
}

/** Names of **plain-identifier signals** read inside a function body (`X.value` where X is an identifier and X ∈ stateBindings). */
function collectSignalReads(body: ts.Node, stateBindings: Set<string>): Set<string> {
  const reads = new Set<string>()
  const walk = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'value'
      && ts.isIdentifier(node.expression) && stateBindings.has(node.expression.text)) {
      reads.add(node.expression.text)
    }
    ts.forEachChild(node, walk)
  }
  walk(body)
  return reads
}

/**
 * The **implicit broken edge** in on callbacks (the inevitable way the "if it read it, it depends" assumption trips in the on context, 2026-10-28).
 *
 * ```ts
 * effect(on([a], () => {
 *   use(b.value)   // ⚠️ the on callback runs in an untrack scope — b establishes no subscription
 * }))              //    a change of b does not trigger this effect; the update is silently lost
 * ```
 *
 * ## Why a hint rather than an error
 *
 * Reading a non-deps signal inside an on callback has **two intents**:
 * (a) expecting it to trigger too → deps was omitted, a real bug (under-subscription);
 * (b) wanting only the latest value, refreshed by deps — a **legitimate pattern** (each re-run reads the fresh value).
 * Statics cannot tell the intents apart, hence severity = warning; the text spells out both so the author can self-identify.
 *
 * deps shapes: array → element identifiers; a single signal → the name itself; a **getter function** → the bound
 * signals read inside its body (whatever the function reads is what it subscribes to); anything else (spread etc.) → skipped (under-report, never false-positive).
 */
function ruleOnCallbackUntracked(source: ts.SourceFile, file: string): CheckDiagnostic[] {
  const found: CheckDiagnostic[] = []
  const stateBindings = collectStateBindings(source)
  if (stateBindings.size === 0) return found

  const depsSignalNames = (depsExpr: ts.Expression): Set<string> | null => {
    if (ts.isArrayLiteralExpression(depsExpr)) {
      return new Set(depsExpr.elements.filter(ts.isIdentifier).map(item => item.text))
    }
    if (ts.isIdentifier(depsExpr)) return new Set([depsExpr.text])
    if (ts.isArrowFunction(depsExpr) || ts.isFunctionExpression(depsExpr)) {
      const body = depsExpr.body
      return ts.isBlock(body) || ts.isExpression(body) ? collectSignalReads(body, stateBindings) : null
    }
    return null
  }

  const visit = (node: ts.Node): void => {
    // Shape: effect(on(deps, callback))
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'effect'
      && node.arguments.length > 0) {
      const arg0 = node.arguments[0]
      if (ts.isCallExpression(arg0) && ts.isIdentifier(arg0.expression) && arg0.expression.text === 'on'
        && arg0.arguments.length >= 2) {
        const depsSet = depsSignalNames(arg0.arguments[0])
        const callback = arg0.arguments[1]
        if (depsSet !== null && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))
          && callback.body !== undefined) {
          for (const name of collectSignalReads(callback.body, stateBindings)) {
            if (depsSet.has(name)) continue
            found.push(diagnosticAt(source, file, callback, {
              code: VOBS_C234,
              severity: 'warning',
              message: `The on callback runs in an untrack scope — it reads "${name}" here but that name is not in deps, `
                + `so no subscription is established: a change of ${name} will not trigger this effect`,
              fix: `Expect it to trigger too → add it to deps: on([…, ${name}], fn). `
                + `If you only want the latest value refreshed by deps (deliberately unsubscribed) → ignore this hint, `
                + `or express the intent explicitly with untrack(() => ${name}.value).`
            }))
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

/* -------------------------------------------------------------- Entry */

/**
 * Inline suppression: `// vobs-check-ignore-next-line`.
 *
 * These rules are all **heuristic**: they judge by name and shape that "this looks like a signal self-subscription / a list in a branch /
 * a signal read in the component body", and some perfectly legal code happens to look exactly like that. Without an escape hatch in the
 * checker, users would have to disable the whole rule (or be blocked by CI into making fake rewrites) — worse than under-reporting.
 *
 * Only "suppress the next line" is supported: the smallest possible scope, visible at a glance while reading, and no whole-file blanket exemption.
 * One such case actually occurred: `ListEntry.value` is a plain field, but written exactly like a signal self-subscription
 * (it was later renamed, but user code cannot count on that kind of luck).
 */
const IGNORE_NEXT_LINE = /vobs-check-ignore-next-line/u

/** Line numbers suppressed by inline comments (1-based; collects "the line after the comment"). */
function suppressedLines(text: string): Set<number> {
  const suppressed = new Set<number>()
  const lines = text.split(/\r?\n/u)
  for (let index = 0; index < lines.length; index++) {
    if (IGNORE_NEXT_LINE.test(lines[index])) suppressed.add(index + 2)
  }
  return suppressed
}

export function analyzeSource(text: string, file: string): CheckDiagnostic[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const suppressed = suppressedLines(text)
  return [
    ...ruleEffectSelfSubscription(source, file),
    ...ruleListInBranch(source, file),
    ...ruleSignalCapturedInBody(source, file),
    ...ruleSignalArrayMutation(source, file),
    ...ruleUnnamedSignal(source, file),
    ...ruleOnCallbackUntracked(source, file)
  ]
    .filter(item => !suppressed.has(item.line))
    .sort((a, b) => a.line - b.line || a.column - b.column)
}

/**
 * Run the compiler diagnostics and map them into `CheckDiagnostic`.
 *
 * `compileWithSourceMap` is wrapped in try/catch: a single file making the compiler throw must not abort the whole check run
 * (that is a failure of "the checking tool itself", not a problem in the source).
 */
