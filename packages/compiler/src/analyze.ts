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
import { VOBS_C210 as C210_CODE, vobsC210Fix } from '@vobs/runtime'
import { isKeyedListCall, routeShowList, unwrapExpr } from './show-route'

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
export const VOBS_C210 = C210_CODE
/** 列表写在分支位置 —— 失去 keyed 复用。 */
export const VOBS_C232 = 'VOBS_C232'
/** 在组件体里读信号并存进局部变量 —— 组件体只执行一次，之后永不更新。 */
export const VOBS_C118 = 'VOBS_C118'
/** 数组信号用 mutator 原地修改 —— 引用没变，订阅处不会更新。 */
export const VOBS_C233 = 'VOBS_C233'
/** state() 未传调试名 —— 运行时诊断显示 "(未命名信号)"，无法定位。 */
export const VOBS_C120 = 'VOBS_C120'
/** on 回调里读了 deps 之外的信号 —— untrack 作用域内读取不建立订阅。 */
export const VOBS_C234 = 'VOBS_C234'

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

/**
 * 在 effect **外层作用域**里被声明、且初始化式**明显不是信号**的名字。
 *
 * ## 为什么需要（实测的误报类）
 *
 * effect 体内的同名遮蔽早已处理；但**在组件体里声明的**同名局部仍会误报：
 *
 * ```ts
 * const count = state(0)          // 外层信号
 * function P() {
 *   const count = { value: 0 }    // ← 在**组件体**里声明（不在 effect 内）
 *   effect(() => { count.value = 1 })   // 这不是信号，却被当成自订阅
 * }
 * ```
 *
 * ## 判据：初始化式是不是**调用**
 *
 * 信号几乎总是调用产生的，所以：
 *
 * | 写法 | 判定 | 理由 |
 * |---|---|---|
 * | `const c = { value: 0 }` | **不是信号** → 跳过 | 对象字面量 |
 * | `const c = props.count` | **不是信号** → 跳过 | 属性访问 |
 * | `const c = state(0)` | 继续检查 | 调用 —— 但确实是信号，正确 |
 * | `const c = createStore()` | **继续检查** | 调用 —— **未知也保守保留**（自定义工厂） |
 * | 无初始化式 / 解构 | 继续检查 | 无法判断 |
 *
 * 最后两行是这个判据的关键：**只要可能是工厂产出就保留**，
 * 于是"从别处 import 的信号"（无本地声明）与"自定义 store 工厂"都不会被误杀。
 */
function collectNonSignalLocals(from: ts.Node): Set<string> {
  const nonSignal = new Set<string>()
  let node: ts.Node | undefined = from
  while (node !== undefined && !ts.isSourceFile(node)) {
    // `isFunctionLike` 也覆盖签名声明（没有 body），所以按可选属性取
    const fnBody = ts.isFunctionLike(node) ? (node as { body?: ts.ConciseBody }).body : undefined
    if (fnBody !== undefined && ts.isBlock(fnBody)) {
      const scan = (child: ts.Node): void => {
        // 不进入内层函数：内层有自己的作用域，由它自己那一轮处理
        if (ts.isFunctionLike(child)) return
        if (ts.isVariableDeclaration(child) && ts.isIdentifier(child.name)
          && child.initializer !== undefined) {
          let init: ts.Expression = child.initializer
          while (ts.isParenthesizedExpression(init) || ts.isAsExpression(init)
            || ts.isTypeAssertionExpression(init)) {
            init = init.expression
          }
          // 调用/构造 → 可能是信号工厂 → 交给后续判断，不在此排除
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
     * **作用域遮蔽集合**：effect 回调体内（含嵌套）**声明过的名字**。
     *
     * 为什么需要：这条规则按**信号变量名**比对读写集合，所以"同名局部对象"会被误报。
     * 实测的误报形态（对抗测试里 1/7）：
     *
     * ```ts
     * const count = state(0)              // 外层信号
     * effect(() => {
     *   const count = { value: 0 }        // ← 在 effect 体内**重新声明**
     *   count.value = count.value + 1     // 这不是信号，却被当成自订阅
     * })
     * ```
     *
     * 命名成"遮蔽"是准确的：内层声明覆盖了外层的信号名。既然名字在 effect 体内
     * 被**重新声明**，`X.value` 就不该再被当成外层那个信号。
     *
     * 只收名字、不判断类型 —— 但**方向是安全的**：命中就跳过（少报），
     * 而不是命中就报（多报）。少报的代价远低于误报（`C104` 的教训：
     * 18 处命中 16 处误报，代价是整个团队开始无视告警）。
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
    // 注意：`body` 是回调体；它内部所有声明都算遮蔽（嵌套函数内的也算 —— 保守方向）
    ts.forEachChild(body, collectDeclarations)
    // 形参也要算（`effect((x) => { x.value = 1 })` 里的 x 是形参，不是信号）
    if (ts.isFunctionLike(body.parent)) {
      for (const parameter of body.parent.parameters) {
        if (ts.isIdentifier(parameter.name)) shadowed.add(parameter.name.text)
      }
    }
    /*
     * **外层作用域**（组件体）里"明显不是信号"的局部名也要遮蔽 —— 见 collectNonSignalLocals。
     * 这里比体内那圈**更精确**（只排除非调用初始化式），因为外层同名局部很常见
     * （`const count = props.count` 这类），一刀切会漏掉大量真自订阅。
     */
    for (const name of collectNonSignalLocals(body)) shadowed.add(name)

    const visit = (node: ts.Node, insideUntrack: boolean): void => {
      // 嵌套函数有自己的订阅语义，不算在本次 effect 的读写里
      if (node !== body && ts.isFunctionLike(node)) return

      // untrack(...) 里的写入不建立订阅 → 正是正确写法
      const nextUntracked = insideUntrack
        || (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'untrack')

      if (ts.isBinaryExpression(node) && isWriteOperator(node.operatorToken.kind)) {
        const name = signalNameOf(node.left)
        if (name !== undefined && !nextUntracked && !shadowed.has(name)) writes.set(name, node)
      } else if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node))
        && (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken)) {
        // `count.value++` 同时是读和写 —— 这正是自订阅的经典形态
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
        /*
         * **error**：真自订阅值得让 CI 失败；已知误报形态（同名遮蔽）已由上面的
         * 作用域解析消除。
         *
         * 说明：这条的判定仍是**按变量名**比对，不是"真的订阅了"。真正的硬门禁
         * 仍由运行时护栏提供（按真实依赖集判定，跨函数/跨模块精确）。
         */
        code: VOBS_C210,
        severity: 'error',
        message: `effect 写入了它自己依赖的信号 "${name}" —— 这次写入会把它重新调度，形成自订阅循环`,
        // 文案与运行时护栏**共用同一份**（@vobs/runtime 的 diagnostic-text）——
        // 此前两处各写一份，1.8.5 改进运行时那份时这里没同步，用户在 vite 里看到旧建议。
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

/* -------------------------------------- 规则 B：列表写在分支位置（C232） */

function ruleListInBranch(source: ts.SourceFile, file: string): CheckDiagnostic[] {
  const found: CheckDiagnostic[] = []
  const message = 'list 写在三元/&& 的分支里 —— 会走多态插入，失去 keyed 复用；'
    + '而且**分支条件本身变化也会重建整个列表**'
  const fix = '把 list 提成**直接的**子表达式：先写条件分支，再单独写 {items.map(...)}。'
    + '三元里同时有节点与 list 时，list 那一支不会编译成 insertList。'
    + '（实测产物对比：分支里是 insertDynamicValue(el, null, () => cond.value ? items.map(…) : null)，'
    + '直接子表达式是 insertList(el, null, () => items, renderItem) —— 前者每次重跑都新建全部节点，'
    + '且 cond 变化同样触发重建（那个 getter 读了它）；后者按 key 复用/移动，只订阅列表源。）'
    + '影响大小取决于**条目数与是否有状态**：几项无状态按钮可忽略；'
    + '几十项、或条目内有焦点/输入/滚动状态时必须改。'
    + '（2026-10-28 起，`cond ? list : null` / `cond && list` 这类简单形态已由编译器'
    + '自动路由 insertShow —— 条件容器内 keyed 复用，本规则不再对它们报警；'
    + '仍报警的是节点与 list 混排等编译器无法安全改写的形态。）'

  /*
   * 与编译器 appendChildren 严格同构：C232 只对「会走 insertDynamicValue 的列表」有意义。
   * - JsxExpression 顶层：routeShowList 命中 = 已被编译器路由 insertShow（整棵子树被吸收，
   *   条件部分编译为 getter、list 分支走容器内 insertList）—— 跳过，不报也不深入。
   * - 未路由：检查顶层三元/&& 分支里的 keyed map（unwrap 后），并深入子树
   *   （嵌套形态的内层仍会走多态插入，照报）。
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

/**
 * 取一个函数**自己的绑定名**（用于判断它是不是"被当组件调用"）。
 *
 * 覆盖 `const render = () => {…}`、`function render() {…}`、`const o = { render() {…} }`；
 * 匿名函数（回调、IIFE）返回 `undefined`。
 */
function ownNameOf(fn: ts.FunctionLikeDeclaration): string | undefined {
  if (fn.name !== undefined && ts.isIdentifier(fn.name)) return fn.name.text
  const parent = fn.parent
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text
  if (ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name)) return parent.name.text
  return undefined
}

/**
 * 在 **JSX 表达式里被调用**的标识符集合（`{render()}` 这种）。
 *
 * ## 为什么要单独收集
 *
 * C118 的前提是"这个函数体只执行一次"。而 `{render()}` 里的 `render` **每次求值都会重跑** ——
 * 它体里的 `const shown = n.value` 每轮都是新鲜的，代码完全正确。
 *
 * 但 `returnsJsx(render)` 会把这种渲染 helper 认成"组件" → 误报（实测残留）。
 *
 * ## 为什么只收"调用"而不收"引用"
 *
 * 只认 callee，是为了**保住真阳性**：
 * - `{render()}` → 是调用 → helper → 跳过 ✓
 * - `component={P}` / `<RouterView component={P}/>` → 只是引用，未调用 → **仍然检查 P** ✓
 * - `<P/>` → JSX 标签，本来就不在 JsxExpression 里 → 仍然检查 ✓
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
     * **被 JSX 表达式调用的函数是 helper，不是组件。**
     *
     * ```tsx
     * const render = () => { const shown = n.value + 1; return <b>{shown}</b> }
     * return <div>{render()}</div>      // ← 每次求值都重跑 → shown 是新鲜的
     * ```
     *
     * 它与 `export const Page = () => {…}`（真组件）形态完全一样，
     * 但**调用位置**把二者分开了：编译器不会在 JSX 里"手动调用"组件。
     */
    const ownName = ownNameOf(fn)
    if (ownName !== undefined && calledInJsx.has(ownName)) return

    const body = fn.body
    if (body === undefined || !ts.isBlock(body) || !returnsJsx(fn)) return

    /*
     * **立即执行的函数不是组件**（实测出来的误报，来自真实项目 Labelune）。
     *
     * ```tsx
     * {qExpanded.value === job.id ? (
     *   <div>
     *     {(() => {                          // ← IIFE，在 JSX **子节点位置**
     *       const failedShown = ...signal.value...
     *       return (<>...</>)
     *     })()}
     *   </div>
     * ) : null}
     * ```
     *
     * JSX 子节点位置的表达式是**动态的** —— 这个 IIFE 每次依赖变化都会重跑，
     * 所以它体里的 `const x = signal.value` **不是** run-once 快照，代码是对的。
     *
     * 但 `returnsJsx(fn)` 会把它认成"组件"，于是报 C118 —— **误报**。
     * （这条规则此前只在组件体是直接语句时被验证过，IIFE 形态是盲区。）
     */
    /*
     * **要注意括号**：`(() => {...})()` 里那个 arrow 的**父节点是
     * `ParenthesizedExpression`，不是 `CallExpression`** —— 只查一层 `parent` 拦不住。
     */
    let callee: ts.Node = fn
    let up: ts.Node | undefined = fn.parent
    while (up !== undefined && ts.isParenthesizedExpression(up)) {
      callee = up
      up = up.parent
    }
    if (up !== undefined && ts.isCallExpression(up) && up.expression === callee) return

    // 组件体里「读信号 + 存进 const」
    const captured: { name: string; node: ts.VariableDeclaration }[] = []
    // 组件体里「props 属性 + 存进 const」（死穴 §4 快照族，2026-10-28）：
    // vobs 的动态 props 是 getter 属性（每次读取重算），`const st = props.state`
    // 存进局部变量即 run-once 快照——JSX 里直接用 st 永远是初值。
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

    // 这些名字是否在 JSX 表达式里被用到；被**调用**的（`{st()}`）是 getter 形态，不算快照
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
        message: `组件体里读了信号并存进 "${item.name}" —— 组件体只执行一次，这个值之后永远不会更新`,
        fix: `把读取放进动态表达式（直接在 JSX 里用 .value），或改成 memo 派生值：`
          + `const ${item.name} = memo(() => ...)。`
      }))
    }

    for (const item of propsCaptured) {
      if (!usedInJsx.has(item.name) || calledInJsxBody.has(item.name)) continue
      found.push(diagnosticAt(source, file, item.node, {
        code: VOBS_C118,
        severity: 'warning',
        message: `组件体里把 props 属性存进了 "${item.name}" —— 动态 props 是 getter（每次读取重算），`
          + `存进局部变量即 run-once 快照，之后永远是初始值`,
        fix: `改成 getter 形态并在 JSX 里调用：const ${item.name} = () => props.<属性>，`
          + `用法 {${item.name}()}；或直接在 JSX 里写 props.<属性>。`
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

/* --------------------------------- 规则 D：数组信号原地修改（C233） */

/** 数组原地变异方法：这些调用改的是**同一个引用**，信号不会通知订阅方。 */
const ARRAY_MUTATORS = new Set([
  'push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin'
])

/**
 * 判断变异点处的名字是否被**同名局部遮蔽**。
 *
 * 沿 parent 链向上，途经的每个函数检查它的**参数**与**体内声明**（含嵌套 ——
 * 保守方向：多排除 = 少报。真实场景里「内层回调声明了同名而变异点在外层直接
 * 使用信号」的概率极低，少报的代价远低于误报，见 C104 的教训）。
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
             * **绑定到 state(...) 的声明就是信号本身，不算遮蔽** —— 否则变异点
             * 永远会被「信号自己的声明」误判成同名遮蔽、规则一次都报不出来
             * （第一个对抗用例就暴露了这个 bug）。只排除这一种：内层**非信号**
             * 的同名声明（`const list = { value: [] }`）才是真遮蔽。
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
 * 数组信号的原地变异（`silent-failures.md` 曾记录的第 1 条静默，2026-10-28 补上诊断）。
 *
 * ```ts
 * const list = state([1])
 * list.value.push(2)   // 引用没变 → 信号不通知 → 订阅处永不更新
 * ```
 *
 * ## 判据（按 silentNote 当时的要求：先确认绑定，再开口）
 *
 * 只对「**名字确实绑定到 `state(...)`**」的接收者报警 —— 这就是当年缺的
 * **绑定分析**。普通数组的 `.push()` 是完全正常的代码，一个都不报。
 * 同名遮蔽（内层重声明/形参）排除；`untrack` 内也不例外
 * （换不换引用与订阅无关，原地变异永远到不了订阅方）。
 *
 * 方向是保守的：只认 `state` 标识符直调（自定义 store 工厂不认 = 漏报不误报），
 * severity 先给 warning —— 等全仓实测误报后再决定是否升 error。
 */
/**
 * 字段赋值的接收者是否落在某 state 绑定信号的 **`.value` 链**上
 * （`X.value.name = …` / 深层 `X.value.a.b = …`）→ 返回那个标识符 `X`；否则 null。
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

  // 全文件收集「绑定到 state(...) 调用」的名字 —— 这就是 silentNote 里说的绑定分析
  const stateBindings = collectStateBindings(source)
  if (stateBindings.size === 0) return found

  const visit = (node: ts.Node): void => {
    // 形态一：<name>.value.<mutator>(...) —— 三层数组变异 + 调用
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
            message: `数组信号 "${name}" 用 ${mutator.text}() 原地修改 —— 引用没变，`
              + `订阅它的 JSX 永远不会更新`,
            fix: `数组更新必须换引用：push 用 ${name}.value = [...${name}.value, 新项]；`
              + `排序/截断同理先拷贝再改：${name}.value = [...${name}.value].sort(...)。`
          }))
        }
      }
    }
    // 形态二（对称缺口，2026-10-28）：<name>.value.<...字段...> = 新值 —— 对象字段原地赋值。
    // 改内部字段引用没变，订阅处同样不会更新 —— 与数组变异是同一个坑的两种写法。
    // 沿属性链找 X.value 前缀：一层（X.value.name）与深层（X.value.a.b）都算。
    if (ts.isBinaryExpression(node) && isWriteOperator(node.operatorToken.kind)
      && ts.isPropertyAccessExpression(node.left)) {
      const ownerIdentifier = fieldMutationOwner(node.left, stateBindings)
      if (ownerIdentifier !== null && !shadowedByName(ownerIdentifier, ownerIdentifier.text)) {
        const owner = ownerIdentifier.text
        found.push(diagnosticAt(source, file, node, {
          code: VOBS_C233,
          severity: 'warning',
          message: `信号 "${owner}" 的内部字段被原地修改 —— 引用没变，订阅它的 JSX 永远不会更新`,
          fix: `对象更新必须整体换引用：${owner}.value = { ...${owner}.value, 字段: 新值 }`
            + `（深层字段沿路径逐层展开）。改字段/数组原地变异都不触发更新，引用变了才触发。`
        }))
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)

  return found
}

/* ------------------------------------ 规则 E：state() 未传调试名（C120） */

/**
 * state() 未传调试名（Finora 死穴 §1-3 的静态前移，2026-10-28）。
 *
 * C210/C211 的运行时报错里信号显示为 **"(未命名信号)"** —— 没传第二参的信号
 * 在排查时无法定位（页面上多个信号都叫这个）。运行时无法在报错前提醒；
 * 静态规则在**创建处**就能说清楚。
 *
 * fix 文案直接给出**与变量同名**的建议（`state(0, 'count')`）—— 约定俗成的写法，
 * AI 与人都能照抄。spread 参数跳过（无法确定参数个数，少报不误报）。
 */
function ruleUnnamedSignal(source: ts.SourceFile, file: string): CheckDiagnostic[] {
  const found: CheckDiagnostic[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'state'
      && node.arguments.length < 2
      && !node.arguments.some(item => ts.isSpreadElement(item))) {
      // 建议名：const count = state(0) → 建议 'count'；其它场景给通用提示
      let suggested: string | undefined
      const parent = node.parent
      if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) suggested = parent.name.text
      found.push(diagnosticAt(source, file, node, {
        code: VOBS_C120,
        severity: 'warning',
        message: 'state() 没传调试名 —— 运行时诊断（如 C210 自订阅）会把它显示为 "(未命名信号)"，'
          + '页面上有多个信号时无法定位是哪一个',
        fix: suggested !== undefined
          ? `给第二个参数传与变量同名的调试名：state(<初值>, '${suggested}')。`
          : `给第二个参数传一个调试名（通常与变量同名）：state(<初值>, '名字')。`
      }))
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

/**
 * 全文件收集「绑定到 `state(...)` 调用」的名字 —— C233 / C234 共用的绑定分析。
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

/** 函数体内读到的**纯标识符信号**名（`X.value` 且 X 是标识符、X ∈ stateBindings）。 */
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
 * on 回调里的**隐式断边**（AI「以为读了就依赖」在 on 语境下的必然踩法，2026-10-28）。
 *
 * ```ts
 * effect(on([a], () => {
 *   use(b.value)   // ⚠️ on 的回调跑在 untrack 作用域里 —— b 不会建立订阅
 * }))              //    b 变化不触发本 effect，更新静默丢失
 * ```
 *
 * ## 为什么是提示而不是错误
 *
 * on 回调里读非 deps 信号有**两种意图**：
 * (a) 期望它也触发 → 漏写 deps，是真 bug（欠订阅）；
 * (b) 只要最新值、由 deps 触发刷新 —— **合法模式**（每次重跑读到新值）。
 * 静态分不出意图，所以 severity = warning，文案把两种意图都说清楚让作者自认。
 *
 * deps 形态：数组 → 元素标识符；单信号 → 名字本身；**取值函数** → 函数体内
 * 读到的绑定信号（函数读什么订阅什么）；其余（spread 等）→ 跳过（少报不误报）。
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
    // 形态：effect(on(deps, callback))
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
              message: `on 的回调跑在 untrack 作用域里 —— 这里读了 "${name}" 但它不在 deps 里，`
                + `不会建立订阅：${name} 变化不会触发本 effect`,
              fix: `期望它也触发 → 加进 deps：on([…, ${name}], fn)。`
                + `若只要最新值、由 deps 触发刷新（刻意不订阅）→ 可忽略本提示，`
                + `或用 untrack(() => ${name}.value) 显式表达意图。`
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
    ...ruleSignalCapturedInBody(source, file),
    ...ruleSignalArrayMutation(source, file),
    ...ruleUnnamedSignal(source, file),
    ...ruleOnCallbackUntracked(source, file)
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
