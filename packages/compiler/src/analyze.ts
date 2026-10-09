/**
 * vobs 源码的**静态分析规则**（不跑应用就能给出的问题清单）。
 *
 * ## 为什么放在 `@vobs/compiler` 而不是 CLI
 *
 * 这些规则此前在 `@vobs/cli` 的 `check.ts` 里，于是**只有 `vobs check` 能看到它们** ——
 * `vite dev` / `vite build` 里 `C118` / `C232` / `C210`（静态规则）**一条都不报**。
 * 后果：开发时看不到，只有人主动跑 `vobs check` 或 CI 才发现。
 * 这与「错了不能静默」直接冲突：**AI 改完代码、`vite build` 通过，但问题还在。**
 *
 * 而 `@vobs/vite-plugin` 需要这些规则，却**不能依赖 CLI**（依赖方向反了 —— CLI 是应用侧
 * 工具）。所以抽到双方都已经依赖的 `@vobs/compiler`。
 *
 * 顺序也对称了：编译器诊断（`C104`–`C108`）与分析器诊断（`C118`/`C210`/`C232`）现在同在
 * `@vobs/compiler`，`vobs check` 与 `vite build` 都能拿到全部规则。
 *
 * **本文件是从 `packages/cli/src/commands/check.ts` 原样搬过来的**，行为不变：
 * 搬迁的验收标准就是 `vobs check` 对全仓的输出与搬迁前**逐字节一致**。
 */
import ts from 'typescript'

export interface CheckDiagnostic {
  /** 稳定错误码，AI 与文档按它检索。 */
  readonly code: string
  readonly severity: 'error' | 'warning'
  readonly message: string
  /** 该怎么改。只报错对 AI 没有价值。 */
  readonly fix: string
  /** 相对目标目录的路径。 */
  readonly file: string
  readonly line: number
  readonly column: number
  /** 出错那一行的原文，方便直接定位。 */
  readonly snippet: string
}

/** effect 写入了自己依赖的信号。 */
export const VOBS_C210 = 'VOBS_C210'
/** 列表写在分支位置 —— 失去 keyed 复用。 */
export const VOBS_C232 = 'VOBS_C232'
/** 在组件体里读信号并存进局部变量 —— 组件体只执行一次，之后永不更新。 */
export const VOBS_C118 = 'VOBS_C118'

function returnsJsx(node: ts.Node): boolean {
  let seen = false
  const visit = (child: ts.Node): void => {
    if (seen) return
    if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child) || ts.isJsxFragment(child)) {
      seen = true
      return
    }
    // 不进入嵌套函数：内层组件返回 JSX 不代表外层是组件
    if (child !== node && (ts.isFunctionLike(child))) return
    ts.forEachChild(child, visit)
  }
  ts.forEachChild(node, visit)
  return seen
}

/**
 * `X.value` 形式的内存读取，返回接收者的文本（`count`、`props.name` 都算）。
 *
 * 用文本而不是标识符：信号经常是别人传进来的（`props.name.value`），
 * 只认裸标识符会把这些全漏掉。
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

/* ------------------------------------------------- 规则 A：effect 自订阅 */

function ruleEffectSelfSubscription(source: ts.SourceFile, file: string): CheckDiagnostic[] {
  const found: CheckDiagnostic[] = []

  const inspectEffectBody = (body: ts.Node): void => {
    const reads = new Map<string, ts.Node>()
    const writes = new Map<string, ts.Node>()

    const visit = (node: ts.Node, insideUntrack: boolean): void => {
      // 嵌套函数有自己的订阅语义，不算在本次 effect 的读写里
      if (node !== body && ts.isFunctionLike(node)) return

      // untrack(...) 里的写入不建立订阅 → 正是正确写法
      const nextUntracked = insideUntrack
        || (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'untrack')

      if (ts.isBinaryExpression(node) && isWriteOperator(node.operatorToken.kind)) {
        const name = signalNameOf(node.left)
        if (name !== undefined && !nextUntracked) writes.set(name, node)
      } else if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node))
        && (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken)) {
        // `count.value++` 同时是读和写 —— 这正是自订阅的经典形态
        const name = signalNameOf(node.operand)
        if (name !== undefined) {
          if (!nextUntracked) writes.set(name, node)
          reads.set(name, node)
        }
      } else if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
        && node.expression.name.text === 'set') {
        if (!nextUntracked) writes.set(node.expression.expression.getText(), node)
      } else {
        const name = signalNameOf(node)
        if (name !== undefined) {
          const parent = node.parent
          // 只有赋值类运算符的左侧才不是「读」；`count.value < 1` 的左侧仍然是读
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
        code: VOBS_C210,
        severity: 'error',
        message: `effect 写入了它自己依赖的信号 "${name}" —— 这次写入会把它重新调度，形成自订阅循环`,
        fix: `把这次写入包进 untrack：untrack(() => { ${name}.value = next })；`
          + '如果这个 effect 本来就只该做副作用，检查是不是误读了不该读的信号。'
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

/* -------------------------------------- 规则 B：列表写在分支位置（C232） */

function isKeyedListCall(node: ts.Node): boolean {
  if (!ts.isCallExpression(node)) return false
  if (!ts.isPropertyAccessExpression(node.expression) || node.expression.name.text !== 'map') return false
  const callback = node.arguments[0]
  return callback !== undefined && ts.isFunctionLike(callback) && returnsJsx(callback)
}

function ruleListInBranch(source: ts.SourceFile, file: string): CheckDiagnostic[] {
  const found: CheckDiagnostic[] = []
  const message = 'list 写在三元/&& 的分支里 —— 会走多态插入，失去 keyed 复用'
  const fix = '把 list 提成**直接的**子表达式：先写条件分支，再单独写 {items.map(...)}。'
    + '三元里同时有节点与 list 时，list 那一支不会编译成 insertList。'

  const visit = (node: ts.Node): void => {
    if (ts.isConditionalExpression(node)) {
      for (const branch of [node.whenTrue, node.whenFalse]) {
        if (isKeyedListCall(branch)) {
          found.push(diagnosticAt(source, file, branch, { code: VOBS_C232, severity: 'warning', message, fix }))
        }
      }
    } else if (ts.isBinaryExpression(node)
      && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
      && isKeyedListCall(node.right)) {
      found.push(diagnosticAt(source, file, node.right, { code: VOBS_C232, severity: 'warning', message, fix }))
    }
    ts.forEachChild(node, visit)
  }
  visit(source)

  return found
}

/* --------------------------------- 规则 C：组件体里读信号存局部变量（C118） */

function containsSignalRead(node: ts.Node): boolean {
  let seen = false
  const visit = (child: ts.Node): void => {
    if (seen) return
    // 函数体内的读取是**延迟**的（事件处理器、定时器、回调），不算「组件体里读信号」。
    // 这条必须放在最前面：`const handler = () => { signal.value }` 里的读取完全正常。
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

function ruleSignalCapturedInBody(source: ts.SourceFile, file: string): CheckDiagnostic[] {
  const found: CheckDiagnostic[] = []

  const inspectComponent = (fn: ts.FunctionLikeDeclaration): void => {
    const body = fn.body
    if (body === undefined || !ts.isBlock(body) || !returnsJsx(fn)) return

    // 组件体里「读信号 + 存进 const」
    const captured: { name: string; node: ts.VariableDeclaration }[] = []
    for (const statement of body.statements) {
      if (!ts.isVariableStatement(statement)) continue
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) continue
        if (containsSignalRead(declaration.initializer)) {
          captured.push({ name: declaration.name.text, node: declaration })
        }
      }
    }
    if (captured.length === 0) return

    // 这些名字是否在 JSX 表达式里被用到
    const usedInJsx = new Set<string>()
    const visit = (node: ts.Node): void => {
      if (ts.isJsxExpression(node) && node.expression !== undefined) {
        const scan = (child: ts.Node): void => {
          if (ts.isIdentifier(child)) usedInJsx.add(child.text)
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
        message: `组件体里读了信号并存进 "${item.name}" —— 组件体只执行一次，这个值之后永远不会更新`,
        fix: `把读取放进动态表达式（直接在 JSX 里用 .value），或改成 memo 派生值：`
          + `const ${item.name} = memo(() => ...)。`
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

/* -------------------------------------------------------------- 入口 */

/**
 * 行内抑制：`// vobs-check-ignore-next-line`。
 *
 * 这三条规则都是**启发式**的：它们靠名字与形状判断「这看起来像信号自订阅 / 像写在分支里的列表 /
 * 像在组件体里读信号」，而有些合法代码恰好长成那样。检查器没有逃生口的话，用户只能关掉整条
 * 规则（或者被 CI 挡住去做假的改写）—— 那比漏报更糟。
 *
 * 只支持「抑制下一行」：作用范围最小、读代码时一眼看得见，也没有整文件豁免那种一刀切。
 * 实测就撞到过一例：`ListEntry.value` 是普通字段，但写法与信号自订阅完全相同
 * （后来给它改了名，但用户代码里不会有这种运气）。
 */
const IGNORE_NEXT_LINE = /vobs-check-ignore-next-line/u

/** 被行内注释抑制的行号集合（1-based，收集的是「注释的下一行」）。 */
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
    ...ruleSignalCapturedInBody(source, file)
  ]
    .filter(item => !suppressed.has(item.line))
    .sort((a, b) => a.line - b.line || a.column - b.column)
}

/**
 * 跑编译器诊断并映射成 `CheckDiagnostic`。
 *
 * `compileWithSourceMap` 用 try/catch 包住：单个文件让编译器抛错不该中断整轮检查
 * （那是"检查工具本身"的失败，不是源码的问题）。
 */
