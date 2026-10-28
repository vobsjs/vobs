import ts from 'typescript'
import { VobsError } from '@vobs/runtime/error'
import { domAttributeName, isPropertyName } from '@vobs/runtime/dom-props'
import { isSvgTag } from '@vobs/runtime/svg'
import { resolveEventNameForDiagnostics } from './dom-events'
import { routeShowList } from './show-route'
import type {
  CompilerContext,
  CompilerOptions,
  CompilerPlugin,
  CompileOptions,
  CompileResult,
  CompilerDiagnostic,
  VobsCompiler
} from './plugin'

/**
 * All mutable state for a single compilation.
 *
 * Every `compile` call creates an **independent instance** passed explicitly (no module-level variables) —
 * nested calls (e.g. a plugin compiling a snippet) and concurrent calls never pollute each other; the compiler is fully reentrant.
 */
interface CompileState {
  /** Counter for temporary identifiers (_el0, _el1, ...). */
  generatedId: number
  filename: string
  /** The initially parsed source file. Fallback for line/column lookups when nodes transformed by a plugin program pass cannot be traced back to their original positions. */
  sourceFile: ts.SourceFile
  /** Generated statement → original source position, used for source map generation. */
  statementSources: WeakMap<ts.Statement, SourcePosition>
  /** Binding names declared anywhere in the source (including nested scopes): avoids name collisions when injecting runtime imports and generating temporary variables. */
  takenNames: Set<string>
  /** Canonical runtime helper name → reference name in the output (identical to the canonical name when there is no conflict). */
  helperAliases: Map<string, string>
  /** Static template declarations: HTML → module-level template variables, deduplicated by content, emitted after imports. */
  templates: Map<string, ts.Identifier>
  /** Whether to emit source locations for component calls (pass false in production builds to strip them and shrink the bundle). */
  sourceLocation: boolean
  /** `state` aliases imported from @vobs/reactivity / @vobs/vobs (including `as` aliases), used for automatic debugName inference. */
  stateAliases: ReadonlySet<string>
  /** Locally declared (non-import) binding names: disables debugName inference when `state` is shadowed by a local declaration. */
  localBindings: ReadonlySet<string>
  /** Diagnostics produced by the compiler itself (e.g. unsupported JSX shapes), merged with the TypeScript parse diagnostics in the result. */
  diagnostics: CompilerDiagnostic[]
  /** HMR module id: when provided, module-top-level state() declarations are wrapped in hmrStateRef so signals survive hot updates. */
  hmrModuleId: string | null
  /** Whether to hoist fully static DOM subtrees into HTML templates (createTemplate depends on document; must be off for SSR/Node builds). */
  hoistTemplates: boolean
  /**
   * Whether the DOM subtree currently being compiled sits inside the SVG namespace (>0 means yes).
   *
   * Tag names only identify "SVG-exclusive tags" (svg/g/rect..., handled by SVG_TAGS at runtime), but
   * a / title / style / script share their names with HTML — inside `<svg>` they must be SVG elements.
   * Judging by name alone would build `<svg><a href="…">` as an HTML anchor (a known issue the CHANGELOG admits to).
   * The compiler knows the ancestor chain, so it explicitly tells the runtime which namespace to use.
   * `<foreignObject>` switches its subtree back to HTML, hence a "depth" rather than a boolean.
   */
  svgDepth: number
}

interface SourcePosition {
  readonly line: number
  readonly column: number
}

export function createCompiler(options: CompilerOptions = {}): VobsCompiler {
  const basePlugins = options.plugins ?? []

  return {
    compile(code: string, overrides: CompileOptions = {}): string {
      return compile(code, {
        ...overrides,
        plugins: [...basePlugins, ...(overrides.plugins ?? [])]
      })
    },
    compileWithSourceMap(code: string, overrides: CompileOptions = {}): CompileResult {
      return compileWithSourceMap(code, {
        ...overrides,
        plugins: [...basePlugins, ...(overrides.plugins ?? [])]
      })
    }
  }
}

/**
 * Combine "all errors from the same compilation" into one message.
 *
 * Previously compile() and the Vite plugin both took only the first error (`find`), so with 5 errors in a file,
 * a developer had to build 5 times, fixing one error per build, to see the whole picture — one diagnostic at a time is the most time-wasting shape.
 * The primary error keeps its location / codeFrame; the rest are appended as a list.
 */
export function describeDiagnostics(diagnostics: readonly CompilerDiagnostic[]): {
  readonly primary: CompilerDiagnostic
  readonly message: string
} | null {
  const errors = diagnostics.filter(item => item.severity === 'error')
  if (errors.length === 0) return null
  const [primary] = errors
  if (errors.length === 1) return { primary, message: primary.message }

  const rest = errors.slice(1).map(item => {
    const where = `${item.location.file}:${item.location.line}:${item.location.column}`
    return `  ${item.code}  ${where}  ${item.message}`
  })
  return {
    primary,
    message: `${primary.message}\n\n${errors.length - 1} more error(s) in the same file:\n${rest.join('\n')}`
  }
}

export function compile(code: string, options: CompileOptions = {}): string {
  const result = compileWithSourceMap(code, options)
  const summary = describeDiagnostics(result.diagnostics)
  if (summary) {
    throw new VobsError({
      code: summary.primary.code,
      layer: 'compiler',
      message: summary.message,
      location: summary.primary.location,
      codeFrame: summary.primary.codeFrame,
      fix: summary.primary.fix
    })
  }
  return result.code
}

export function compileWithSourceMap(code: string, options: CompileOptions = {}): CompileResult {
  const filename = options.filename ?? 'component.tsx'
  let sourceFile = ts.createSourceFile(
    filename,
    code,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  )
  const state: CompileState = {
    generatedId: 0,
    filename,
    sourceFile,
    statementSources: new WeakMap(),
    takenNames: collectDeclaredNames(sourceFile),
    helperAliases: new Map(),
    templates: new Map(),
    sourceLocation: options.sourceLocation ?? true,
    stateAliases: collectStateAliases(sourceFile),
    localBindings: collectLocallyDeclaredNames(sourceFile),
    diagnostics: [],
    hmrModuleId: options.hmrModuleId ?? null,
    hoistTemplates: options.hoistTemplates ?? true,
    svgDepth: 0
  }
  const cleanFilename = filename.split(/[?#]/u, 1)[0] || filename
  const diagnostics = ts.transpileModule(code, {
    // Vite appends query strings (for example `?direct`) to module IDs;
    // strip them so TypeScript still recognizes TSX syntax for diagnostics.
    fileName: cleanFilename,
    reportDiagnostics: true,
    compilerOptions: { jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.Latest }
  }).diagnostics?.map(diagnostic => toCompilerDiagnostic(diagnostic, sourceFile, cleanFilename)) ?? []
  const plugins = options.plugins ?? []
  validatePlugins(plugins)

  const context: CompilerContext = {
    filename,
    factory: ts.factory,
    addRuntimeImport(name: string): void {
      resolveHelperName(state, name)
    },
    helperRef: (name: string) => helperRef(state, name)
  }

  for (const plugin of plugins) plugin.analyze?.(sourceFile, context)
  for (const plugin of plugins) {
    sourceFile = plugin.transform?.program?.(sourceFile, context) ?? sourceFile
  }
  for (const plugin of plugins) sourceFile = transformPluginNodes(sourceFile, plugin, context)

  // Diagnostics for top-level conditional returns must run **before** the transform: afterwards the JSX has been
  // rewritten into factory calls, and the original shapes of ternaries and null branches are no longer recognizable.
  reportTopLevelConditionalReturn(state)
  reportModuleTopLevelJsx(state)
  reportAsyncEffectCallback(state)
  reportFrozenReactiveReturn(state)
  reportEagerJsxInVariable(state)

  const statements = sourceFile.statements.map(statement =>
    ts.isImportDeclaration(statement) ? rebuildImport(state, statement) : transformStatement(state, statement, true)
  )
  // Residual JSX (early returns / nested branches missed by the main transform) must be rewritten before the
  // runtime import and template declarations: the fallback pass registers new helper aliases (e.g.
  // insertDynamicValue) and _tpl declarations; building the import after that would emit references to undefined identifiers (runtime ReferenceError).
  sourceFile = transformResidualJsx(state, ts.factory.updateSourceFile(sourceFile, statements))
  // Template declarations must be generated before the runtime import: createTemplate inside the declarations
  // relies on helperRef registering aliases, so the import is built only once all aliases exist.
  const templateDeclarations = createTemplateDeclarations(state)
  const resultFile = ts.factory.updateSourceFile(sourceFile, [
    ...createRuntimeImports(state),
    ...templateDeclarations,
    ...sourceFile.statements
  ])

  const generated = ts.createPrinter().printFile(resultFile)
  return {
    code: generated,
    map: buildSourceMap(state, filename, code, generated, resultFile),
    diagnostics: [...diagnostics, ...state.diagnostics]
  }
}

/**
 * `VOBS_C104`: a **bare conditional `return`** at the top level of a component.
 *
 * The shape is `return cond ? <JSX/> : null` (or `cond && <JSX/>`) written directly in the function body,
 * instead of placing the condition at a JSX child position.
 *
 * Why it must be reported: components are **run-once** — the function body executes once and `cond` is pinned
 * at mount time. Later signal changes never re-run this `return`, so the UI **never switches**.
 * This is completely different from `{cond ? <A/> : <B/>}` inside JSX (the latter gets a compiler-generated
 * conditional factory and is reactive), yet the two look nearly identical and are very hard to tell apart by eye.
 *
 * A costlier incident (Labelune 2026-09-30 release black screen): the `null` branch of `return cond ? <JSX/> : null`
 * was once used as a WeakMap key in `nodeOwners`, throwing
 * `Invalid value used as weak map key` — the app crashed on mount with no crash log.
 * The runtime has been fixed (empty values are normalized into an empty comment node), but the **semantics are still wrong** —
 * the component never switches — so this rule says it at compile time.
 */
function reportTopLevelConditionalReturn(state: CompileState): void {
  const sourceFile = state.sourceFile
  if (!sourceFile) return

  const isEmptyBranch = (node: ts.Expression | undefined): boolean =>
    node !== undefined
    && (node.kind === ts.SyntaxKind.NullKeyword
      || (ts.isIdentifier(node) && node.text === 'undefined')
      || node.kind === ts.SyntaxKind.FalseKeyword)

  /** Whether the value itself is "empty" (`null` / `undefined` / `false`). */
  const describeEmpty = (node: ts.Expression): string =>
    node.kind === ts.SyntaxKind.NullKeyword ? 'null'
      : node.kind === ts.SyntaxKind.FalseKeyword ? 'false'
        : 'undefined'

  /**
   * Whether this expression is a **render node** (JSX element / component / fragment).
   *
   * ⚠️ This test **must be narrowed to render nodes** — without checking that the return value is a node, a pure
   * data function's `return cond && value` / `return x ? x : null` would all be reported as a "top-level conditional
   * return in a component". Field feedback: **about 16 of 18 hits were pure data functions**
   * (`T | null` is normal null modeling), and this rule used to be an **error** — blocking builds outright.
   *
   * The argument only holds when "the return value will be rendered": component run-once means that return never re-evaluates;
   * a pure data function runs on every call, where conditional returns are perfectly fine.
   *
   * The test only accepts **JSX syntax**, not call shapes like `createElement(...)`: guessing whether a call produces a
   * node inevitably introduces new false positives, and "missing one createElement shape" costs far less than
   * "false-positiving a swath of data functions". Static rules are only reliable for **positional** problems; this one is inherently heuristic —
   * hence it was also downgraded from error to warning (same treatment as C105).
   */
  const isRenderNode = (node: ts.Expression | undefined): boolean =>
    node !== undefined
    && (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node))

  const report = (target: ts.Node, hasEmpty: string | null): void => {
    const { line, column, codeFrame } = buildCodeFrame(sourceFile, target.getStart(sourceFile), target.getWidth(sourceFile))
    state.diagnostics.push({
      code: 'VOBS_C104',
      severity: 'warning',
      message: hasEmpty === null
        ? 'This conditional return returns a render node, and the function body runs only once: the component is run-once, '
          + 'so later signal changes never re-run this return and the UI never switches.'
        : `This conditional return returns a render node, and it returns ${hasEmpty} here — `
          + 'the function body runs only once: the component is run-once, later signal changes never re-run this return, and the UI never switches.',
      location: { file: state.filename, line, column },
      codeFrame,
      /*
       * The fix text deliberately does **not** recommend hand-rolled utility classes: `cond ? 'is-on' : 'is-off'` needs a **global**
       * `.is-off` utility class, while projects usually only have compound selectors — following it verbatim yields
       * "the class is applied but the styles never take effect". `Show` and `classList` need no pre-existing utility classes.
       */
      fix: 'Use `<RouterView/>` for route branches (declarative route switching); '
        + 'to keep the subtree mounted and only toggle visibility, use `<Show when={cond}><A/></Show>`; '
        + "to toggle only a class name, use `<A classList={{ 'is-off': !cond }} />` (it only contributes its own part and depends on no pre-existing utility class); "
        + 'for other conditional rendering, put the condition at a JSX child position (`<div>{cond ? <A/> : <B/>}</div>`; the compiler generates a reactive conditional factory). '
        + '**Hoisting the ternary to the component top-level return does not work** — there is no parent/anchor there; both branches being JSX still freezes.'
    })
  }

  /** Find returns **directly owned by the function** inside its body (does not descend into nested functions/arrow functions). */
  const scanReturn = (node: ts.Node, owner: ts.SignatureDeclaration): void => {
    if (node !== owner && (ts.isFunctionLike(node) || ts.isClassLike(node))) return
    if (ts.isReturnStatement(node) && node.expression) {
      const expression = node.expression
      // Case 1: `return cond ? <A/> : null`
      if (ts.isConditionalExpression(expression)) {
        const emptyWhenTrue = isEmptyBranch(expression.whenTrue)
        const emptyWhenFalse = isEmptyBranch(expression.whenFalse)
        // Narrowing: at least one branch must be a render node, otherwise it is a pure data function (`T | null` modeling)
        const rendersANode = isRenderNode(expression.whenTrue) || isRenderNode(expression.whenFalse)
        if ((emptyWhenTrue || emptyWhenFalse) && rendersANode) {
          report(expression, describeEmpty(emptyWhenTrue ? expression.whenTrue : expression.whenFalse))
        }
        return
      }
      // Case 2: `return cond && <A/>` — **only reported when the right side is a render node**
      // (1.8.0 reported unconditionally, so every `return a && b` in pure data functions false-positived)
      if (ts.isBinaryExpression(expression)
        && expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
        if (isRenderNode(expression.right)) report(expression, 'false')
      }
    }
    ts.forEachChild(node, child => { scanReturn(child, owner) })
  }

  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) {
      if (node.body) scanReturn(node.body, node)
    }
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(sourceFile, visit)
}

/**
 * `VOBS_C105`: JSX at the **module top level**.
 *
 * The shape: `const MENU = <KitMenuItem />` written at module top level (outside any function body).
 *
 * Why it must be reported: module-top-level expressions execute during **import evaluation**, which is **before**
 * `createVobs()` installs the renderer. So the `createElement` inside the JSX hits "renderer not initialized" — and
 * the error occurs at **runtime**, while some seemingly unrelated module is being imported, with a stack trace far away
 * from the real cause ("this constant is written in the wrong place"), making it very expensive to diagnose.
 * Item F of the external pitfall docs is exactly this one (Labelune's KitLayout menu array).
 */
/**
 * `VOBS_C106`: handing an **async function** to effect / lifecycle hooks.
 *
 * ## Why this is a trap (real project, pitfall 3, 2026-10-02)
 *
 * Code in an async function **before the first await** runs **synchronously**, so calling it inside an effect's
 * tracking scope = the effect itself **personally** reads those signals. The most typical hit surface is "guard read + state-machine write":
 *
 * ```ts
 * effect(async () => {
 *   if (!entSync.value.syncing) return     // ← read, so the effect subscribes to ent.sync
 *   entSync.set({ syncing: true })          // ← writes a signal it depends on → infinite re-run
 * })
 * ```
 *
 * The other side: `effect` does **not await** the returned Promise — code after it in that async function runs
 * **outside** the effect's tracking scope (at an uncertain time too), so contracts like a "cleanup function" also break down.
 *
 * ## Only **direct** async callbacks are detected (an intentional boundary)
 *
 * The shape `effect(async () => …)` is visible from **pure syntax** (the callback node carries the async modifier):
 * zero cost, zero false positives — the same approach as Svelte 5's handling of `await` inside `$effect`.
 *
 * **Indirect shapes cannot be detected**: in `effect(() => { void someAsyncFn() })`, `someAsyncFn`'s
 * async-ness lives in **another module**, invisible to a pure AST. Detecting it would require `ts.Program` +
 * `TypeChecker` — but Vite's transform is **per-file**, so that would break the current architecture and slow builds down considerably.
 * Such shapes are left to the **runtime guardrails** (VOBS_C210 / C211) — they locate the problem precisely, a rare capability among peers.
 *
 * ## Fixes
 *
 * - Only want to declare dependencies → `effect(on(deps, () => { void fn() }))` (`on` keeps reads inside the callback from subscribing)
 * - Only want a one-shot side effect → put the logic in `onMount`; use `@vobs/resource` for async data fetching
 * - Really need to keep this shape → `untrack(() => { void fn() })`
 */
/**
 * `VOBS_C107`: a **`return` in the component body reads a signal** (run-once freezing).
 *
 * ## Why it exists (real project, pitfall 4, 2026-10-02)
 *
 * The component body runs once, so any **signal-reading `return`** in the body is evaluated exactly once at mount;
 * later signal changes **never** re-branch. Three shapes break **identically** (confirmed against real compile output):
 *
 * ```ts
 * // (1) Root-level ternary, both branches JSX
 * return cond.value ? <A/> : <B/>        // → cond.value evaluated once, a concrete node returned
 * // (2) Early-return if
 * if (cond.value) return <A/>; return <B/>   // → likewise evaluated only once
 * // (3) Root-level ternary with a null/false side (C104 also reports this)
 * return cond.value ? <A/> : null
 * ```
 *
 * None of the three compile outputs contain `insertDynamic` / `createBlock` — because there is **no parent/anchor at
 * the component's top-level `return`**, and reactive conditional rendering needs a slot where content can be swapped. The return value **is** the node itself.
 *
 * ## Division of labor with C104
 *
 * C104 only recognizes the **subset** "ternary + empty branch" (its argument is "returns an empty value"; its test is empty literals).
 * So it **tolerates** (1) and (2), which are just as frozen at runtime — exactly pitfall 4's shape.
 * C104 stays (the empty-branch shape carries extra null semantics); this rule covers the wider class of real hazards.
 *
 * ## Key point: **only reads outside JSX** are reported
 *
 * These two look alike with opposite outcomes:
 *
 * ```ts
 * return cond.value ? <A/> : <B/>              // ❌ read at the return-expression level → frozen
 * return <div>{cond.value ? <A/> : <B/>}</div> // ✅ read at a JSX child position → reactive
 * ```
 *
 * Child positions get a compiler-generated conditional factory (`insertDynamic`) — **the correct form**.
 * So the test is "a `.value` read inside the return expression, **and not inside any JSX subtree**" —
 * the walk stops at JSX; reads there are safe.
 *
 * ## Same trade-off as C104
 *
 * Still a **warning** (statics cannot tell "is this function a component"), and still only accepts **JSX syntax**
 * (call shapes like `createElement(...)` are not guessed). What actually breaks is backstopped by the runtime guardrails.
 */
/**
 * `VOBS_C108`: **JSX stored in a variable** (the node is created eagerly).
 *
 * ## Why it is a trap (real project crash scenario)
 *
 * ```ts
 * const node = <ElementVarPicker el={pickerElement.value} />   // ← component body, eager creation
 * return open.value ? node : null                              // ← condition comes after creation
 * ```
 *
 * **The component is instantiated by `createComponent` and its body runs at the very moment of variable assignment** —
 * at that point `pickerElement.value` may already be `null`, so the component crashes reading `.content`.
 *
 * Key distinction: **prop expressions are not hoisted by the compiler**. The standard shape
 * `<div>{open.value ? <Picker el={picker.value}/> : null}</div>` compiles to safe output
 * (`createComponent` sits inside the condition; the prop is a getter). The real difference is
 * **the JSX was written outside the condition**.
 *
 * ## It also covers two "discipline-only" forbidden zones from the user docs
 *
 * These two have **no diagnostic at all** — textbook silent failures:
 * compilation passes, types pass, occasional runtime crashes.
 *
 * 1. "run-once derived node in the component body" — the body runs once and that node identity is frozen
 * 2. "JSX stored in data constants" — `<Picker el={picker.value} />`, `const items = [{icon: <X/>}]`
 *    end up in SSG serialization (the output contains `[object Xxx]`)
 *
 * Especially lethal for LLMs: in React, `const node = <X/>; return cond ? node : null` is **perfectly legal**,
 * so this is one of the shapes models most easily produce.
 *
 * ## Test and boundary
 *
 * Only variable declarations **inside function bodies** whose initializer contains JSX are reported; **the walk stops at functions** —
 * because the following is the **recommended form** and must not be reported:
 *
 * ```ts
 * const render = () => <Picker el={picker.value} />   // ✅ lazy evaluation, not reported
 * ```
 *
 * Module top level is not its business (that is `VOBS_C105`'s territory, avoiding two diagnostics for one spot).
 *
 * ## Severity: warning
 *
 * `const icon = <I/>` used once actually **works** (the node is inserted once) — it is "works but fragile";
 * the `?:` shape above is the real crash. Hence not an error — **the lesson from the C104 episode: false positives destroy trust,
 * and once trust is gone, every later warning gets ignored.**
 */
function reportEagerJsxInVariable(state: CompileState): void {
  const sourceFile = state.sourceFile
  if (!sourceFile) return

  const report = (target: ts.Node): void => {
    const { line, column, codeFrame } = buildCodeFrame(sourceFile, target.getStart(sourceFile), target.getWidth(sourceFile))
    state.diagnostics.push({
      code: 'VOBS_C108',
      severity: 'warning',
      message: 'The JSX is stored in a variable, so this node is created **on this very line** — '
        + 'any later conditionals or reuse happen after creation. The component is run-once, '
        + 'so the node identity is frozen; if the state read at this point is still empty (e.g. `el` is null), '
        + 'the component renders with the empty value and crashes.',
      location: { file: state.filename, line, column },
      codeFrame,
      /*
       * The fix must be **branched by usage site** — the first version only said "write it at the usage site", and
       * testing showed that **only holds for JSX child positions**:
       *
       *   Used at a JSX child position → output has insertDynamic, genuinely reactive, zero diagnostics ✅
       *   Used at the component top-level return → output has **no** insertDynamic, still frozen,
       *                        and it hits both C104 + C107 ❌
       *
       * The top-level return has no parent/anchor, so the condition is not compiled into anything reactive —
       * there one should use Show / RouterView, not a ternary. Following the first version's advice turns "crashes at runtime"
       * into "the UI never switches", which is **more insidious**.
       */
      fix: '(1) If it is used at a **JSX child position**: write the JSX directly there — '
        + '`<div>{open.value ? <Picker el={picker.value}/> : null}</div>` '
        + '(the compiler generates a reactive conditional factory; when the condition is false the component is never created). '
        + '(2) If it is used at the **component top-level `return`**: **do not turn it into a ternary** — there is no parent/anchor there, '
        + 'and both branches being JSX still freezes (it would hit C107). Use `<Show when={open.value}>` instead, '
        + 'or `<RouterView/>` for route scenarios. '
        + '(3) To reuse, use a **function that returns the node**: '
        + '`const renderPicker = () => <Picker el={picker.value}/>` (lazy evaluation; this rule does not report it). '
        + '(4) **Do not store JSX in data constants either** (nodes inside arrays/objects end up in SSG serialization). '
        + '(5) **When the component has internal state worth keeping** (input content, scroll position, canvas state): '
        + 'keep it permanently mounted, pass the state object in, and **null-check inside the component** — this neither crashes nor destroys and recreates '
        + 'the subtree on condition flips ((1) fixes the crash, but every flip rebuilds the subtree, '
        + 'trading "crash" for "lost state" — another documented pitfall). The cost is a null check inside the component.'
    })
  }

  /**
   * Whether the initializer contains **eagerly created** JSX.
   *
   * **The walk stops at function bodies** — `() => <X/>` is lazy evaluation, the recommended alternative.
   */
  const hasEagerJsx = (root: ts.Node): boolean => {
    let found = false
    const walk = (node: ts.Node): void => {
      if (found) return
      if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
        found = true
        return
      }
      // JSX inside a function body is not eager
      if (ts.isFunctionLike(node)) return
      ts.forEachChild(node, walk)
    }
    walk(root)
    return found
  }

  /** Only counts as "inside a function body" when `inFunction` is true — module top level is left to C105. */
  const walk = (node: ts.Node, inFunction: boolean): void => {
    if (inFunction && ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (declaration.initializer && hasEagerJsx(declaration.initializer)) report(declaration.initializer)
      }
    }
    // Once inside a function, all of its statements count as "inside a function body"
    const nextInFunction = inFunction || ts.isFunctionLike(node)
    ts.forEachChild(node, child => { walk(child, nextInFunction) })
  }
  walk(sourceFile, false)
}

function reportFrozenReactiveReturn(state: CompileState): void {
  const sourceFile = state.sourceFile
  if (!sourceFile) return

  const report = (target: ts.Node, emptyGuard: boolean): void => {
    const { line, column, codeFrame } = buildCodeFrame(sourceFile, target.getStart(sourceFile), target.getWidth(sourceFile))
    state.diagnostics.push({
      code: 'VOBS_C107',
      severity: 'warning',
      message: emptyGuard
        ? 'This **empty-value guard** (`if (signal) return null`) is frozen inside the component body — the function body runs only once, '
          + 'so even after the signal recovers post-mount it never re-branches: the UI stays on whichever branch it took first (blank, or the first content). '
          + 'The top-level return has no parent/anchor; any branch returned from here is evaluated only once.'
        : 'This reads a signal in the **component body** and returns a node based on it. The component body runs only once, '
        + 'so this branch is frozen at mount and later signal changes never switch it — legal at compile time, frozen at runtime.',
      location: { file: state.filename, line, column },
      codeFrame,
      fix: emptyGuard
        ? 'Move the guard down into a JSX child position: `return <div>{loading.value ? null : content}</div>`; '
          + 'to keep the subtree mounted and only toggle visibility, use `<Show when={!loading.value} fallback={null}><Content/></Show>`. '
          + 'The component top-level return has no parent/anchor — an early return (null or JSX alike) is evaluated only once.'
        : 'Use `<RouterView/>` for route branches (it uses insertDynamic + resetKey internally, handled declaratively); '
          + 'for other conditional rendering put the condition at a JSX child position (`<div>{cond ? <A/> : <B/>}</div>`), '
          + 'or use `<Show when={cond}>` to keep the subtree mounted and only toggle visibility. '
          + '**Note: hoisting the ternary to the component top-level return does not work** — there is no parent/anchor there, '
          + 'and both branches being JSX still freezes.'
    })
  }

  /** Whether this subtree reads `.value` (or `['value']`) outside JSX; **the walk stops at JSX**. */
  const readsReactiveValueOutsideJsx = (root: ts.Node): boolean => {
    let found = false
    const walk = (node: ts.Node): void => {
      if (found) return
      // Stop at JSX: reads at child/attribute positions get compiler-generated conditional factories and are safe
      if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) return
      if (ts.isPropertyAccessExpression(node) && node.name.text === 'value') { found = true; return }
      if (ts.isElementAccessExpression(node)
        && node.argumentExpression
        && ts.isStringLiteral(node.argumentExpression)
        && node.argumentExpression.text === 'value') { found = true; return }
      ts.forEachChild(node, walk)
    }
    walk(root)
    return found
  }

  /** Whether the expression **contains JSX** (a signal that produces nodes; same test as C104). */
  const containsJsx = (root: ts.Node): boolean => {
    let found = false
    const walk = (node: ts.Node): void => {
      if (found) return
      if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) { found = true; return }
      ts.forEachChild(node, walk)
    }
    walk(root)
    return found
  }

  /** Whether some branch of the `if` contains `return <JSX/>` (direct children only; does not descend into nested functions). */
  const branchReturnsNode = (statement: ts.Node): boolean => {
    let found = false
    const walk = (node: ts.Node): void => {
      if (found) return
      if (node !== statement && (ts.isFunctionLike(node) || ts.isClassLike(node))) return
      if (ts.isReturnStatement(node) && node.expression && containsJsx(node.expression)) { found = true; return }
      ts.forEachChild(node, walk)
    }
    walk(statement)
    return found
  }

  /** Whether a branch contains an **empty-guard return** (`return null` / `undefined` / `false` / bare `return`; does not descend into nested functions). */
  const branchReturnsEmpty = (statement: ts.Node): boolean => {
    let found = false
    const walk = (node: ts.Node): void => {
      if (found) return
      if (node !== statement && (ts.isFunctionLike(node) || ts.isClassLike(node))) return
      if (ts.isReturnStatement(node)) {
        const expression = node.expression
        const isEmpty = expression === undefined
          || expression.kind === ts.SyntaxKind.NullKeyword
          || (ts.isIdentifier(expression) && expression.text === 'undefined')
          || expression.kind === ts.SyntaxKind.FalseKeyword
        if (isEmpty) { found = true; return }
      }
      ts.forEachChild(node, walk)
    }
    walk(statement)
    return found
  }

  /**
   * From the `if`, walk up to the nearest function host: does its body contain a **JSX-returning return**.
   *
   * This is the **function-level narrowing** of the empty-guard test: `if (signal) return null` inside a pure data
   * function is just ordinary null modeling (`T | null`); without rendering there is no freezing — only "the function
   * also has a JSX return elsewhere" (i.e. it really is a render function) can freeze a component on an empty branch. This
   * narrowing eliminates the largest false-positive class entirely (empty guards in data functions); the remaining surface is isomorphic to Case 2 (cross-file render helpers).
   */
  const hostFunctionHasJsxReturn = (from: ts.Node): boolean => {
    let current: ts.Node = from
    while (current.parent !== undefined && !ts.isSourceFile(current)) {
      if (ts.isFunctionLike(current)) {
        const body = (current as ts.FunctionLikeDeclaration).body
        if (body === undefined) return false
        let found = false
        const walk = (node: ts.Node): void => {
          if (found) return
          if (node !== body && (ts.isFunctionLike(node) || ts.isClassLike(node))) return
          if (ts.isReturnStatement(node) && node.expression && containsJsx(node.expression)) { found = true; return }
          ts.forEachChild(node, walk)
        }
        walk(body)
        return found
      }
      current = current.parent
    }
    return false
  }

  const visit = (node: ts.Node): void => {
    // Case 1: `return <a signal-reading expression>`
    if (ts.isReturnStatement(node) && node.expression) {
      const expression = node.expression
      if (containsJsx(expression) && readsReactiveValueOutsideJsx(expression)) {
        if (!isJsxOnlyCaller(node)) report(expression, false)
      }
    }
    // Case 2: `if (<signal read>) return <JSX/>` — the read sits on the if's test, not in the return expression
    // Case 3 (2026-10-28, the last silent failure absorbed from silent-failures): `if (<signal read>) return null`
    //   — return null has no JSX, so Case 2 cannot catch it. Narrowing: only report when the host function body
    //   also has a JSX return (a render function); empty guards in pure data functions are not reported; the exemption reuses isJsxOnlyCaller.
    if (ts.isIfStatement(node) && readsReactiveValueOutsideJsx(node.expression)) {
      const returnsNode = branchReturnsNode(node.thenStatement)
        || (node.elseStatement !== undefined && branchReturnsNode(node.elseStatement))
      const returnsEmpty = branchReturnsEmpty(node.thenStatement)
        || (node.elseStatement !== undefined && branchReturnsEmpty(node.elseStatement))
      if ((returnsNode || returnsEmpty) && (returnsNode || hostFunctionHasJsxReturn(node))) {
        if (!isJsxOnlyCaller(node)) report(node, !returnsNode && returnsEmpty)
      }
    }
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(sourceFile, visit)

  /**
   * Exemption check: if the flagged branch is wrapped in a **named function** and every call site of that name
   * in the whole file sits **entirely** inside JSX subtrees (evaluation happens in JSX's reactive scope and re-runs with the signals), do not report.
   *
   * Motivation (real project, 2026-10-12): the accounts page's subscription section `groupCards()` — defined in the component body as
   * `const groupCards = () => { if (planGroup.value) return <GroupA/>; … }`,
   * with its only call site at a JSX child position `{groupCards()}`. Branch evaluation happens inside the reactive scope and
   * re-runs normally on tab switches — not frozen, yet it hit this rule (the compiler only matches within the function and cannot see call sites).
   *
   * Conservative boundary (prefer false positives over misses — a miss = a frozen bug shipping silently):
   * - Anonymous functions (inline callbacks, mid-chain states) have no name → report anyway
   * - **No call site found anywhere in the file** (the component itself, passed around as a value, used cross-file) → report anyway
   * - **Any single** call site in a non-JSX context (a synchronous call in a component body, an effect callback,
   *   a call inside a nested function within JSX — those run during events, not during JSX evaluation) → report anyway
   * - Same-named functions defined in multiple places are not scope-distinguished: collected by file-level name, so any one
   *   dangerous call makes all same-named functions report (safe direction: can only "over-report", never "miss")
   */
  function isJsxOnlyCaller(node: ts.Node): boolean {
    // The declaration name of the nearest function host: `const x = () => {}` / `function x() {}` / class method
    let current: ts.Node = node
    let name: string | null = null
    while (current.parent !== undefined && current !== sourceFile) {
      if (ts.isFunctionLike(current)) {
        if (ts.isFunctionDeclaration(current) && current.name !== undefined && ts.isIdentifier(current.name)) {
          name = current.name.text
        } else if ((ts.isArrowFunction(current) || ts.isFunctionExpression(current))
          && ts.isVariableDeclaration(current.parent)
          && current.parent.initializer === current
          && ts.isIdentifier(current.parent.name)) {
          name = current.parent.name.text
        } else if (ts.isMethodDeclaration(current) && ts.isIdentifier(current.name)) {
          name = current.name.text
        }
        break
      }
      current = current.parent
    }
    if (name === null) return false

    // Collect call sites of that name across the file and classify them. Call-site context = the first boundary
    // encountered walking up from the call: a JSX node (attributes/children evaluate inside bound effects / getters) → safe; a function/class boundary → anything else
    let sawCall = false
    let dangerous = false
    const isJsxKind = (n: ts.Node): boolean =>
      ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n)
        || ts.isJsxExpression(n) || ts.isJsxAttribute(n) || ts.isJsxSpreadAttribute(n)
        || ts.isJsxAttributes(n) || ts.isJsxClosingElement(n) || ts.isJsxOpeningElement(n)
    const walkCalls = (n: ts.Node): void => {
      if (dangerous) return
      if (ts.isCallExpression(n)) {
        const callee = n.expression
        const matches = (ts.isIdentifier(callee) && callee.text === name)
          || (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.name) && callee.name.text === name)
        if (matches) {
          sawCall = true
          // Walk up from the call site to the first boundary: JSX first → evaluation in a reactive scope; function/class first → synchronous call
          let up: ts.Node = n
          while (up.parent !== undefined && up !== sourceFile) {
            if (isJsxKind(up.parent)) break
            if (ts.isFunctionLike(up.parent) || ts.isClassLike(up.parent)) { dangerous = true; break }
            up = up.parent
          }
          if (dangerous) return
        }
      }
      ts.forEachChild(n, walkCalls)
    }
    walkCalls(sourceFile)
    return sawCall && !dangerous
  }
}

function reportAsyncEffectCallback(state: CompileState): void {
  const sourceFile = state.sourceFile
  if (!sourceFile) return

  /** The first argument of these APIs is a callback that "runs synchronously inside the tracking scope". */
  const TRACKED_CALLBACK_APIS = new Set(['effect', 'renderEffect', 'memo', 'on', 'onMount'])

  const report = (target: ts.Node): void => {
    const { line, column, codeFrame } = buildCodeFrame(sourceFile, target.getStart(sourceFile), target.getWidth(sourceFile))
    state.diagnostics.push({
      code: 'VOBS_C106',
      severity: 'warning',
      message: 'This callback is async, yet it runs **synchronously inside the tracking scope up to the first await** — '
        + 'guard reads and state-machine writes before that point all count as dependencies of this effect, easily causing self-subscription and infinite re-runs. '
        + 'Moreover the effect never awaits the returned Promise, so later code and cleanup contracts misalign.',
      location: { file: state.filename, line, column },
      codeFrame,
      fix: 'To only declare dependencies, use effect(on(deps, () => { void fn() })); '
        + 'for a one-shot side effect use onMount, and @vobs/resource for async data fetching; '
        + 'if you really must keep this shape, wrap it explicitly in untrack(() => { void fn() }).'
    })
  }

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      if (TRACKED_CALLBACK_APIS.has(node.expression.text)) {
        const first = node.arguments[0]
        if (first && (ts.isArrowFunction(first) || ts.isFunctionExpression(first))) {
          // Only async callbacks written directly in the argument position; indirect calls are invisible (see the comment above)
          if (first.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword)) report(first)
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(sourceFile, visit)
}

function reportModuleTopLevelJsx(state: CompileState): void {
  const sourceFile = state.sourceFile
  if (!sourceFile) return

  const report = (node: ts.Node): void => {
    const { line, column, codeFrame } = buildCodeFrame(sourceFile, node.getStart(sourceFile), node.getWidth(sourceFile))
    state.diagnostics.push({
      code: 'VOBS_C105',
      severity: 'warning',
      message: 'JSX at the module top level executes during import evaluation, before createVobs() installs the renderer, '
        + 'so the runtime reports "renderer not initialized" — and the stack points at the importing site, far from the real cause.',
      location: { file: state.filename, line, column },
      codeFrame,
      fix: 'Move this JSX into a component body; for constants that need "data + nodes", switch to a function that returns nodes '
        + '(`const menu = () => [<Item/>]`), or evaluate via a getter at render time.'
    })
  }

  /** Find JSX inside subtrees that "execute immediately at top-level evaluation"; stop at functions/classes (those are lazy). */
  const scan = (node: ts.Node): void => {
    if (ts.isFunctionLike(node) || ts.isClassLike(node)) return
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
      report(node)
      return
    }
    ts.forEachChild(node, scan)
  }

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) || ts.isImportEqualsDeclaration(statement)) continue
    scan(statement)
  }
}

function toCompilerDiagnostic(
  diagnostic: ts.Diagnostic,
  sourceFile: ts.SourceFile,
  filename: string
): CompilerDiagnostic {
  const start = diagnostic.start ?? 0
  const length = diagnostic.length ?? 1
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
  const { line, column, codeFrame } = buildCodeFrame(sourceFile, start, length)
  return {
    code: `VOBS_C${String(diagnostic.code).padStart(3, '0')}`,
    severity: diagnostic.category === ts.DiagnosticCategory.Warning ? 'warning' : 'error',
    message,
    location: { file: filename, line, column },
    codeFrame
  }
}

/** Tab expansion width: only to align the ^ in codeFrames; the source itself is never modified. */
const CODE_FRAME_TAB_WIDTH = 4

/**
 * The caret must be positioned by **display width**, not character count.
 *
 * Tabs in `lineText` occupy several columns in a terminal, while the old code padded by character count with `' '.repeat(character)`:
 * for tab-indented code (very common in repositories) the `^` would land several columns too far right, ruining the single
 * most important thing in a diagnostic: the position. Expanding tabs and counting in step fixes it.
 */
function displayWidthOf(text: string, end: number): number {
  let width = 0
  const limit = Math.min(end, text.length)
  for (let index = 0; index < limit; index += 1) {
    width += text[index] === '\t' ? CODE_FRAME_TAB_WIDTH : 1
  }
  return width
}

function buildCodeFrame(
  sourceFile: ts.SourceFile,
  start: number,
  length: number
): { line: number; column: number; codeFrame: string } {
  const position = sourceFile.getLineAndCharacterOfPosition(start)
  const rawLine = sourceFile.text.split(/\r?\n/u)[position.line] ?? ''
  const lineText = rawLine.replace(/\t/gu, ' '.repeat(CODE_FRAME_TAB_WIDTH))
  const gutter = String(position.line + 1).length + 3
  const caretStart = displayWidthOf(rawLine, position.character)
  const caretLength = Math.max(
    1,
    Math.min(
      displayWidthOf(rawLine, position.character + length) - caretStart,
      Math.max(1, lineText.length - caretStart)
    )
  )
  return {
    line: position.line + 1,
    column: position.character + 1,
    codeFrame: `${position.line + 1} | ${lineText}\n${' '.repeat(gutter + caretStart)}${'^'.repeat(caretLength)}`
  }
}

/**
 * Unsupported JSX tag shapes (member expressions `<Foo.Bar>`, namespaces `<svg:rect>`, etc.).
 * The diagnostic is returned with error severity, so compile() and the Vite plugin fail outright instead of silently emitting invalid DOM tags.
 */
function reportUnsupportedTag(state: CompileState, tagName: ts.JsxTagNameExpression): void {
  const sourceFile = tagName.getSourceFile() ?? state.sourceFile
  if (!sourceFile) return
  const label = tagName.getText()
  const kindNote = tagName.kind === ts.SyntaxKind.JsxNamespacedName ? ' (a JSX namespaced tag)' : ''
  const { line, column, codeFrame } = buildCodeFrame(sourceFile, tagName.getStart(sourceFile), tagName.getWidth(sourceFile))
  state.diagnostics.push({
    code: 'VOBS_C101',
    severity: 'error',
    message: `Unsupported JSX tag shape: <${label}>${kindNote}. Components must be identifiers starting with an uppercase letter; DOM elements must use lowercase tag names.`,
    location: { file: state.filename, line, column },
    codeFrame,
    fix: `Change <${label}> to a component in the <Component /> form or a lowercase DOM tag; use <Fragment> or <>...</> for fragments.`
  })
}

/**
 * Diagnostics for `on*` attribute names.
 *
 * error is only reported when the name **cannot possibly be right**; working names and custom events only get warnings —
 * the goal is not to block anyone but to surface "bound to a nonexistent event, the callback never fires, and nothing ever says a word".
 */
function reportEventName(state: CompileState, attribute: ts.JsxAttribute, name: string): void {
  const resolved = resolveEventNameForDiagnostics(name)
  if (resolved === undefined) return
  const sourceFile = attribute.getSourceFile() ?? state.sourceFile
  if (!sourceFile) return

  const { eventName, camelCase, known } = resolved
  let severity: CompilerDiagnostic['severity']
  let message: string
  let fix: string

  if (!camelCase && !known) {
    // once → "ce": neither matches the camelCase convention nor any known event — the attribute name is definitely wrong
    severity = 'error'
    message = `"${name}" is treated as an event handler bound to the event name "${eventName}": it matches neither the on + uppercase-letter convention nor any known DOM event. The callback will never fire, and nothing will ever report an error.`
    fix = `Write event handlers as on + an uppercase letter (e.g. onClick / onDoubleClick); if this was never meant to be an event handler, rename the attribute, or bind explicitly with addEventListener inside an effect.`
  } else if (!camelCase) {
    // onclick → "click": works, but is not the conventional form
    severity = 'warning'
    message = `"${name}" works (bound to "${eventName}"), but event attributes conventionally start with on + an uppercase letter. The lowercase form only happens to match; rename it and it silently stops working ("once" would bind to "ce").`
    fix = `Change it to on${name.slice(2, 3).toUpperCase()}${name.slice(3)}.`
  } else if (!known) {
    // onFoo → "foo": could be a custom event, or a typo
    severity = 'warning'
    message = `"${name}" is bound to the event name "${eventName}", which is not a known DOM event. Ignore it if it is a custom event (dispatchEvent); if it is a typo, the callback will never fire and nothing will report an error.`
    fix = `Verify the event name spelling, or confirm that "${eventName}" really is dispatched by your own code.`
  } else {
    return
  }

  const { line, column, codeFrame } = buildCodeFrame(sourceFile, attribute.getStart(sourceFile), attribute.getWidth(sourceFile))
  state.diagnostics.push({
    code: 'VOBS_C102',
    severity,
    message,
    location: { file: state.filename, line, column },
    codeFrame,
    fix
  })
}

interface MappingSegment {
  readonly genLine: number
  readonly genCol: number
  readonly srcLine: number
  readonly srcCol: number
}

/**
 * Build a real statement-level source map. The generated file is re-parsed and
 * paired structurally with the compiled tree (statements map 1:1 inside every
 * block), so each emitted statement points back to the JSX or original
 * statement it was produced from.
 */
function buildSourceMap(
  state: CompileState,
  filename: string,
  source: string,
  generated: string,
  resultFile: ts.SourceFile
): import('./plugin').VobsSourceMap {
  const reparsed = ts.createSourceFile(filename, generated, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const segments: MappingSegment[] = []
  walkPairedTrees(state, resultFile, reparsed, reparsed, segments)
  segments.sort((a, b) => a.genLine - b.genLine || a.genCol - b.genCol)
  return {
    version: 3,
    file: filename,
    sources: [filename],
    sourcesContent: [source],
    names: [],
    mappings: encodeMappings(segments, generated.split('\n').length)
  }
}

/** Statements only nest inside these container kinds. */
function statementLists(node: ts.Node): readonly ts.Statement[] | null {
  if (ts.isSourceFile(node) || ts.isBlock(node) || ts.isModuleBlock(node)) return node.statements
  if (ts.isCaseClause(node) || ts.isDefaultClause(node)) return node.statements
  return null
}

/**
 * Pair the compiled tree with the re-parsed generated tree node by node.
 * Both trees were printed from the same AST, so their shapes are identical;
 * any divergence (length mismatch) simply abandons that subtree.
 */
function walkPairedTrees(
  state: CompileState,
  original: ts.Node,
  generated: ts.Node,
  reparsed: ts.SourceFile,
  segments: MappingSegment[]
): void {
  const originalStatements = statementLists(original)
  const generatedStatements = statementLists(generated)
  if (originalStatements && generatedStatements) {
    if (originalStatements.length !== generatedStatements.length) return
    for (let index = 0; index < originalStatements.length; index++) {
      const originalStatement = originalStatements[index]
      const generatedStatement = generatedStatements[index]
      recordSegment(state, originalStatement, generatedStatement, reparsed, segments)
      walkPairedTrees(state, originalStatement, generatedStatement, reparsed, segments)
    }
    return
  }

  const originalChildren: ts.Node[] = []
  const generatedChildren: ts.Node[] = []
  ts.forEachChild(original, node => { originalChildren.push(node) })
  ts.forEachChild(generated, node => { generatedChildren.push(node) })
  if (originalChildren.length !== generatedChildren.length) return
  for (let index = 0; index < originalChildren.length; index++) {
    walkPairedTrees(state, originalChildren[index], generatedChildren[index], reparsed, segments)
  }
}

function recordSegment(
  state: CompileState,
  originalStatement: ts.Statement,
  generatedStatement: ts.Statement,
  reparsed: ts.SourceFile,
  segments: MappingSegment[]
): void {
  const source = state.statementSources.get(originalStatement) ?? positionOfOriginalStatement(state, originalStatement)
  if (!source) return
  const position = reparsed.getLineAndCharacterOfPosition(generatedStatement.getStart(reparsed))
  segments.push({
    genLine: position.line,
    genCol: position.character,
    srcLine: source.line,
    srcCol: source.column
  })
}

function positionOfOriginalStatement(state: CompileState, statement: ts.Statement): SourcePosition | null {
  if (statement.pos < 0 || !state.sourceFile) return null
  const { line, character } = state.sourceFile.getLineAndCharacterOfPosition(
    statement.getStart(state.sourceFile)
  )
  return { line, column: character }
}

function encodeMappings(segments: readonly MappingSegment[], lineCount: number): string {
  const lines: string[][] = Array.from({ length: lineCount }, () => [])
  let prevGenLine = -1
  let prevGenCol = 0
  let prevSrcLine = 0
  let prevSrcCol = 0
  for (const segment of segments) {
    if (segment.genLine !== prevGenLine) {
      prevGenCol = 0
      prevGenLine = segment.genLine
    }
    const values = [
      segment.genCol - prevGenCol,
      0,
      segment.srcLine - prevSrcLine,
      segment.srcCol - prevSrcCol
    ]
    lines[segment.genLine].push(values.map(encodeVlq).join(''))
    prevGenCol = segment.genCol
    prevSrcLine = segment.srcLine
    prevSrcCol = segment.srcCol
  }
  return lines.map(line => line.join(',')).join(';')
}

const base64Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function encodeVlq(value: number): string {
  let encoded = value < 0 ? ((-value) << 1) | 1 : value << 1
  let result = ''
  do {
    let digit = encoded & 31
    encoded >>>= 5
    if (encoded > 0) digit |= 32
    result += base64Chars[digit]
  } while (encoded > 0)
  return result
}

function validatePlugins(plugins: readonly CompilerPlugin[]): void {
  const names = new Set<string>()
  for (const plugin of plugins) {
    if (!plugin.name) throw new VobsError({ code: 'VOBS_C007', layer: 'compiler', message: 'Compiler plugins must provide a name', fix: 'Add a stable, unique name to the plugin.' })
    if (names.has(plugin.name)) throw new VobsError({ code: 'VOBS_C007', layer: 'compiler', message: `Duplicate plugin detected: ${plugin.name}`, fix: 'Use a unique name for each compiler plugin.' })
    names.add(plugin.name)
  }
}

function transformPluginNodes(
  sourceFile: ts.SourceFile,
  plugin: CompilerPlugin,
  context: CompilerContext
): ts.SourceFile {
  const transformNode = plugin.transform?.node ?? plugin.transformNode
  if (!transformNode) return sourceFile

  const transformer: ts.TransformerFactory<ts.SourceFile> = transformContext => root => {
    const visit: ts.Visitor = node => {
      const replacement = transformNode(node, context)
      if (replacement === null) return undefined
      return ts.visitEachChild(replacement ?? node, visit, transformContext)
    }
    return ts.visitNode(root, visit) as ts.SourceFile
  }

  const result = ts.transform(sourceFile, [transformer])
  try {
    return result.transformed[0]
  } finally {
    result.dispose()
  }
}

/**
 * Collect every binding name declared anywhere in the source (imports, variables,
 * functions, parameters, ... including nested scopes). If a helper name is bound
 * in ANY scope, the injected runtime import must switch to an alias: generated
 * references uniformly use the alias, so user code is never captured or duplicated.
 */
function collectDeclaredNames(sourceFile: ts.SourceFile): Set<string> {
  const names = new Set<string>()
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && isBindingName(node)) names.add(node.text)
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return names
}

/** Collect `state` binding names imported from @vobs/reactivity / @vobs/vobs (including `as` aliases). */
function collectStateAliases(sourceFile: ts.SourceFile): Set<string> {
  const aliases = new Set<string>()
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
    const module = statement.moduleSpecifier.text
    if (module !== '@vobs/reactivity' && module !== '@vobs/vobs') continue
    const clause = statement.importClause
    if (!clause?.namedBindings || !ts.isNamedImports(clause.namedBindings)) continue
    for (const element of clause.namedBindings.elements) {
      if (element.propertyName ? element.propertyName.text === 'state' : element.name.text === 'state') {
        aliases.add(element.name.text)
      }
    }
  }
  return aliases
}

/** Same as collectDeclaredNames but skips import declarations: used to tell whether a helper name is shadowed by a local declaration. */
function collectLocallyDeclaredNames(sourceFile: ts.SourceFile): Set<string> {
  const names = new Set<string>()
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) return
    if (ts.isIdentifier(node) && isBindingName(node)) names.add(node.text)
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return names
}

/** Whether the identifier is the binding name of some declaration (import, variable, function, parameter, class member, etc.). */
function isBindingName(node: ts.Identifier): boolean {
  const parent = node.parent
  if (!parent) return false
  // Property accesses (document.createElement) and JSX attribute names are not binding names
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false
  if (ts.isQualifiedName(parent) && parent.right === node) return false
  if (ts.isJsxAttribute(parent)) return false
  return (parent as { name?: ts.Node }).name === node
}

/**
 * Resolve the reference name for a runtime helper. The plain name is kept when
 * the source never binds it; otherwise a collision-free alias is allocated and
 * the injected import uses the same alias (`import { createElement as _vobs_createElement }`).
 */
function resolveHelperName(state: CompileState, name: string): string {
  const existing = state.helperAliases.get(name)
  if (existing) return existing
  let alias = name
  if (state.takenNames.has(alias)) {
    alias = `_vobs_${name}`
    let suffix = 1
    while (state.takenNames.has(alias)) alias = `_vobs_${name}_${suffix++}`
  }
  state.helperAliases.set(name, alias)
  return alias
}

/** Create a reference to a runtime helper in generated code, matching the injected import. */
function helperRef(state: CompileState, name: string): ts.Identifier {
  return ts.factory.createIdentifier(resolveHelperName(state, name))
}

function createRuntimeImports(state: CompileState): ts.ImportDeclaration[] {
  const modules = new Map<string, ts.ImportSpecifier[]>()
  for (const [name, alias] of state.helperAliases) {
    const module = name === 'insertResourceBoundary' ? '@vobs/resource' : '@vobs/vobs'
    const imported = modules.get(module) ?? []
    imported.push(ts.factory.createImportSpecifier(
      false,
      alias === name ? undefined : ts.factory.createIdentifier(name),
      ts.factory.createIdentifier(alias)
    ))
    modules.set(module, imported)
  }
  return [...modules.entries()].map(([module, imported]) => ts.factory.createImportDeclaration(
    undefined,
    ts.factory.createImportClause(
      false,
      undefined,
      ts.factory.createNamedImports(imported)
    ),
    ts.factory.createStringLiteral(module)
  ))
}

function rebuildImport(state: CompileState, node: ts.ImportDeclaration): ts.ImportDeclaration {
  if (!ts.isStringLiteral(node.moduleSpecifier)) return node
  return tagStatement(state, ts.factory.createImportDeclaration(
    node.modifiers,
    node.importClause,
    ts.factory.createStringLiteral(node.moduleSpecifier.text),
    node.attributes
  ), node)
}

function transformStatement(state: CompileState, node: ts.Statement, moduleScope = false): ts.Statement {
  if (ts.isFunctionDeclaration(node) && node.body) {
    return tagStatement(state, ts.factory.updateFunctionDeclaration(
      node,
      node.modifiers,
      node.asteriskToken,
      node.name,
      node.typeParameters,
      node.parameters,
      node.type,
      transformBlock(state, node.body)
    ), node)
  }

  if (ts.isVariableStatement(node)) return transformVariableStatement(state, node, moduleScope)
  if (ts.isExportAssignment(node) && containsJsx(node.expression)) {
    return tagStatement(state, ts.factory.updateExportAssignment(node, node.modifiers, transformEmbeddedExpression(state, node.expression)), node)
  }
  if (ts.isExpressionStatement(node) && containsJsx(node.expression)) {
    return tagStatement(state, ts.factory.updateExpressionStatement(node, transformEmbeddedExpression(state, node.expression)), node)
  }
  if (ts.isReturnStatement(node) && node.expression && containsJsx(node.expression)) {
    return tagStatement(state, ts.factory.updateReturnStatement(node, transformEmbeddedExpression(state, node.expression)), node)
  }
  return node
}

function transformVariableStatement(state: CompileState, node: ts.VariableStatement, moduleScope = false): ts.VariableStatement {
  let changed = false
  const declarations = node.declarationList.declarations.map(declaration => {
    const initializer = declaration.initializer
    if (!initializer) return declaration

    let nextInitializer = inferStateDebugName(state, declaration, initializer) ?? initializer
    if (containsJsx(nextInitializer)) {
      nextInitializer = transformEmbeddedExpression(state, nextInitializer)
    } else if (moduleScope && state.hmrModuleId !== null) {
      // HMR state preservation applies only at module top level: function-local state should create a fresh signal on every call
      nextInitializer = wrapStateWithHmrRef(state, declaration, nextInitializer) ?? nextInitializer
    }
    if (nextInitializer === initializer) return declaration

    changed = true
    return ts.factory.updateVariableDeclaration(
      declaration,
      declaration.name,
      declaration.exclamationToken,
      declaration.type,
      nextInitializer
    )
  })

  if (!changed) return node

  return tagStatement(state, ts.factory.updateVariableStatement(
    node,
    node.modifiers,
    ts.factory.updateVariableDeclarationList(node.declarationList, declarations)
  ), node)
}

/**
 * When no debugName is passed explicitly, `const name = state(initial)` infers it from the variable name:
 * `const username = state('')` → `state('', 'username')`, so DevTools signal names match the source naming.
 * Enabled only when `state` verifiably comes from @vobs/reactivity / @vobs/vobs, is not shadowed by a local declaration,
 * and the call has exactly one argument; all other shapes stay untouched.
 */
function inferStateDebugName(
  state: CompileState,
  declaration: ts.VariableDeclaration,
  initializer: ts.Expression
): ts.Expression | undefined {
  if (state.stateAliases.size === 0) return undefined
  if (!ts.isIdentifier(declaration.name)) return undefined

  let call = initializer
  while (ts.isParenthesizedExpression(call) || ts.isAsExpression(call) || ts.isTypeAssertionExpression(call) || ts.isSatisfiesExpression(call)) {
    call = call.expression
  }
  if (!ts.isCallExpression(call)) return undefined
  const callee = call.expression
  if (!ts.isIdentifier(callee) || !state.stateAliases.has(callee.text)) return undefined
  if (state.localBindings.has(callee.text)) return undefined
  if (call.arguments.length !== 1) return undefined

  return ts.factory.createCallExpression(callee, call.typeArguments, [
    ...call.arguments,
    ts.factory.createStringLiteral(declaration.name.text)
  ])
}

/**
 * HMR state preservation: when a hot update re-executes a module, module-level state() creates brand-new signal instances that
 * coexist with the old instances held by importers that did not re-execute — "two copies of the state" (symptoms: edits have no
 * effect, half the page misbehaves, and even a full refresh cannot clear it). With hmrModuleId enabled, module-top-level state
 * declarations fetch through a runtime registry instead: `const x = state(init)` → `const x = hmrStateRef(moduleId, 'x', () => state(init, 'x'))`.
 * The first execution creates as usual; on module re-execution the existing signal is reused, while module logic (side effects, exported bindings) re-runs as usual.
 */
function wrapStateWithHmrRef(
  state: CompileState,
  declaration: ts.VariableDeclaration,
  initializer: ts.Expression
): ts.Expression | undefined {
  let call = initializer
  while (ts.isParenthesizedExpression(call) || ts.isAsExpression(call) || ts.isTypeAssertionExpression(call) || ts.isSatisfiesExpression(call)) {
    call = call.expression
  }
  if (!ts.isCallExpression(call)) return undefined
  const callee = call.expression
  if (!ts.isIdentifier(callee) || !state.stateAliases.has(callee.text)) return undefined
  if (state.localBindings.has(callee.text)) return undefined
  if (!ts.isIdentifier(declaration.name)) return undefined
  return ts.factory.createCallExpression(helperRef(state, 'hmrStateRef'), undefined, [
    ts.factory.createStringLiteral(`${state.hmrModuleId}#${declaration.name.text}`),
    ts.factory.createArrowFunction(
      undefined,
      undefined,
      [],
      undefined,
      ts.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
      initializer
    )
  ])
}

function containsJsx(expression: ts.Expression | ts.SourceFile): boolean {
  let found = false
  const visit = (node: ts.Node): void => {
    if (isJsxExpression(node as ts.Expression)) {
      found = true
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(expression)
  return found
}

function transformBlock(state: CompileState, block: ts.Block): ts.Block {
  const statements = block.statements.map(statement => {
    if (!ts.isReturnStatement(statement) || !statement.expression) return transformStatement(state, statement)
    const expression = ts.isParenthesizedExpression(statement.expression)
      ? statement.expression.expression
      : statement.expression
    return isJsxExpression(expression)
      ? tagStatement(state, ts.factory.updateReturnStatement(statement, transformJsxExpression(state, expression)), statement)
      : statement
  })
  return ts.factory.updateBlock(block, statements)
}

function isJsxExpression(node: ts.Expression): node is ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment {
  return ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)
}

function transformJsxExpression(state: CompileState, node: ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment): ts.Expression {
  if (ts.isJsxFragment(node)) return transformFragment(state, node.children)
  if (ts.isJsxElement(node)) {
    return transformElement(state, node, node.openingElement.tagName, node.openingElement.attributes, node.children)
  }
  return transformElement(state, node, node.tagName, node.attributes, [])
}

function transformElement(
  state: CompileState,
  node: ts.JsxElement | ts.JsxSelfClosingElement,
  tagName: ts.JsxTagNameExpression,
  attributes: ts.JsxAttributes,
  children: readonly ts.JsxChild[]
): ts.Expression {
  if (isFragmentTag(tagName)) return transformFragment(state, children)
  if (!ts.isIdentifier(tagName)) {
    // Shapes like <Foo.Bar> and <svg:rect> used to compile silently into invalid DOM tags (createElement("Foo.Bar")).
    // A structured diagnostic is reported, then the original path continues to keep output structure stable; compile()/the Vite plugin fail on the error diagnostic.
    reportUnsupportedTag(state, tagName)
  }
  if (ts.isIdentifier(tagName) && tagName.text === 'ResourceBoundary') {
    return transformResourceBoundary(state, node, attributes, children)
  }
  if (ts.isIdentifier(tagName) && tagName.text === 'AsyncBoundary') {
    return transformAsyncBoundary(state, node, attributes, children)
  }
  if (ts.isIdentifier(tagName) && tagName.text === 'ErrorBoundary') {
    return transformErrorBoundary(state, node, attributes, children)
  }
  if (ts.isIdentifier(tagName) && tagName.text === 'Profiler') {
    return transformProfiler(state, node, attributes, children)
  }
  if (ts.isIdentifier(tagName) && /^[A-Z]/.test(tagName.text)) {
    const args: ts.Expression[] = [
      ts.factory.createCallExpression(helperRef(state, 'resolveComponent'), undefined, [
        tagName,
        ts.factory.createStringLiteral(state.filename),
        ts.factory.createStringLiteral(tagName.text)
      ]),
      createComponentProps(state, attributes, children)
    ]
    // Source locations are only for error locating and DevTools; production builds can strip them entirely (errors still carry the component name; positioning goes through the source map).
    if (state.sourceLocation) args.push(createSourceLocation(tagName))
    return ts.factory.createCallExpression(helperRef(state, 'createComponent'), undefined, args)
  }

  // Static template hoisting: fully static DOM subtrees (no events/dynamic bindings/spread/property attributes) are
  // serialized into module-level templates; at runtime one cloneNode replaces createElement + setStaticProps + per-child insertion.
  // Skipped when hoistTemplates=false (SSR/Node builds): createTemplate depends on document.
  //
  // SVG subtrees are never hoisted: template strings are parsed **by the HTML parser**, so `<g>`/`<rect>` become
  // HTMLUnknownElement and `<a>`/`<title>` become HTML elements — all silently not rendering or rendering wrong.
  // (isStaticElement only rejects on SVG-exclusive tag names, while a/title/style share their names with HTML —
  // the name alone is not enough to decide, so hoisting is switched off wholesale by the compiler-known namespace here.)
  if (state.hoistTemplates && state.svgDepth === 0 && isStaticElement(tagName, attributes, children)) {
    return ts.factory.createCallExpression(
      helperRef(state, 'cloneTemplate'),
      undefined,
      [registerTemplate(state, serializeStaticHtml(node))]
    )
  }

  const elementName = tagName.getText()
  const elementId = nextIdentifier(state, '_el')
  /*
   * The namespace is decided by the compiler (see the CompileState.svgDepth notes):
   * elements inside an SVG subtree whose names are not SVG-exclusive tags (a / title / style / script)
   * must be created explicitly via SVG, otherwise HTML elements get built — silently.
   */
  const createHelper = state.svgDepth > 0 && !isSvgTag(elementName) ? 'createSvgElement' : 'createElement'
  const statements: ts.Statement[] = [
    createConstStatement(
      state,
      elementId,
      ts.factory.createCallExpression(
        helperRef(state, createHelper),
        undefined,
        [ts.factory.createStringLiteral(elementName)]
      ),
      node
    )
  ]

  appendAttributes(state, statements, elementId, attributes)

  // Subtrees of <svg> enter the SVG namespace; subtrees of <foreignObject> switch back to HTML; everything else inherits.
  const outerSvgDepth = state.svgDepth
  if (elementName === 'svg') state.svgDepth = outerSvgDepth + 1
  else if (elementName === 'foreignObject') state.svgDepth = 0
  appendChildren(state, statements, elementId, children)
  state.svgDepth = outerSvgDepth
  statements.push(tagStatement(state, ts.factory.createReturnStatement(elementId), node))

  return ts.factory.createCallExpression(
    ts.factory.createArrowFunction(
      undefined,
      undefined,
      [],
      undefined,
      ts.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
      ts.factory.createBlock(statements, true)
    ),
    undefined,
    []
  )
}

function isFragmentTag(tagName: ts.JsxTagNameExpression): boolean {
  return tagName.getText() === 'Fragment' || tagName.getText() === 'Vobs.Fragment'
}

function transformFragment(state: CompileState, children: readonly ts.JsxChild[]): ts.Expression {
  const parent = nextIdentifier(state, '_fragmentParent')
  const anchor = nextIdentifier(state, '_fragmentAnchor')
  const statements: ts.Statement[] = []
  appendChildren(state, statements, parent, children, anchor)
  return ts.factory.createCallExpression(
    helperRef(state, 'createFragment'),
    undefined,
    [ts.factory.createArrowFunction(
      undefined,
      undefined,
      [
        ts.factory.createParameterDeclaration(undefined, undefined, parent),
        ts.factory.createParameterDeclaration(undefined, undefined, anchor)
      ],
      undefined,
      ts.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
      ts.factory.createBlock(statements, true)
    )]
  )
}

/**
 * A boundary component is missing a required prop.
 *
 * This used to `throw new VobsError` directly — so `compileWithSourceMap` (the non-throwing API) threw
 * instead of returning diagnostics: no location, and only one problem visible at a time.
 * It now pushes one located diagnostic and lets compilation continue, taking the same path as other diagnostics.
 */
function reportMissingBoundaryProp(
  state: CompileState,
  node: ts.JsxElement | ts.JsxSelfClosingElement,
  component: string,
  prop: string,
  fix: string
): void {
  const sourceFile = node.getSourceFile() ?? state.sourceFile
  if (!sourceFile) return
  const tagName = ts.isJsxElement(node) ? node.openingElement.tagName : node.tagName
  const { line, column, codeFrame } = buildCodeFrame(sourceFile, tagName.getStart(sourceFile), tagName.getWidth(sourceFile))
  state.diagnostics.push({
    code: 'VOBS_C002',
    severity: 'error',
    message: `${component} must provide the ${prop} prop.`,
    location: { file: state.filename, line, column },
    codeFrame,
    fix
  })
}

function transformResourceBoundary(
  state: CompileState,
  node: ts.JsxElement | ts.JsxSelfClosingElement,
  attributes: ts.JsxAttributes,
  children: readonly ts.JsxChild[]
): ts.Expression {
  const resource = getAttributeExpression(attributes, 'resource')
  if (!resource) {
    reportMissingBoundaryProp(state, node, 'ResourceBoundary', 'resource', 'Add resource={resource} to the ResourceBoundary.')
    return ts.factory.createNull()
  }
  const options: ts.ObjectLiteralElementLike[] = [
    ts.factory.createPropertyAssignment('resource', transformEmbeddedExpression(state, resource)),
    ts.factory.createPropertyAssignment('children', createBoundaryFactory(state, children))
  ]
  appendBoundaryOptionalProperty(state, options, attributes, 'loading')
  appendBoundaryOptionalProperty(state, options, attributes, 'empty')
  appendBoundaryOptionalProperty(state, options, attributes, 'fallback')
  return createBoundaryFragment(state, node, 'insertResourceBoundary', options)
}

function transformErrorBoundary(
  state: CompileState,
  node: ts.JsxElement | ts.JsxSelfClosingElement,
  attributes: ts.JsxAttributes,
  children: readonly ts.JsxChild[]
): ts.Expression {
  const fallback = getAttributeExpression(attributes, 'fallback')
  if (!fallback) {
    reportMissingBoundaryProp(state, node, 'ErrorBoundary', 'fallback', 'Add fallback={(error, retry) => ...} to the ErrorBoundary.')
    return ts.factory.createNull()
  }
  return createBoundaryFragment(state, node, 'insertErrorBoundary', [
    ts.factory.createPropertyAssignment('children', createBoundaryFactory(state, children)),
    ts.factory.createPropertyAssignment('fallback', transformEmbeddedExpression(state, fallback))
  ])
}

function transformAsyncBoundary(
  state: CompileState,
  node: ts.JsxElement | ts.JsxSelfClosingElement,
  attributes: ts.JsxAttributes,
  children: readonly ts.JsxChild[]
): ts.Expression {
  const promise = getAttributeExpression(attributes, 'promise')
  if (!promise) {
    reportMissingBoundaryProp(state, node, 'AsyncBoundary', 'promise', 'Add promise={promise} to the AsyncBoundary.')
    return ts.factory.createNull()
  }
  const options: ts.ObjectLiteralElementLike[] = [
    ts.factory.createPropertyAssignment('promise', transformEmbeddedExpression(state, promise)),
    ts.factory.createPropertyAssignment('children', createAsyncFactory(state, children))
  ]
  appendBoundaryOptionalProperty(state, options, attributes, 'loading')
  appendBoundaryOptionalProperty(state, options, attributes, 'fallback')
  const resetKey = getAttributeExpression(attributes, 'resetKey')
  if (resetKey) options.push(ts.factory.createPropertyAssignment('resetKey', createGetter(resetKey)))
  return createBoundaryFragment(state, node, 'insertAsyncBoundary', options)
}

function transformProfiler(
  state: CompileState,
  node: ts.JsxElement | ts.JsxSelfClosingElement,
  attributes: ts.JsxAttributes,
  children: readonly ts.JsxChild[]
): ts.Expression {
  const idAttribute = attributes.properties.find(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText() === 'id')
  const id = idAttribute && ts.isJsxAttribute(idAttribute) && idAttribute.initializer && ts.isStringLiteral(idAttribute.initializer)
    ? ts.factory.createStringLiteral(idAttribute.initializer.text)
    : idAttribute && ts.isJsxAttribute(idAttribute) && idAttribute.initializer && ts.isJsxExpression(idAttribute.initializer)
      ? idAttribute.initializer.expression
      : null
  if (!id) throw new VobsError({ code: 'VOBS_C002', layer: 'compiler', message: 'Profiler must provide the id prop', fix: 'Add id="ComponentName" to the Profiler.' })
  const options: ts.ObjectLiteralElementLike[] = [
    ts.factory.createPropertyAssignment('id', transformEmbeddedExpression(state, id)),
    ts.factory.createPropertyAssignment('children', createBoundaryFactory(state, children))
  ]
  appendBoundaryOptionalProperty(state, options, attributes, 'onRender')
  return createBoundaryFragment(state, node, 'insertProfiler', options)
}

function createBoundaryFragment(
  state: CompileState,
  node: ts.JsxElement | ts.JsxSelfClosingElement,
  helper: 'insertResourceBoundary' | 'insertErrorBoundary' | 'insertAsyncBoundary' | 'insertProfiler',
  options: readonly ts.ObjectLiteralElementLike[]
): ts.Expression {
  const parent = nextIdentifier(state, '_boundaryParent')
  const anchor = nextIdentifier(state, '_boundaryAnchor')
  return ts.factory.createCallExpression(
    helperRef(state, 'createFragment'),
    undefined,
    [ts.factory.createArrowFunction(
      undefined,
      undefined,
      [
        ts.factory.createParameterDeclaration(undefined, undefined, parent),
        ts.factory.createParameterDeclaration(undefined, undefined, anchor)
      ],
      undefined,
      ts.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
      ts.factory.createBlock([callStatement(state, helper, [
        parent,
        anchor,
        ts.factory.createObjectLiteralExpression(options, true)
      ], node)], true)
    )]
  )
}

function createBoundaryFactory(state: CompileState, children: readonly ts.JsxChild[]): ts.ArrowFunction {
  const content = transformFragment(state, children)
  return ts.factory.createArrowFunction(
    undefined,
    undefined,
    [],
    undefined,
    ts.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    content
  )
}

function createAsyncFactory(state: CompileState, children: readonly ts.JsxChild[]): ts.ArrowFunction {
  const value = ts.factory.createIdentifier('value')
  const expressionChild = children.length === 1 && children[0].kind === ts.SyntaxKind.JsxExpression
    ? (children[0] as ts.JsxExpression).expression
    : undefined
  if (expressionChild && ts.isArrowFunction(expressionChild)) {
    const transformed = transformEmbeddedExpression(state, expressionChild)
    return transformed as ts.ArrowFunction
  }
  const content = transformFragment(state, children)
  return ts.factory.createArrowFunction(undefined, undefined, [
    ts.factory.createParameterDeclaration(undefined, undefined, value)
  ], undefined, ts.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken), content)
}

function appendBoundaryOptionalProperty(
  state: CompileState,
  properties: ts.ObjectLiteralElementLike[],
  attributes: ts.JsxAttributes,
  name: string
): void {
  const expression = getAttributeExpression(attributes, name)
  if (expression) {
    const transformed = transformEmbeddedExpression(state, expression)
    const value = isJsxExpression(unwrapExpression(expression))
      ? createGetter(transformed)
      : transformed
    properties.push(ts.factory.createPropertyAssignment(name, value))
  }
}

function getAttributeExpression(attributes: ts.JsxAttributes, name: string): ts.Expression | null {
  for (const attribute of attributes.properties) {
    if (!ts.isJsxAttribute(attribute) || attribute.name.getText() !== name) continue
    if (attribute.initializer && ts.isJsxExpression(attribute.initializer)) {
      return attribute.initializer.expression ?? null
    }
  }
  return null
}

function transformEmbeddedExpression(state: CompileState, expression: ts.Expression): ts.Expression {
  const result = ts.transform(expression, [context => root => {
    const visit: ts.Visitor = node => {
      if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
        return transformJsxExpression(state, node)
      }
      return ts.visitEachChild(node, visit, context)
    }
    return ts.visitNode(root, visit) as ts.Expression
  }])
  try {
    return result.transformed[0]
  } finally {
    result.dispose()
  }
}


function transformResidualJsx(state: CompileState, sourceFile: ts.SourceFile): ts.SourceFile {
  if (!containsJsx(sourceFile)) return sourceFile
  const result = ts.transform(sourceFile, [context => root => {
    const visit: ts.Visitor = node => {
      if (ts.isReturnStatement(node) && node.expression && containsJsx(node.expression)) {
        return ts.factory.updateReturnStatement(node, transformEmbeddedExpression(state, node.expression))
      }
      if (isJsxExpression(node as ts.Expression)) {
        return transformJsxExpression(state, node as ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment)
      }
      return ts.visitEachChild(node, visit, context)
    }
    return ts.visitNode(root, visit) as ts.SourceFile
  }])
  try {
    return result.transformed[0]
  } finally {
    result.dispose()
  }
}

/**
 * Static element test: DOM tag + all attributes are string literals or valueless + all children are text or recursively static elements.
 * Conservative exclusions (semantic or serialization equivalence not guaranteed; the original path is kept):
 * - property attributes (value/checked/disabled etc.): HTML attribute and setProperty initial semantics differ;
 * - events (on*), ref, spread, key: dynamic behavior by nature;
 * - nested components/Fragments/Boundaries: not pure DOM subtrees.
 */
function isStaticElement(
  tagName: ts.JsxTagNameExpression,
  attributes: ts.JsxAttributes,
  children: readonly ts.JsxChild[]
): boolean {
  if (!ts.isIdentifier(tagName) || !/^[a-z]/.test(tagName.text)) return false
  /*
   * SVG subtrees must not be hoisted into templates.
   *
   * Templates go through the HTML parser (<template>.innerHTML), where `<g>` and `<rect>` parse into
   * HTMLUnknownElement — wrong namespace, the whole graphic never renders, and **nothing reports an error**.
   * The createElement path (ops.ts) already routes by tag name to createElementNS; hoisting was the one path that missed it.
   * If any descendant is an SVG tag the whole tree is not hoisted; recursion covers this naturally.
   */
  if (isSvgTag(tagName.text)) return false
  for (const attribute of attributes.properties) {
    if (ts.isJsxSpreadAttribute(attribute)) return false
    if (!ts.isJsxAttribute(attribute)) return false
    const name = attribute.name.getText()
    if (name === 'key' || name === 'ref' || name.startsWith('on')) return false
    if (isPropertyName(name)) return false
    const initializer = attribute.initializer
    if (initializer && !ts.isStringLiteral(initializer)) return false
  }
  for (const child of children) {
    if (ts.isJsxText(child)) continue
    if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) {
      const nested = ts.isJsxElement(child)
        ? { tagName: child.openingElement.tagName, attributes: child.openingElement.attributes, children: child.children }
        : { tagName: child.tagName, attributes: child.attributes, children: [] as readonly ts.JsxChild[] }
      if (!isStaticElement(nested.tagName, nested.attributes, nested.children)) return false
      continue
    }
    return false
  }
  return true
}

/** Serialize a fully-static JSX element to HTML, preserving the compiler's text normalization. */
function serializeStaticHtml(node: ts.JsxElement | ts.JsxSelfClosingElement): string {
  const { tagName, attributes, children } = ts.isJsxElement(node)
    ? { tagName: node.openingElement.tagName, attributes: node.openingElement.attributes, children: node.children }
    : { tagName: node.tagName, attributes: node.attributes, children: [] as readonly ts.JsxChild[] }
  return serializeStaticElement(tagName, attributes, children)
}

function serializeStaticElement(
  tagName: ts.JsxTagNameExpression,
  attributes: ts.JsxAttributes,
  children: readonly ts.JsxChild[]
): string {
  const name = tagName.getText()
  let html = `<${name}`
  for (const attribute of attributes.properties) {
    if (!ts.isJsxAttribute(attribute)) continue
    /*
     * Must go through the **runtime table** (`domAttributeName`), not just a hand-written className special case.
     *
     * This used to be only `=== 'className' ? 'class' : keep as-is`, so `htmlFor` was spliced verbatim into the template string,
     * and the HTML parser, being case-insensitive, read it as `htmlfor="name"` — and `for` is not a case variant of `htmlfor`;
     * it is a **different name**, so the label-to-control association silently broke.
     * The dynamic path (`bindAttribute(_el0, "for", …)`, see the emit below) produces the correct `for`,
     * so the same attribute name behaved differently on the static vs dynamic paths — measured:
     *   <label htmlFor="name">        → <label htmlfor="name">   ✗
     *   <label htmlFor={f}>           → <label for="name">       ✓
     * Fix: both paths share `domAttributeName` (compile-time and runtime decisions from one source — exactly the intent of dom-props.ts).
     */
    const attributeName = domAttributeName(attribute.name.getText())
    const initializer = attribute.initializer
    if (!initializer) {
      html += ` ${attributeName}=""`
      continue
    }
    if (ts.isStringLiteral(initializer)) {
      html += ` ${attributeName}="${escapeHtmlAttribute(initializer.text)}"`
    }
  }
  html += '>'

  for (const child of children) {
    if (ts.isJsxText(child)) {
      // Shares the same normalization as appendChildren (including the legitimate space between elements), keeping hoisted and non-hoisted output consistent.
      const text = transformJsxText(child.text)
      if (text !== '') html += escapeHtmlText(text)
      continue
    }
    if (ts.isJsxElement(child)) {
      html += serializeStaticElement(
        child.openingElement.tagName,
        child.openingElement.attributes,
        child.children
      )
      continue
    }
    if (ts.isJsxSelfClosingElement(child)) {
      html += serializeStaticElement(child.tagName, child.attributes, [])
    }
  }
  html += `</${name}>`
  return html
}

function escapeHtmlAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

function escapeHtmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Register a hoisted template declaration; identical HTML shares one declaration. */
function registerTemplate(state: CompileState, html: string): ts.Expression {
  const existing = state.templates.get(html)
  if (existing) return existing
  const identifier = nextIdentifier(state, '_tpl')
  state.templates.set(html, identifier)
  return identifier
}

function createTemplateDeclarations(state: CompileState): ts.Statement[] {
  return [...state.templates.entries()].map(([html, identifier]) =>
    ts.factory.createVariableStatement(undefined, ts.factory.createVariableDeclarationList([
      ts.factory.createVariableDeclaration(identifier, undefined, undefined, ts.factory.createCallExpression(
        helperRef(state, 'createTemplate'),
        undefined,
        [ts.factory.createStringLiteral(html)]
      ))
    ], ts.NodeFlags.Const))
  )
}

function appendAttributes(
  state: CompileState,
  statements: ts.Statement[],
  element: ts.Identifier,
  attributes: ts.JsxAttributes
): void {
  const staticProps: ts.ObjectLiteralElementLike[] = []
  const hasSpread = attributes.properties.some(attribute => ts.isJsxSpreadAttribute(attribute))
  for (const attribute of attributes.properties) {
    if (ts.isJsxSpreadAttribute(attribute)) {
      /*
       * `{...props}` is bound **reactively**.
       *
       * This used to emit only `spreadProps` — applied once at creation and done, so "changing props has no effect"
       * and "keys deleted from the object stay on the DOM forever" both failed silently.
       * bindSpreadProps applies incrementally each round: changed keys are written, vanished keys are removed (attribute deleted,
       * property reset, event listener detached).
       */
      statements.push(callStatement(state, 'bindSpreadProps', [element, createGetter(attribute.expression)], attribute))
      continue
    }
    if (!ts.isJsxAttribute(attribute)) continue
    const name = attribute.name.getText()
    if (name === 'key') continue
    if (name === 'ref') {
      const initializer = attribute.initializer
      if (initializer && ts.isJsxExpression(initializer) && initializer.expression) {
        statements.push(callStatement(state, 'setRef', [element, transformEmbeddedExpression(state, initializer.expression)], attribute))
      }
      continue
    }
    const initializer = attribute.initializer

    if (name.startsWith('on') && initializer && ts.isJsxExpression(initializer) && initializer.expression) {
      const resolved = resolveEventNameForDiagnostics(name)
      if (resolved === undefined) {
        // Just "on" by itself: neither an event attribute nor a meaningful name
        reportEventName(state, attribute, name)
        continue
      }
      reportEventName(state, attribute, name)
      statements.push(callStatement(state, 'addEventListener', [
        element,
        ts.factory.createStringLiteral(resolved.eventName),
        initializer.expression
      ], attribute))
      continue
    }

    if (!initializer) {
      if (hasSpread) {
        statements.push(callStatement(state, isPropertyName(name) ? 'setProperty' : 'setAttribute', [element, ts.factory.createStringLiteral(isPropertyName(name) ? name : domAttributeName(name)), isPropertyName(name) ? ts.factory.createTrue() : ts.factory.createStringLiteral('')], attribute))
        continue
      }
      if (isPropertyName(name)) staticProps.push(createStaticProperty(name, ts.factory.createTrue()))
      else staticProps.push(createStaticProperty(domAttributeName(name), ts.factory.createStringLiteral('')))
      continue
    }
    if (ts.isStringLiteral(initializer)) {
      if (hasSpread) {
        statements.push(callStatement(state, isPropertyName(name) ? 'setProperty' : 'setAttribute', [element, ts.factory.createStringLiteral(isPropertyName(name) ? name : domAttributeName(name)), ts.factory.createStringLiteral(initializer.text)], attribute))
        continue
      }
      staticProps.push(createStaticProperty(isPropertyName(name) ? name : domAttributeName(name),
        ts.factory.createStringLiteral(initializer.text)))
      continue
    }

    const attributeName = domAttributeName(name)
    const propertyAttribute = isPropertyName(name)
    if (ts.isJsxExpression(initializer) && initializer.expression) {
      statements.push(callStatement(state, propertyAttribute ? 'bindProperty' : 'bindAttribute', [
        element,
        ts.factory.createStringLiteral(propertyAttribute ? name : attributeName),
        createGetter(initializer.expression)
      ], attribute))
    }
  }
  if (staticProps.length) statements.splice(1, 0, callStatement(state, 'setStaticProps', [
    element,
    ts.factory.createObjectLiteralExpression(staticProps, true)
  ], attributes))
}

function createStaticProperty(name: string, value: ts.Expression): ts.PropertyAssignment {
  return ts.factory.createPropertyAssignment(ts.factory.createStringLiteral(name), value)
}


/**
 * Whitespace normalization for JSX text nodes — following the Babel/React rules, **not a plain trim**.
 *
 * All three places used to run `replace(/\s+/g, ' ').trimStart()`, so in
 *   <p><b>a</b> <i>b</i></p>
 * that **legitimate space** was deleted, rendering "ab", while React / Solid render "a b".
 * Both the static hoisting path and the dynamic path did this, so although the comments on both sides said "identical word for word",
 * what they preserved was a consistently wrong semantic.
 *
 * Correct rules:
 *   - Text without line breaks is **kept as-is** (a single space between elements belongs to this class)
 *   - Text with line breaks: trim each line, drop empty lines, join the kept lines with a single space
 * So indentation line breaks are eaten (matching React) while within-line spaces survive.
 */
export function transformJsxText(raw: string): string {
  if (!raw.includes('\n') && !raw.includes('\r')) return raw
  const lines = raw.split(/\r\n|\n|\r/u)
  let lastNonEmpty = 0
  for (let index = 0; index < lines.length; index += 1) {
    if (/[^ \t]/u.test(lines[index])) lastNonEmpty = index
  }
  let result = ''
  for (let index = 0; index < lines.length; index += 1) {
    let line = lines[index].replace(/\t/gu, ' ')
    if (index !== 0) line = line.replace(/^ +/u, '')
    if (index !== lines.length - 1) line = line.replace(/ +$/u, '')
    if (line !== '') {
      if (index !== lastNonEmpty) line += ' '
      result += line
    }
  }
  return result
}

function appendChildren(
  state: CompileState,
  statements: ts.Statement[],
  element: ts.Identifier,
  children: readonly ts.JsxChild[],
  anchor: ts.Expression = ts.factory.createNull()
): void {
  for (const child of children) {
    if (ts.isJsxText(child)) {
      const text = transformJsxText(child.text)
      if (text !== '') {
        statements.push(callStatement(state, 'insertBefore', [
        element,
        ts.factory.createCallExpression(helperRef(state, 'createText'), undefined, [
          ts.factory.createStringLiteral(text)
        ]),
        anchor
      ], child))
      }
      continue
    }

    if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child) || ts.isJsxFragment(child)) {
      statements.push(callStatement(state, 'insertBefore', [
        element,
        transformJsxExpression(state, child),
        anchor
      ], child))
      continue
    }

    if (child.kind === ts.SyntaxKind.JsxExpression) {
      const expression = (child as ts.JsxExpression).expression
      if (!expression) continue
      const list = transformListExpression(state, element, expression, anchor)
      if (list) {
        statements.push(callStatement(state, 'insertList', list, child))
        continue
      }
      const show = transformShowListExpression(state, expression)
      if (show) {
        // C232 root fix (2026-10-28): keyed lists inside ternary/`&&` branches compile to insertShow —
        // cond only manages container mount/unmount, while the list uses standard insertList inside the container (keyed reuse); no more whole-list rebuilds.
        statements.push(callStatement(state, 'insertShow', [
          element,
          anchor,
          createGetter(show.condition),
          show.mount
        ], child))
        continue
      }
      const dynamic = transformDynamicExpression(state, expression)
      if (dynamic) {
        statements.push(callStatement(state, 'insertDynamic', [element, anchor, dynamic], child))
        continue
      }
      // All other expressions (function calls, member accesses, literals, identifiers, ...) go through insertDynamicValue
      // polymorphic insertion: value types dispatch at runtime — strings/numbers hit the in-place update fast path of self-built
      // text nodes (equivalent to bindText performance), while nodes/Fragments/arrays mount correctly. The compiler never guesses a call's
      // return type, so helpers returning nodes (e.g. renderXxx()) and string-returning t('...') are equally safe.
      const value = transformEmbeddedExpression(state, expression)
      statements.push(callStatement(state, 'insertDynamicValue', [element, anchor, createGetter(value)], child))
    }
  }
}

function createComponentProps(
  state: CompileState,
  attributes: ts.JsxAttributes,
  children: readonly ts.JsxChild[]
): ts.ObjectLiteralExpression {
  const properties: ts.ObjectLiteralElementLike[] = []

  for (const attribute of attributes.properties) {
    if (ts.isJsxSpreadAttribute(attribute)) {
      properties.push(ts.factory.createSpreadAssignment(attribute.expression))
      continue
    }

    const name = propertyName(attribute.name.getText())
    if (attribute.name.getText() === 'key') continue
    const initializer = attribute.initializer
    if (!initializer) {
      properties.push(ts.factory.createPropertyAssignment(name, ts.factory.createTrue()))
    } else if (ts.isStringLiteral(initializer)) {
      properties.push(ts.factory.createPropertyAssignment(name, ts.factory.createStringLiteral(initializer.text)))
    } else if (ts.isJsxExpression(initializer) && initializer.expression) {
      properties.push(createGetterProperty(name, transformEmbeddedExpression(state, initializer.expression)))
    }
  }

  const childExpressions = children.flatMap(child => childToComponentExpression(state, child))
  if (childExpressions.length === 1) {
    properties.push(createGetterProperty('children', childExpressions[0]))
  } else if (childExpressions.length > 1) {
    properties.push(createGetterProperty('children', ts.factory.createArrayLiteralExpression(childExpressions)))
  }

  return ts.factory.createObjectLiteralExpression(properties, true)
}

function createSourceLocation(node: ts.Node): ts.ObjectLiteralExpression {
  const sourceFile = node.getSourceFile()
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
  return ts.factory.createObjectLiteralExpression([
    ts.factory.createPropertyAssignment('file', ts.factory.createStringLiteral(sourceFile.fileName)),
    ts.factory.createPropertyAssignment('line', ts.factory.createNumericLiteral(position.line + 1)),
    ts.factory.createPropertyAssignment('column', ts.factory.createNumericLiteral(position.character + 1))
  ], true)
}

function transformDynamicExpression(state: CompileState, expression: ts.Expression): ts.ArrowFunction | null {
  const converted = convertDynamicNodeExpression(state, expression)
  return converted ? createGetter(converted) : null
}

/**
 * Converts node-producing dynamic expressions (`cond ? <A/> : <B/>`, `cond && <A/>`, with arbitrary nesting)
 * into a conditional expression tree; the JSX in each branch is recursively compiled into node factories that insertDynamic mounts/unmounts.
 *
 * This fast path is taken **only when every branch can produce a node**. If any branch is a list (`.map`), text,
 * a number, or another non-node expression, the whole thing returns null and the caller falls back to insertDynamicValue polymorphic insertion —
 * otherwise that branch would compile to `null` and its content would **vanish silently**.
 */
function convertDynamicNodeExpression(state: CompileState, expression: ts.Expression): ts.ConditionalExpression | null {
  if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
    const right = unwrapExpression(expression.right)
    if (isJsxExpression(right)) {
      return createNodeConditional(expression.left, transformJsxExpression(state, right), null)
    }
    // When the right side is a nested dynamic node expression (e.g. cond && (sub ? <A/> : <B/>)), convert recursively;
    // if conversion fails (list/text branch), fall back entirely to dynamic value binding, keeping the semantics statically decidable.
    const convertedRight = convertDynamicNodeExpression(state, right)
    if (convertedRight) return createNodeConditional(expression.left, convertedRight, null)
    return null
  }

  if (ts.isConditionalExpression(expression)) {
    if (!isDynamicNodeBranch(expression.whenTrue) || !isDynamicNodeBranch(expression.whenFalse)) {
      return null
    }
    const whenTrue = transformDynamicBranch(state, expression.whenTrue)
    const whenFalse = transformDynamicBranch(state, expression.whenFalse)
    if (!whenTrue && !whenFalse) return null
    return ts.factory.createConditionalExpression(
      expression.condition,
      ts.factory.createToken(ts.SyntaxKind.QuestionToken),
      whenTrue ?? ts.factory.createNull(),
      ts.factory.createToken(ts.SyntaxKind.ColonToken),
      whenFalse ?? ts.factory.createNull()
    )
  }

  return null
}

/**
 * Whether this branch is **guaranteed** to compile into a node factory.
 *
 * Only JSX, explicit null/false, and nested ternaries/`&&` whose every internal level satisfies this count.
 * List expressions (`.map`), text, and numbers never count — they must go to insertDynamicValue,
 * otherwise they would be written as a `null` branch and lost.
 */
function isDynamicNodeBranch(expression: ts.Expression): boolean {
  const branch = unwrapExpression(expression)
  if (isJsxExpression(branch)) return true
  if (branch.kind === ts.SyntaxKind.NullKeyword || branch.kind === ts.SyntaxKind.FalseKeyword) return true
  if (ts.isConditionalExpression(branch)) {
    return isDynamicNodeBranch(branch.whenTrue) && isDynamicNodeBranch(branch.whenFalse)
  }
  if (ts.isBinaryExpression(branch) && branch.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
    return isDynamicNodeBranch(branch.right)
  }
  return false
}

function createNodeConditional(
  condition: ts.Expression,
  whenTrue: ts.Expression,
  whenFalse: ts.Expression | null
): ts.ConditionalExpression {
  return ts.factory.createConditionalExpression(
    condition,
    ts.factory.createToken(ts.SyntaxKind.QuestionToken),
    whenTrue,
    ts.factory.createToken(ts.SyntaxKind.ColonToken),
    whenFalse ?? ts.factory.createNull()
  )
}

/**
 * Converts a single branch: JSX → node factory; null/false kept as-is; nested ternaries and `&&` dynamic
 * node expressions converted recursively (**every** branch of a nested ternary must be converted — missing one silently drops a branch).
 * Other expressions (strings, numbers, etc.) return null, and the caller falls back to a null branch.
 */
function transformDynamicBranch(state: CompileState, expression: ts.Expression): ts.Expression | null {
  const branch = unwrapExpression(expression)
  if (isJsxExpression(branch)) return transformJsxExpression(state, branch)
  if (branch.kind === ts.SyntaxKind.NullKeyword || branch.kind === ts.SyntaxKind.FalseKeyword) return branch
  if (ts.isConditionalExpression(branch)
    || (ts.isBinaryExpression(branch) && branch.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken)) {
    return convertDynamicNodeExpression(state, branch)
  }
  return null
}

/**
 * C232 root fix (2026-10-28): keyed lists inside ternary / `&&` branches — compiled to insertShow.
 *
 * cond and the list are split into two subscription layers: cond only manages container mount/unmount, while the list uses
 * standard insertList inside the container (keyed reuse/move), so cond flapping no longer rebuilds the whole list. Only shapes hit
 * by routeShowList are handled (a list branch + a null/false branch, including merged nested conditions); complex shapes mixing
 * nodes and lists return null and fall back to polymorphic insertion (the C232 warning keeps prompting a manual rewrite).
 */
function transformShowListExpression(
  state: CompileState,
  expression: ts.Expression
): { condition: ts.Expression; mount: ts.ArrowFunction } | null {
  const route = routeShowList(expression)
  if (route === null) return null
  const container = ts.factory.createUniqueName('showContainer')
  const list = transformListExpression(state, container, route.mapCall, ts.factory.createNull())
  if (list === null) return null
  const mountBody = ts.factory.createCallExpression(helperRef(state, 'insertList'), undefined, list)
  const mount = ts.factory.createArrowFunction(
    undefined,
    undefined,
    [ts.factory.createParameterDeclaration(undefined, undefined, container)],
    undefined,
    ts.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    mountBody
  )
  return { condition: route.condition ?? ts.factory.createTrue(), mount }
}

function transformListExpression(
  state: CompileState,
  parent: ts.Identifier,
  expression: ts.Expression,
  anchor: ts.Expression
): ts.Expression[] | null {
  if (!ts.isCallExpression(expression) || expression.arguments.length === 0) return null
  if (!ts.isPropertyAccessExpression(expression.expression) || expression.expression.name.text !== 'map') return null

  const callback = expression.arguments[0]
  if (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) return null

  // Callback body: a single JSX expression, or a block body with exactly one return
  const rawBody = ts.isBlock(callback.body) ? singleReturnExpression(callback.body) : unwrapExpression(callback.body)
  if (rawBody === null) {
    const reason = listDegradeReason(callback.body)
    if (reason !== null) reportListDegrade(state, expression, reason)
    return null
  }
  const body = unwrapExpression(rawBody)
  if (!isJsxExpression(body)) {
    return null
  }
  if (ts.isJsxFragment(body)) {
    reportListDegrade(state, expression, 'fragment')
    return null
  }

  const key = findKeyExpression(body)
  const renderItem = transformListCallback(callback, transformJsxExpression(state, body))
  const args: ts.Expression[] = [
    parent,
    anchor,
    createGetter(expression.expression.expression),
    renderItem
  ]
  if (key) args.push(createKeyCallback(callback, key))
  return args
}

function transformListCallback(
  callback: ts.ArrowFunction | ts.FunctionExpression,
  body: ts.Expression
): ts.Expression {
  if (ts.isArrowFunction(callback)) {
    return ts.factory.updateArrowFunction(
      callback,
      callback.modifiers,
      callback.typeParameters,
      callback.parameters,
      callback.type,
      callback.equalsGreaterThanToken,
      body
    )
  }

  return ts.factory.updateFunctionExpression(
    callback,
    callback.modifiers,
    callback.asteriskToken,
    callback.name,
    callback.typeParameters,
    callback.parameters,
    callback.type,
    ts.factory.createBlock([ts.factory.createReturnStatement(body)], true)
  )
}

function createKeyCallback(
  callback: ts.ArrowFunction | ts.FunctionExpression,
  key: ts.Expression
): ts.ArrowFunction {
  return ts.factory.createArrowFunction(
    undefined,
    undefined,
    callback.parameters,
    undefined,
    ts.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    key
  )
}

function findKeyExpression(node: ts.JsxElement | ts.JsxSelfClosingElement): ts.Expression | null {
  const attributes = ts.isJsxElement(node) ? node.openingElement.attributes : node.attributes
  for (const attribute of attributes.properties) {
    if (!ts.isJsxAttribute(attribute) || attribute.name.getText() !== 'key') continue
    if (attribute.initializer && ts.isJsxExpression(attribute.initializer)) {
      return attribute.initializer.expression ?? null
    }
  }
  return null
}

/**
 * Strips wrappers that have no effect on runtime value extraction: parentheses, `as` / `satisfies` assertions, non-null assertions.
 *
 * Missing an `as any` / `satisfies` (very common, added to silence type errors) makes the compiler fail to recognize the list,
 * silently degrading to polymorphic insertion — keyed reuse and key both stop working.
 */
function unwrapExpression(node: ts.Expression | ts.ConciseBody): ts.Expression {
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

/** "Exactly one return" in a block body → that expression; otherwise null. */
function singleReturnExpression(block: ts.Block): ts.Expression | null {
  if (block.statements.length !== 1) return null
  const only = block.statements[0]
  return ts.isReturnStatement(only) && only.expression !== undefined ? only.expression : null
}

/**
 * Why a list degraded — returns a reason only when it "looked like a list but was not recognized", for the warning.
 * Maps returning strings/numbers (`items.map(i => i.name)`) are not node lists to begin with and do not count as degradation.
 */
function listDegradeReason(body: ts.ConciseBody): 'fragment' | 'statements' | null {
  if (!ts.isBlock(body)) {
    const unwrapped = unwrapExpression(body)
    return ts.isJsxFragment(unwrapped) ? 'fragment' : null
  }
  const returns = body.statements.filter(ts.isReturnStatement)
  const returnsJsx = returns.some(item => item.expression !== undefined
    && isJsxExpression(unwrapExpression(item.expression)))
  if (!returnsJsx) return null
  return ts.isJsxFragment(unwrapExpression(returns[0].expression as ts.Expression)) ? 'fragment' : 'statements'
}

/**
 * List degradation warning.
 *
 * After degrading to polymorphic insertion **functionality still works**, but every item rebuilds every round and key + keyed reuse
 * stop working entirely — long-list performance drops by an order of magnitude with no hint whatsoever. This removes the silence (warn only; compilation is not blocked).
 */
function reportListDegrade(
  state: CompileState,
  call: ts.CallExpression,
  reason: 'fragment' | 'statements'
): void {
  const sourceFile = call.getSourceFile() ?? state.sourceFile
  if (!sourceFile) return
  const message = reason === 'fragment'
    ? 'The list item is a Fragment: this .map degrades to polymorphic insertion (every item rebuilt every round), and key + keyed reuse stop working entirely. Merge the Fragment content into a single element.'
    : 'The map callback body has multiple statements: the compiler only accepts "a single JSX expression" or "exactly one return", so this list degrades to polymorphic insertion and key + keyed reuse stop working entirely. Hoist computation out of the map, or make the callback body return a single element.'
  const { line, column, codeFrame } = buildCodeFrame(sourceFile, call.getStart(sourceFile), call.getWidth(sourceFile))
  state.diagnostics.push({
    code: 'VOBS_C103',
    severity: 'warning',
    message,
    location: { file: state.filename, line, column },
    codeFrame,
    fix: reason === 'fragment'
      ? `Replace the Fragment with a single element, e.g. <li>…</li> instead of <><li>…</li></>.`
      : `Rewrite the map callback as a single JSX expression (or exactly one return), moving computation outside the map.`
  })
}

function childToComponentExpression(state: CompileState, child: ts.JsxChild): ts.Expression[] {
  if (ts.isJsxText(child)) {
    const text = transformJsxText(child.text)
    return text !== '' ? [ts.factory.createStringLiteral(text)] : []
  }
  if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child) || ts.isJsxFragment(child)) {
    return [transformJsxExpression(state, child)]
  }
  if (child.kind === ts.SyntaxKind.JsxExpression) {
    const expression = (child as ts.JsxExpression).expression
    return expression ? [transformEmbeddedExpression(state, expression)] : []
  }
  return []
}

function propertyName(name: string): ts.PropertyName {
  return /^[$A-Z_a-z][$\w]*$/u.test(name)
    ? ts.factory.createIdentifier(name)
    : ts.factory.createStringLiteral(name)
}

function createGetter(expression: ts.Expression): ts.ArrowFunction {
  return ts.factory.createArrowFunction(
    undefined,
    undefined,
    [],
    undefined,
    ts.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    expression
  )
}

function createGetterProperty(name: string | ts.PropertyName, expression: ts.Expression): ts.GetAccessorDeclaration {
  return ts.factory.createGetAccessorDeclaration(
    undefined,
    typeof name === 'string' ? propertyName(name) : name,
    [],
    undefined,
    ts.factory.createBlock([ts.factory.createReturnStatement(expression)], true)
  )
}

function callStatement(state: CompileState, name: string, args: ts.Expression[], source?: ts.Node): ts.ExpressionStatement {
  const statement = ts.factory.createExpressionStatement(
    ts.factory.createCallExpression(helperRef(state, name), undefined, args)
  )
  return source ? tagStatement(state, statement, source) : statement
}

function createConstStatement(state: CompileState, name: ts.Identifier, initializer: ts.Expression, source?: ts.Node): ts.VariableStatement {
  const statement = ts.factory.createVariableStatement(
    undefined,
    ts.factory.createVariableDeclarationList([
      ts.factory.createVariableDeclaration(name, undefined, undefined, initializer)
    ], ts.NodeFlags.Const)
  )
  return source ? tagStatement(state, statement, source) : statement
}

/** Record where an emitted statement originated from, for source map generation. */
function tagStatement<T extends ts.Statement>(state: CompileState, statement: T, source: ts.Node): T {
  const position = positionOfNode(state, source)
  if (position) state.statementSources.set(statement, position)
  return statement
}

function positionOfNode(state: CompileState, node: ts.Node): SourcePosition | null {
  // Node copies produced by ts.transform may lose their sourceFile reference; fall back to the source file of the current compilation.
  const sourceFile = node.getSourceFile() ?? state.sourceFile
  if (!sourceFile || node.pos < 0) return null
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
  return { line, column: character }
}

function nextIdentifier(state: CompileState, prefix: string): ts.Identifier {
  let name: string
  do {
    name = `${prefix}${state.generatedId++}`
  } while (state.takenNames.has(name))
  return ts.factory.createIdentifier(name)
}
