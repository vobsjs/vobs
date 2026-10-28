import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import { analyzeSource, compile, compileWithSourceMap, createCompiler, createI18nExtractor, type CompilerPlugin } from './index'
import { VobsError } from '@vobs/runtime'

describe('compiler', () => {
  it('extracts static i18n keys, skipping dynamic keys', () => {
    const extractor = createI18nExtractor()
    compile(`
      const title = t('page.title')
      const label = i18n.t("common.label")
      const dynamic = t(key)
    `, { plugins: [extractor.plugin], filename: 'src/Page.tsx' })

    expect(extractor.getKeys()).toEqual(['common.label', 'page.title'])
  })
  it('parses JSX', () => {
    const code = `const el = <div>hello</div>`

    const result = compile(code)

    expect(result).toContain('div')
    expect(result).toContain('hello')
  })

  it('compiles JSX into DOM rendering calls', () => {
    const code = `const el = <div>hello {name.value}</div>`

    const result = compile(code)

    expect(result).toContain('createElement')
    expect(result).toContain('createText')
    expect(result).toContain('insertBefore')
  })

  it('compiles function components', () => {
    const code = `
  function Counter() {
    const count = state(0)
    return <div>hello {count.value}</div>
  }
  `

    const result = compile(code)

    expect(result).toContain('function Counter')
    expect(result).toContain('createElement')
  })
  
  it('compiles event bindings', () => {
    const code = `
  const el = <button onClick={() => { console.log('clicked') }}>点击</button>
  `

    const result = compile(code)

    expect(result).toContain('addEventListener')
    expect(result).toContain('click')
  })

  it('reentrancy: a plugin calling compile() mid-compilation does not pollute the outer compilation state', () => {
    // The outer source's variable names collide with helper names the inner snippet uses, verifying that takenNames/helperAliases
    // and similar state stay independent throughout the outer compilation (these used to be module-level variables; nested compilations overwrote each other).
    const nestedPlugin: CompilerPlugin = {
      name: 'nested-compile',
      analyze() {
        compile(`const el = () => <span>inner</span>`, { filename: 'inner.tsx' })
      }
    }
    const code = `
  const createElement = () => null
  const el = () => <div>outer {name.value}</div>
  `

    const result = compileWithSourceMap(code, {
      filename: 'outer.tsx',
      plugins: [nestedPlugin]
    })

    // The outer local binding createElement survives; the runtime helper is injected as an aliased import
    expect(result.code).toContain('const createElement = () => null')
    expect(result.code).toContain('_vobs_createElement')
    expect(result.code).toContain('outer')
    expect(result.diagnostics).toEqual([])
  })

  it('reentrancy: consecutive compilations stay independent; counters and aliases do not leak across compilations', () => {
    const first = compileWithSourceMap(`const a = () => <div className="x">{a.value}</div>`, { filename: 'a.tsx' })
    const second = compileWithSourceMap(`const b = () => <div className="y">{b.value}</div>`, { filename: 'b.tsx' })

    // The temporary-variable counter restarts at 0 for every compilation
    expect(first.code).toContain('_el0')
    expect(second.code).toContain('_el0')
    // The second compilation carries no diagnostics left over from the first
    expect(second.diagnostics).toEqual([])
  })

  it('merges static props into a single setStaticProps call', () => {
    const result = compile(`const el = <input className="field" disabled id="name" />`)
    expect(result).toContain('setStaticProps')
    expect(result).not.toContain('setAttribute(_el')
  })

  it('compiles dynamic text and attributes into getter bindings', () => {
    const result = compile(`const el = <input value={name.value}>{name.value}</input>`)

    expect(result).toContain('bindProperty')
    expect(result).toContain('() => name.value')
    // Child expressions uniformly go through insertDynamicValue polymorphic insertion (primitive values hit the text fast path at runtime)
    expect(result).toContain('insertDynamicValue')
  })

  it('compiles uppercase-initial tags into component instances', () => {
    const result = compile(`const el = <Counter value={count.value} />`)

    expect(result).toContain('createComponent(resolveComponent(Counter')
    expect(result).toContain('get value()')
  })

  it('keeps initializers of non-JSX declarations intact', () => {
    const result = compile(`function Counter() { const count = state(0); return <span>{count.value}</span> }`)

    expect(result).toContain('state(0)')
  })

  it('infers state() debugName automatically (uses the variable name when not passed explicitly)', () => {
    const result = compile(`import { state } from '@vobs/reactivity'\nconst username = state('')`)

    expect(result).toContain(`state('', "username")`)
  })

  it('infers debugName for aliased state imports too', () => {
    const result = compile(`import { state as signal } from '@vobs/reactivity'\nconst username = signal('')`)

    expect(result).toContain(`signal('', "username")`)
  })

  it('does not overwrite an explicitly passed debugName', () => {
    const result = compile(`import { state } from '@vobs/reactivity'\nconst username = state('', 'auth.name')`)

    expect(result).toContain(`state('', 'auth.name')`)
    expect(result).not.toContain('"username"')
  })

  it('does not infer debugName when state is shadowed by a local declaration', () => {
    const result = compile(`import { state } from '@vobs/reactivity'\nfunction state(value: unknown) { return value }\nconst username = state('')`)

    expect(result).toContain(`state('')`)
    expect(result).not.toContain('"username"')
  })

  it('does not infer debugName for non-state calls', () => {
    const result = compile(`const items = useState([])`)

    expect(result).toContain('useState([])')
  })

  it('compiles conditional JSX into a dynamic block', () => {
    const result = compile(`const el = <div>{show.value && <span>visible</span>}</div>`)

    expect(result).toContain('insertDynamic')
    expect(result).toContain('show.value ?')
  })

  it('compiles a JSX map into a keyed list', () => {
    const result = compile(`const el = <ul>{items.value.map(item => <li key={item.id}>{item.name}</li>)}</ul>`)

    expect(result).toContain('insertList')
    expect(result).toContain('() => items.value')
    expect(result).toContain('(item) => item.id')
    expect(result).not.toContain('setAttribute(_el2, "key"')
  })

  it('compiles every branch of a nested ternary (no longer keeps only the first branch)', () => {
    const result = compile(`const el = <div>{flag ? <A /> : other ? <B /> : <C />}</div>`)

    expect(result).toContain('insertDynamic')
    // All three branches compile into component calls
    expect(result.match(/createComponent\(resolveComponent/gu)).toHaveLength(3)
    expect(result).not.toContain('React')
  })

  it('compiles && combined with a nested dynamic node', () => {
    const result = compile(`const el = <div>{flag && (other ? <A /> : <B />)}</div>`)

    expect(result).toContain('insertDynamic')
    expect(result.match(/createComponent\(resolveComponent/gu)).toHaveLength(2)
  })

  it('compiles JSX early returns inside if blocks (no longer leaking into the React fallback path)', () => {
    const code = `
  function App() {
    if (items.value.length === 0) return <Empty />
    return <div><Footer /></div>
  }
  `
    const result = compile(code)

    // Both the early-return branch and the main return branch compile into vobs component calls; no JSX remains in the output
    expect(result.match(/createComponent\(resolveComponent/gu)).toHaveLength(2)
    expect(result).not.toContain('<Empty')
    expect(result).not.toContain('<Footer')
    expect(result).not.toContain('React')
  })

  it('compiles initializers inside function bodies and JSX in nested functions', () => {
    const code = `
  function App() {
    const render = () => <Inner />
    if (cond.value) { slot = <Aside /> }
    return <div>{render()}</div>
  }
  `
    const result = compile(code)

    expect(result.match(/createComponent\(resolveComponent/gu)).toHaveLength(2)
    expect(result).not.toContain('<Inner')
    expect(result).not.toContain('<Aside')
    expect(result).not.toContain('React')
  })

  it('hmrModuleId wraps module-top-level state into an HMR preservation ref', () => {
    const code = `import { state } from '@vobs/reactivity'
export const count = state(0)
function helper() {
  const local = state(1)
  return local.value
}
`
    const result = compile(code, { hmrModuleId: 'src/stores/counter.ts' })

    // The top-level declaration is wrapped; function-local declarations are untouched
    expect(result).toContain('hmrStateRef("src/stores/counter.ts#count"')
    expect(result).toContain('() => state(0, "count")')
    expect(result).not.toContain('hmrStateRef("src/stores/counter.ts#local"')
  })

  it('hmrModuleId keeps explicit debugNames and works with aliased imports', () => {
    const code = `import { state as st } from '@vobs/reactivity'
export const width = st(50, 'doc.width')
`
    const result = compile(code, { hmrModuleId: 'src/stores/doc.ts' })

    expect(result).toContain('hmrStateRef("src/stores/doc.ts#width"')
    expect(result).toContain("() => st(50, 'doc.width')")
  })

  it('runs the plugin analyze/program/node hooks before the JSX transform', () => {
    const filenames: string[] = []
    const plugin: CompilerPlugin = {
      name: 'replace-label',
      analyze(program, context) {
        filenames.push(`${context.filename}:${program.fileName}`)
        context.addRuntimeImport('pluginRuntime')
      },
      transform: {
        program(program, context) {
          const declaration = context.factory.createVariableStatement(
            undefined,
            context.factory.createVariableDeclarationList([
              context.factory.createVariableDeclaration(
                'enabled',
                undefined,
                undefined,
                context.factory.createTrue()
              )
            ], ts.NodeFlags.Const)
          )
          return context.factory.updateSourceFile(program, [declaration, ...program.statements])
        },
        node(node, context) {
          if (ts.isStringLiteral(node) && node.text === 'before') {
            return context.factory.createStringLiteral('after')
          }
          return node
        }
      }
    }

    const result = compile(`const label = 'before'; const el = <div>{label}</div>`, {
      filename: 'src/App.tsx',
      plugins: [plugin]
    })

    expect(filenames).toEqual(['src/App.tsx:src/App.tsx'])
    expect(result).toContain('pluginRuntime')
    expect(result).toContain('const enabled = true;')
    expect(result).toContain('const label = "after";')
  })

  it('supports createCompiler and the legacy transformNode hook', () => {
    const compiler = createCompiler({
      plugins: [{
        name: 'legacy-transform',
        transformNode(node, context) {
          if (ts.isIdentifier(node) && node.text === 'message') {
            return context.factory.createIdentifier('title')
          }
          return node
        }
      }]
    })

    expect(compiler.compile(`const el = <span>{message}</span>`)).toContain('() => title')
  })

  it('rejects duplicate compiler plugin names', () => {
    const plugins: CompilerPlugin[] = [{ name: 'duplicate' }, { name: 'duplicate' }]
    expect(() => compile(`const el = <div />`, { plugins })).toThrow('Duplicate plugin')
  })

  it('imports only the runtime helpers the generated code actually uses', () => {
    const result = compile(`const el = <div>hello</div>`)

    // Fully static subtrees are hoisted into templates: only createTemplate + cloneTemplate are needed
    expect(result).toContain('createTemplate')
    expect(result).toContain('cloneTemplate')
    expect(result).not.toContain('createElement')
    expect(result).not.toContain('insertBefore')
    expect(result).not.toContain('bindAttribute')
    expect(result).not.toContain('bindText')
    expect(result).not.toContain('insertDynamic')
    expect(result).not.toContain('insertList')
  })

  it('compiles a Fragment into an unwrapped node range', () => {
    const result = compile(`const el = <><span>one</span><span>two</span></>`)

    expect(result).toContain('createFragment')
    expect(result).toContain('insertBefore(_fragmentParent')
  })

  it('supports explicit Fragment and Vobs.Fragment spellings', () => {
    const explicit = compile(`const el = <Fragment><span>one</span><span>two</span></Fragment>`)
    const namespaced = compile(`const el = <Vobs.Fragment><span>one</span><span>two</span></Vobs.Fragment>`)
    expect(explicit).toContain('createFragment')
    expect(namespaced).toContain('createFragment')
    expect(namespaced).not.toContain('createElement("Vobs.Fragment")')
  })

  it('compiles JSX dynamic expressions uniformly into normalizable dynamic nodes', () => {
    const result = compile(`const content = <strong>ready</strong>; const el = <div>{content}</div>`)
    expect(result).toContain('insertDynamicValue')
    expect(result).toContain('() => content')
  })

  // Regression (Vobs Console pitfall memo): in `{cond ? <A/> : items.map(...)}`, the list branch
  // used to be written as a `null` branch and **vanish silently** — convertDynamicNodeExpression committed the
  // conditional tree as soon as one branch produced a node, turning the rest into null. Now, if any branch is not a node
  // expression (list, text, number, ...), the whole conditional falls back to insertDynamicValue polymorphic insertion.
  it('falls back to polymorphic insertion for non-node ternary branches instead of writing null', () => {
    const withList = compile(`const el = <div>{ok ? <span>empty</span> : items.map(i => <b key={i}>{i}</b>)}</div>`)
    expect(withList).toContain('insertDynamicValue')
    expect(withList).toContain('items.map(i =>')
    // Key point: the list branch must no longer be written as null
    expect(withList).not.toContain('? cloneTemplate(_tpl1) : null')
    expect(withList).not.toMatch(/\? cloneTemplate\([^)]*\) : null/u)

    const withText = compile(`const el = <div>{ok ? <i>icon</i> : label.value}</div>`)
    expect(withText).toContain('insertDynamicValue')
    expect(withText).toContain('label.value')
    expect(withText).not.toContain(': null')
  })

  it('still takes the insertDynamic fast path when every branch is a node', () => {
    const result = compile(`const el = <div>{ok ? <A/> : <B/>}</div>`)
    expect(result).toContain('insertDynamic(')
    expect(result).not.toContain('insertDynamicValue')
  })

  it('still compiles a list at a direct child position into a keyed insertList', () => {
    const result = compile(`const el = <div>{items.map(i => <b key={i}>{i}</b>)}</div>`)
    expect(result).toContain('insertList')
  })

  // Regression (Labelune pitfall memo): function calls at JSX child positions used to compile into bindText text bindings
  // (String(fragment) → "[object Object]"). Now every non-static child expression uniformly goes through
  // insertDynamicValue polymorphic insertion: value types are decided at runtime, so helpers returning nodes and
  // helpers returning strings like t('...') are equally safe.
  it('compiles function-call child expressions into insertDynamicValue polymorphic insertion (not text binding)', () => {
    const result = compile(`const el = <div>{renderSections(doc)}{t('greeting')}</div>`)
    expect(result).not.toContain('bindText')
    expect(result).toContain('insertDynamicValue')
    expect(result).toContain('() => renderSections(doc)')
    expect(result).toContain(`() => t('greeting')`)
  })

  // Regression (Labelune pitfall memo): user components passing children through used to render as "[object HTMLDivElement]".
  // children must compile into a getter returning a node/node array, and the {children} expression goes through
  // insertDynamicValue passing the node straight through; neither side may fall into the text serialization path.
  it('compiles children pass-through in user components into a node getter and direct node passing (no stringification)', () => {
    const result = compile(`
      function Section({ children }) {
        return <section>{children}</section>
      }
      const el = <Section><div class="inner">inner</div></Section>
    `)
    // Caller side: children is a getter whose value is the built node (the transformElement evaluation result / a hoisted clone)
    expect(result).toContain('get children()')
    expect(result).toContain('createComponent(')
    // Callee side: the {children} identifier expression passes the node straight through (insertDynamicValue), never createText(String(...))
    expect(result).toContain('insertDynamicValue')
    expect(result).toContain('() => children')
    expect(result).not.toContain('String(children)')
  })

  it('supports DOM spread and object styles', () => {
    const result = compile(`const props = { className: 'card' }; const el = <div {...props} style={{ backgroundColor: 'red' }} />`)
    // Spread now goes through a reactive binding (it used to be spreadProps applied once at creation)
    expect(result).toContain('bindSpreadProps')
    expect(result).toContain('bindAttribute')
  })

  it('compiles ResourceBoundary into an in-range resource boundary directive', () => {
    const result = compile(`
      const el = <ResourceBoundary resource={users} loading={<p>loading</p>}>
        <p>ready</p>
      </ResourceBoundary>
    `)

    expect(result).toContain('from "@vobs/resource"')
    expect(result).toContain('insertResourceBoundary')
    expect(result).toContain('createFragment')
    expect(result).toContain('loading: () =>')
    expect(result).not.toContain('createComponent(ResourceBoundary')
  })

  it('compiles ErrorBoundary into an in-range error boundary directive', () => {
    const result = compile(`
      const el = <ErrorBoundary fallback={(error, retry) => <button onClick={retry}>{error.message}</button>}>
        <p>ready</p>
      </ErrorBoundary>
    `)

    expect(result).toContain('insertErrorBoundary')
    expect(result).toContain('createFragment')
    expect(result).not.toContain('createComponent(ErrorBoundary')
  })

  // Regression (Labelune pitfall memo): residual JSX (early returns / nested branches the main transform missed) used to be transformed
  // after the runtime import and template declarations were generated, so the _tplN templates and insertDynamicValue
  // helpers it referenced never appeared in the final output, and the runtime threw "XXX is not defined".
  // Output self-check: every referenced _tplN must have a declaration, and every helper call must have a matching import.
  function assertNoDanglingReferences(result: string): void {
    const usedTemplates = [...result.matchAll(/_tpl\d+/gu)].map(match => match[0])
    const declaredTemplates = new Set([...result.matchAll(/const (_tpl\d+)\s*=/gu)].map(match => match[1]))
    for (const template of new Set(usedTemplates)) {
      expect(declaredTemplates.has(template), `referenced undeclared template ${template}`).toBe(true)
    }
    const runtimeHelpers = [
      'createElement', 'createText', 'createFragment', 'createTemplate', 'cloneTemplate',
      'insertBefore', 'insertDynamic', 'insertDynamicValue', 'insertList',
      'bindText', 'bindAttribute', 'bindProperty', 'setStaticProps', 'addEventListener', 'setRef'
    ]
    const importSection = result.slice(0, result.indexOf('@vobs/vobs'))
    for (const helper of runtimeHelpers) {
      const used = new RegExp(`\\b${helper}\\(`, 'u').test(result)
      if (used) expect(importSection.includes(helper), `called helper ${helper} without importing it`).toBe(true)
    }
  }

  it('ternary-branch JSX: template declarations and helper imports complete (residual transform runs before import generation)', () => {
    const result = compile(`
      const HINT = '未发现设备'
      function DiscoveryResults() {
        const list = results.value ?? []
        return list.length === 0 ? (
          <p class="hint">{HINT}</p>
        ) : (
          <div class="section">
            <h3>发现 {list.length} 个</h3>
            <p class="hint">{HINT}</p>
          </div>
        )
      }
    `)
    assertNoDanglingReferences(result)
  })

  it('early-return JSX: template declarations and helper imports complete (residual transform runs before import generation)', () => {
    const result = compile(`
      function DiscoveryResults() {
        if (list.length === 0) return <p class="hint">未发现设备</p>
        return <div class="section">发现 {list.length} 个</div>
      }
    `)
    assertNoDanglingReferences(result)
  })

  it('injects no import for source without runtime calls', () => {
    const result = compile(`export const version = '0.1.0'`)

    expect(result).not.toContain('@vobs/vobs')
  })

  it('injects an aliased import when the source already imports the same name', () => {
    const result = compile(`
      import { createElement } from './shim'
      export const tag = createElement('span')
      const el = <div>hello {name.value}</div>
    `)

    // The user's import and call stay untouched; the compiler helper goes through the alias, producing no duplicate declarations
    expect(result).toContain('import { createElement } from "./shim"')
    expect(result).toContain('createElement as _vobs_createElement')
    expect(result).toContain('from "@vobs/vobs"')
    expect(result).toContain('_vobs_createElement("div")')
    // The user's own call is kept verbatim (original quote style preserved)
    expect(result).toContain("createElement('span')")
  })

  it('injects an aliased import when a local declaration shares a helper name', () => {
    const result = compile(`
      const createText = (value: string) => value
      const el = <div>hello {name.value}</div>
    `)

    expect(result).toContain('createText as _vobs_createText')
    expect(result).toContain('from "@vobs/vobs"')
    expect(result).toContain('insertBefore(_el0, _vobs_createText("hello ")')
    // The user's local declaration is untouched
    expect(result).toContain('const createText = (value: string) => value')
  })

  it('same-named bindings in nested scopes also trigger the aliased import', () => {
    const result = compile(`
      export function Page() {
        const insertList = (items: unknown[]) => items.length
        const el = <ul>{[1, 2].map(item => <li key={item}>{item}</li>)}</ul>
        return { el, count: insertList([1, 2]) }
      }
    `)

    expect(result).toContain('insertList as _vobs_insertList')
    expect(result).toContain('from "@vobs/vobs"')
    expect(result).toContain('_vobs_insertList(')
    expect(result).toContain('const insertList = (items: unknown[]) => items.length')
  })

  it('keeps alias consistency when same-named bindings trigger aliasing (each helper injected once)', () => {
    const result = compile(`
      const createElement = String
      const el = <div><span>one {name.value}</span></div>
    `)

    expect(result.match(/_vobs_createElement/g)?.length).toBeGreaterThanOrEqual(2)
    // The import alias declaration appears exactly once, and output references match it
    expect(result.match(/ as _vobs_createElement/g)?.length).toBe(1)
  })

  it('generates temporary variables that avoid user-declared names', () => {
    const result = compile(`
      const _el0 = 'reserved'
      const el = <div>hello {name.value}</div>
    `)

    // _el0 is taken by the user, so the output must use the next available name
    expect(result).toContain('const _el1 = createElement("div")')
    expect(result).not.toContain('const _el0 = createElement')
  })

  it('keeps JSX expressions in component children lazy and compiles them recursively', () => {
    const result = compile(`
      const el = <Layout>{show.value && <Panel>{title.value}</Panel>}</Layout>
    `)

    expect(result).toContain('get children()')
    expect(result).toContain('show.value && createComponent(resolveComponent(Panel')
    expect(result).toContain('return title.value')
    expect(result).not.toContain('<Panel>')
  })

  it('keeps JSX slots in component props lazy and compiles them recursively', () => {
    const result = compile(`
      const el = <Button icon={<Icon name="search" />}>Search</Button>
    `)

    expect(result).toContain('get icon()')
    expect(result).toContain('createComponent(resolveComponent(Icon')
    expect(result).not.toContain('<Icon')
  })

  it('uses bindProperty for dynamic DOM properties and emits component source locations', () => {
    const result = compile(`
      const el = <Editor><input disabled={locked.value} value={text.value} /></Editor>
    `, { filename: 'src/editor.tsx' })

    expect(result).toContain('bindProperty')
    expect(result).toContain('"disabled"')
    expect(result).toContain('"value"')
    expect(result).toContain('file: "src/editor.tsx"')
    expect(result).toContain('line: 2')
  })

  it('sourceLocation: false strips component source locations', () => {
    const result = compile(`
      const el = <Editor><input disabled={locked.value} value={text.value} /></Editor>
    `, { filename: 'src/editor.tsx', sourceLocation: false })

    expect(result).toContain('createComponent')
    expect(result).not.toContain('file:')
    expect(result).not.toContain('line:')
    expect(result).not.toContain('column:')
  })

  it('generates a Source Map carrying the original content', () => {
    const result = compileWithSourceMap(`const el = <div>hello</div>`, { filename: 'src/App.tsx' })

    expect(result.map.version).toBe(3)
    expect(result.map.sources).toEqual(['src/App.tsx'])
    expect(result.map.sourcesContent).toEqual(['const el = <div>hello</div>'])
    expect(result.map.mappings.split(';').length).toBe(result.code.split('\n').length)
  })

  it('Source Map maps to real source positions (statement level)', () => {
    const source = [
      `import { state } from '@vobs/vobs'`,
      ``,
      `export function Counter() {`,
      `  const count = state(0)`,
      `  return (`,
      `    <div class="c" onClick={() => count.value++}>`,
      `      {count.value}`,
      `    </div>`,
      `  )`,
      `}`
    ].join('\n')
    const { code, map } = compileWithSourceMap(source, { filename: 'src/Counter.tsx' })
    const codeLines = code.split('\n')
    const segments = decodeMappings(map.mappings)
    expect(segments.length).toBeGreaterThan(0)

    // Generated line numbers must fall within the output range
    for (const segment of segments) {
      expect(segment.genLine).toBeLessThan(codeLines.length)
      expect(segment.srcLine).toBeLessThan(source.split('\n').length)
    }

    // The user's own statements map 1:1
    expect(findSourceLine(segments, codeLines, 'const count')).toBe(3)
    // JSX elements and attributes map back to the tag's line (including columns)
    expect(findSourceLine(segments, codeLines, 'createElement("div")')).toBe(5)
    expect(findSourceLine(segments, codeLines, 'addEventListener(')).toBe(5)
    // Dynamic child-expression insertion inside the IIFE maps back to the expression child's line
    expect(findSourceLine(segments, codeLines, 'insertDynamicValue(')).toBe(6)
    // The injected import produces no bogus mappings
    const importLine = codeLines.findIndex(line => line.startsWith('import { createElement'))
    expect(segments.some(segment => segment.genLine === importLine)).toBe(false)
  })

  it('Source Map covers list statements inside nested function bodies', () => {
    const source = [
      `const items = []`,
      `function List() {`,
      `  return <ul>{items.map(item => <li key={item.id}>{item.name}</li>)}</ul>`,
      `}`
    ].join('\n')
    const { code, map } = compileWithSourceMap(source, { filename: 'src/List.tsx' })
    const codeLines = code.split('\n')
    const segments = decodeMappings(map.mappings)
    expect(findSourceLine(segments, codeLines, 'insertList(')).toBe(2)
    expect(findSourceLine(segments, codeLines, 'createElement("li")')).toBe(2)
  })

  it('returns structured compile diagnostics and throws VobsError from compile', () => {
    const result = compileWithSourceMap('const el = <div>', { filename: 'src/Broken.tsx' })
    expect(result.diagnostics.length).toBeGreaterThan(0)
    expect(result.diagnostics[0]).toMatchObject({
      severity: 'error',
      location: { file: 'src/Broken.tsx' }
    })
    expect(() => compile('const el = <div>', { filename: 'src/Broken.tsx' })).toThrow(VobsError)
  })

  it('member-expression tags produce a VOBS_C101 diagnostic', () => {
    const result = compileWithSourceMap(`const el = <Foo.Bar />`, { filename: 'src/Member.tsx' })
    const diagnostic = result.diagnostics.find(item => item.code === 'VOBS_C101')

    expect(diagnostic).toBeDefined()
    expect(diagnostic?.severity).toBe('error')
    expect(diagnostic?.message).toContain('Foo.Bar')
    expect(diagnostic?.location).toMatchObject({ file: 'src/Member.tsx', line: 1 })
    expect(diagnostic?.codeFrame).toContain('Foo.Bar')
    expect(diagnostic?.fix).toContain('<Component />')
    expect(() => compile(`const el = <Foo.Bar />`)).toThrow(VobsError)
  })

  it('namespaced tags produce a VOBS_C101 diagnostic', () => {
    const result = compileWithSourceMap(`const el = <svg:rect width="1" />`)
    const diagnostic = result.diagnostics.find(item => item.code === 'VOBS_C101')

    expect(diagnostic).toBeDefined()
    expect(diagnostic?.message).toContain('svg:rect')
    expect(diagnostic?.message).toContain('namespaced tag')
    expect(() => compile(`const el = <svg:rect width="1" />`)).toThrow(VobsError)
  })

  /*
   * Event names. The original implementation was an unconditional `name.slice(2).toLowerCase()`:
   * onDoubleClick bound to the nonexistent "doubleclick", once bound to "ce",
   * both silently broken — the callback never fires and nothing reports an error.
   */
  it('compiles onDoubleClick into dblclick (the DOM has no doubleclick event)', () => {
    const result = compileWithSourceMap(`const el = <div onDoubleClick={fn}>x</div>`)

    expect(result.code).toContain('"dblclick"')
    expect(result.code).not.toContain('doubleclick')
    expect(result.diagnostics.filter(item => item.code === 'VOBS_C102')).toEqual([])
  })

  it('normalizes onDblClick to dblclick as well', () => {
    expect(compileWithSourceMap(`const el = <div onDblClick={fn}>x</div>`).code).toContain('"dblclick"')
  })

  it('reports a VOBS_C102 error for attributes like once ("on + non-uppercase", not a known event)', () => {
    const result = compileWithSourceMap(`const el = <div once={fn}>x</div>`, { filename: 'src/Once.tsx' })
    const diagnostic = result.diagnostics.find(item => item.code === 'VOBS_C102')

    expect(diagnostic).toBeDefined()
    expect(diagnostic?.severity).toBe('error')
    expect(diagnostic?.message).toContain('"ce"')
    expect(diagnostic?.location).toMatchObject({ file: 'src/Once.tsx', line: 1 })
    expect(diagnostic?.codeFrame).toContain('once')
    expect(diagnostic?.fix).toContain('uppercase')
    expect(() => compile(`const el = <div once={fn}>x</div>`)).toThrow(VobsError)
  })

  it('onclick works but gets a warning (lowercase only happens to match)', () => {
    const result = compileWithSourceMap(`const el = <div onclick={fn}>x</div>`)
    const diagnostic = result.diagnostics.find(item => item.code === 'VOBS_C102')

    expect(result.code).toContain('"click"')
    expect(diagnostic?.severity).toBe('warning')
    expect(diagnostic?.fix).toContain('onClick')
  })

  it('warns instead of erroring on unknown event names (custom events must keep working)', () => {
    const result = compileWithSourceMap(`const el = <div onFoo={fn}>x</div>`)
    const diagnostic = result.diagnostics.find(item => item.code === 'VOBS_C102')

    expect(result.code).toContain('"foo"')
    expect(diagnostic?.severity).toBe('warning')
    expect(diagnostic?.message).toContain('custom event')
  })

  it('produces no diagnostics for ordinary event attributes', () => {
    const result = compileWithSourceMap(`const el = <input onClick={a} onKeyDown={b} onPointerEnter={c} />`)
    expect(result.diagnostics.filter(item => item.code === 'VOBS_C102')).toEqual([])
  })

  /*
   * Whitespace normalization for JSX text.
   *
   * All three places used to run `replace(/\s+/g, ' ').trimStart()`, deleting that **legitimate space** between elements:
   * <p><b>a</b> <i>b</i></p> rendered as "ab", while React / Solid render "a b".
   * The repo happened to contain no such code, so no test ever covered it.
   */
  describe('JSX text whitespace', () => {
    it('keeps the single space between elements (also after hoisting into a template)', () => {
      const code = compileWithSourceMap(`const el = <p><b>a</b> <i>b</i></p>`).code
      expect(code).toContain('<p><b>a</b> <i>b</i></p>')
    })

    it('keeps no space where there was none', () => {
      const code = compileWithSourceMap(`const el = <p><b>a</b><i>b</i></p>`).code
      expect(code).toContain('<p><b>a</b><i>b</i></p>')
      expect(code).not.toContain('<b>a</b> <i>')
    })

    it('keeps multiple spaces as-is', () => {
      expect(compileWithSourceMap(`const el = <p><b>a</b>   <i>b</i></p>`).code)
        .toContain('<b>a</b>   <i>')
    })

    it('eats line breaks and indentation (matching React)', () => {
      const code = compileWithSourceMap(`const el = <p>\n  <b>a</b>\n  <i>b</i>\n</p>`).code
      expect(code).toContain('<p><b>a</b><i>b</i></p>')
    })

    it('turns the space between expressions into a real text node', () => {
      const code = compileWithSourceMap(`const el = <p>{x} {y}</p>`).code
      expect(code).toContain('createText(" ")')
    })

    it('eats spaces between text and expressions only when line breaks are present', () => {
      expect(compileWithSourceMap(`const el = <p>a {x}</p>`).code).toContain('createText("a ")')
      expect(compileWithSourceMap(`const el = <p>{x} b</p>`).code).toContain('createText(" b")')
      expect(compileWithSourceMap(`const el = <p>\n  {x}\n  {y}\n</p>`).code).not.toContain('createText(" ")')
    })
  })

  /*
   * SVG subtrees must not be hoisted into templates: templates go through the HTML parser, where `<g>`/`<rect>` become
   * HTMLUnknownElement — wrong namespace, the whole graphic never renders and nothing errors.
   * The createElement path (ops.ts's isSvgTag) was right all along; only hoisting missed it.
   */
  describe('static SVG is not hoisted into templates', () => {
    it('static subtrees inside svg go through createElement', () => {
      const code = compileWithSourceMap(`const el = <svg width={w}><g><rect width="4" /></g></svg>`).code
      expect(code).not.toContain('createTemplate')
      expect(code).toContain('createElement("g")')
      expect(code).toContain('createElement("rect")')
    })

    it('svg nested inside an HTML shell is not hoisted either', () => {
      const code = compileWithSourceMap(`const el = <div><svg><circle r="4" /></svg></div>`).code
      expect(code).not.toContain('createTemplate')
      expect(code).toContain('createElement("svg")')
      expect(code).toContain('createElement("circle")')
    })

    it('pure HTML subtrees still hoist (performance unaffected)', () => {
      expect(compileWithSourceMap(`const el = <div><span>hi</span></div>`).code)
        .toContain('createTemplate("<div><span>hi</span></div>")')
      expect(compileWithSourceMap(`const el = <p><b>a</b></p>`).code).toContain('createTemplate')
    })
  })

  /*
   * List detection.
   *
   * Failing to recognize a `.map` silently degrades to polymorphic insertion: functionality still works, but every item
   * rebuilds every round and key + keyed reuse stop working entirely, with **no hint whatsoever**. This relaxes the shapes that
   * can be safely supported, and warns on the ones genuinely impossible (Fragment bodies, multi-statement blocks).
   */
  describe('list detection', () => {
    const listCode = (source: string) => compileWithSourceMap(source, { filename: 'a.tsx' })

    it('an as assertion on the callback body no longer hides the list', () => {
      const code = listCode(`const el = <ul>{items.map(item => (<li>{item}</li>) as any)}</ul>`).code
      // The list itself goes through insertList (contrast: on degradation the whole items goes to insertDynamicValue)
      expect(code).toContain('insertList(')
      expect(code).not.toMatch(/insertDynamicValue\(_el\w+, null, \(\) => items/)
    })

    it('a block body with exactly one return also counts as a list', () => {
      const code = listCode(`const el = <ul>{items.map(item => { return <li>{item}</li> })}</ul>`).code
      expect(code).toContain('insertList(')
    })

    it('a map with thisArg still counts as a list', () => {
      const code = listCode(`const el = <ul>{items.map(item => <li>{item}</li>, this)}</ul>`).code
      expect(code).toContain('insertList(')
    })

    it('a Fragment body degrades to polymorphic insertion and warns VOBS_C103', () => {
      const result = listCode(`const el = <ul>{items.map(item => <><li>{item}</li></>)}</ul>`)
      const diagnostic = result.diagnostics.find(item => item.code === 'VOBS_C103')

      // The degradation test is "no insertList" — insertDynamicValue also appears in normal lists (text binding inside list items)
      expect(result.code).not.toContain('insertList(')
      expect(diagnostic?.severity).toBe('warning')
      expect(diagnostic?.message).toContain('Fragment')
      expect(diagnostic?.fix).toContain('Fragment')
    })

    it('a multi-statement block body warns VOBS_C103', () => {
      const result = listCode(`const el = <ul>{items.map(item => { const n = item; return <li>{n}</li> })}</ul>`)
      const diagnostic = result.diagnostics.find(item => item.code === 'VOBS_C103')

      expect(diagnostic?.severity).toBe('warning')
      expect(diagnostic?.message).toContain('multiple statements')
      expect(result.diagnostics.every(item => item.severity === 'warning')).toBe(true)
    })

    it('a string-returning map is not a list and raises no warning', () => {
      const result = listCode(`const el = <ul>{items.map(item => item.name)}</ul>`)
      expect(result.diagnostics.filter(item => item.code === 'VOBS_C103')).toEqual([])
    })

    it('a normal list produces no diagnostics', () => {
      const result = listCode(`const el = () => <ul>{items.map(item => <li key={item.id}>{item.name}</li>)}</ul>`)
      expect(result.code).toContain('insertList(')
      expect(result.diagnostics).toEqual([])
    })
  })

  /*
   * Diagnostic quality: reporting only the first error at a time is the most time-wasting shape — with 5 errors in a file you
   * build 5 times to see the whole picture. A boundary component missing a prop used to throw directly (without even a location),
   * which turned the non-throwing compileWithSourceMap into a throwing API too.
   */
  describe('diagnostic quality', () => {
    it('compile() lists all errors in the same file at once', () => {
      const source = `const a = <div once={fn}>x</div>\nconst b = <Foo.Bar />`
      let message = ''
      try {
        compile(source, { filename: 'src/Many.tsx' })
      } catch (error) {
        message = String((error as Error).message)
      }

      expect(message).toContain('"ce"')
      expect(message).toContain('more error(s) in the same file')
      expect(message).toContain('VOBS_C101')
      expect(message).toContain('src/Many.tsx:2')
    })

    it('a boundary component missing a prop returns a located diagnostic instead of throwing', () => {
      const cases: readonly [string, string][] = [
        ['const a = <ErrorBoundary>hi</ErrorBoundary>', 'fallback'],
        ['const a = <AsyncBoundary>x</AsyncBoundary>', 'promise'],
        ['const a = <ResourceBoundary>x</ResourceBoundary>', 'resource']
      ]
      for (const [source, prop] of cases) {
        const result = compileWithSourceMap(source, { filename: 'src/B.tsx' })
        const diagnostic = result.diagnostics.find(item => item.code === 'VOBS_C002')

        expect(diagnostic, source).toBeDefined()
        expect(diagnostic?.severity).toBe('error')
        expect(diagnostic?.message).toContain(prop)
        expect(diagnostic?.location).toMatchObject({ file: 'src/B.tsx', line: 1 })
        expect(diagnostic?.fix).toContain(prop)
      }
    })

    it('the codeFrame caret aligns by display width (tabs no longer skew the ^)', () => {
      const source = 'const a = <div>\n\t\t<div once={fn}>x</div>\n</div>'
      const diagnostic = compileWithSourceMap(source, { filename: 'src/Tab.tsx' })
        .diagnostics.find(item => item.code === 'VOBS_C102')

      const [codeLine, caretLine] = (diagnostic?.codeFrame ?? '').split('\n')
      expect(codeLine).toBeDefined()
      // After tab expansion the ^ must land on once's start column
      const markerColumn = caretLine.indexOf('^')
      const onceColumn = codeLine.indexOf('once')
      expect(markerColumn).toBe(onceColumn)
    })
  })

  it('lowercase member-expression tags are rejected too', () => {
    const result = compileWithSourceMap(`const el = <foo.bar />`)
    expect(result.diagnostics.find(item => item.code === 'VOBS_C101')).toBeDefined()
  })

  it('the Fragment member-expression shape stays supported', () => {
    const result = compileWithSourceMap(`const el = <Vobs.Fragment><span>one</span></Vobs.Fragment>`)

    expect(result.diagnostics.filter(item => item.severity === 'error')).toHaveLength(0)
  })

  it('diagnostics come back stably from compileWithSourceMap (output structure unchanged)', () => {
    const result = compileWithSourceMap(`const el = <Foo.Bar />`)

    // Diagnostics are reported while the output stays printable, for source map pairing and debugging
    expect(result.code).toContain('createElement("Foo.Bar")')
    expect(result.map).toBeDefined()
  })

  describe('C232 root fix: keyed lists in ternary/&& branches route to insertShow (2026-10-28)', () => {
    it('compiles cond ? list : null into a conditional container + in-container insertList', () => {
      const result = compile(`const el = <div>{open.value ? items.value.map(i => <span key={i}>{i}</span>) : null}</div>`)
      expect(result).toContain('insertShow')
      expect(result).toContain('insertList')
      // Condition and list are two subscription layers: cond only appears in insertShow's condition getter
      expect(result).toMatch(/insertShow\([^)]*\(\) => open\.value/)
    })

    it('routes cond && list to insertShow too (condition = the left expression)', () => {
      const result = compile(`const el = <ul>{open.value && items.value.map(i => <li key={i} />)}</ul>`)
      expect(result).toContain('insertShow')
      expect(result).toContain('insertList')
    })

    it('negates the condition when the list sits in the false branch', () => {
      const result = compile(`const el = <div>{open.value ? null : items.value.map(i => <li key={i} />)}</div>`)
      expect(result).toContain('insertShow')
      expect(result).toContain('!open.value')
    })

    it('merges nested condition chains (cond ? (x ? list : null) : null)', () => {
      const result = compile(`const el = <div>{open.value ? (ready.value ? items.value.map(i => <li key={i} />) : null) : null}</div>`)
      expect(result).toContain('insertShow')
      expect(result).toContain('insertList')
    })

    it('keeps polymorphic insertion for mixed shapes (node and list branches), not routing insertShow', () => {
      const result = compile(`const el = <div>{open.value ? <b>x</b> : items.value.map(i => <li key={i} />)}</div>`)
      expect(result).not.toContain('insertShow')
      expect(result).toContain('insertDynamicValue')
    })

    it('a string map (non-JSX output) does not go through insertShow', () => {
      const result = compile(`const el = <div>{open.value ? items.value.map(i => i.name) : null}</div>`)
      expect(result).not.toContain('insertShow')
    })
  })

  describe('the C232 analyzer is isomorphic with the insertShow routing (2026-10-28)', () => {
    it('simple shapes no longer report C232 (already routed by the compiler)', () => {
      const diagnostics = analyzeSource(
        `const el = <div>{open.value ? items.value.map(i => <span key={i} />) : null}</div>`,
        'src/Show.tsx'
      )
      expect(diagnostics.filter(d => d.code === 'VOBS_C232')).toHaveLength(0)
    })

    it('&& shapes no longer report C232', () => {
      const diagnostics = analyzeSource(
        `const el = <div>{open.value && items.value.map(i => <span key={i} />)}</div>`,
        'src/Show.tsx'
      )
      expect(diagnostics.filter(d => d.code === 'VOBS_C232')).toHaveLength(0)
    })

    it('mixed shapes still report C232 (the compiler cannot safely rewrite them)', () => {
      const diagnostics = analyzeSource(
        `const el = <div>{open.value ? <b>x</b> : items.value.map(i => <span key={i} />)}</div>`,
        'src/Show.tsx'
      )
      expect(diagnostics.filter(d => d.code === 'VOBS_C232')).toHaveLength(1)
    })
  })

  describe('C118 enhancement: props property assigned straight to a local = run-once snapshot (deadly sin §4, 2026-10-28)', () => {
    it('const st = props.state used directly in JSX → reports the snapshot', () => {
      const diagnostics = analyzeSource(
        `export function P(props){ const st = props.state; return <div>{st}</div> }`,
        'src/Facade.tsx'
      )
      const hit = diagnostics.find(d => d.code === 'VOBS_C118')
      expect(hit).toBeDefined()
      expect(hit?.message).toContain('props')
      expect(hit?.fix).toContain('() => props.')
    })

    it('getter-form call {st()} does not report (the correct form)', () => {
      const diagnostics = analyzeSource(
        `export function P(props){ const st = () => props.state; return <div>{st()}</div> }`,
        'src/Facade.tsx'
      )
      expect(diagnostics.filter(d => d.code === 'VOBS_C118')).toHaveLength(0)
    })

    it('stored but unused in JSX → no report', () => {
      const diagnostics = analyzeSource(
        `export function P(props){ const st = props.state; return <div>ok</div> }`,
        'src/Facade.tsx'
      )
      expect(diagnostics.filter(d => d.code === 'VOBS_C118')).toHaveLength(0)
    })

    it('member reads without the props prefix are unaffected (e.g. config.state)', () => {
      const diagnostics = analyzeSource(
        `export function P(){ const st = config.state; return <div>{st}</div> }`,
        'src/Facade.tsx'
      )
      expect(diagnostics.filter(d => d.code === 'VOBS_C118' && d.message.includes('props'))).toHaveLength(0)
    })
  })
})

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const CHAR_TO_INT = new Map([...BASE64].map((char, index) => [char, index] as const))

interface MappingSegment {
  genLine: number
  genCol: number
  srcLine: number
  srcCol: number
}

function decodeVlq(segment: string): number[] {
  const values: number[] = []
  let shift = 0
  let value = 0
  for (const char of segment) {
    const digit = CHAR_TO_INT.get(char)
    if (digit === undefined) throw new Error(`invalid VLQ char: ${char}`)
    value += (digit & 31) << shift
    if (digit & 32) {
      shift += 5
    } else {
      const negate = value & 1
      value >>= 1
      values.push(negate ? -value : value)
      shift = 0
      value = 0
    }
  }
  return values
}

function decodeMappings(mappings: string): MappingSegment[] {
  const segments: MappingSegment[] = []
  let srcLine = 0
  let srcCol = 0
  mappings.split(';').forEach((line, genLine) => {
    let genCol = 0
    for (const segment of line.split(',')) {
      if (!segment) continue
      const [genColDelta, , srcLineDelta, srcColDelta] = decodeVlq(segment)
      genCol += genColDelta
      srcLine += srcLineDelta
      srcCol += srcColDelta
      segments.push({ genLine, genCol, srcLine, srcCol })
    }
  })
  return segments
}

function findSourceLine(segments: MappingSegment[], codeLines: string[], needle: string): number {
  const genLine = codeLines.findIndex(line => line.includes(needle))
  expect(genLine).toBeGreaterThan(-1)
  const mapping = segments.find(segment => segment.genLine === genLine)
  expect(mapping).toBeDefined()
  return mapping!.srcLine
}

  /*
   * SVG namespace inheritance.
   *
   * Deciding the namespace by tag name alone cannot work: a / title / style / script share their names with HTML,
   * and inside <svg> they must be SVG elements. Judging by name builds an HTML anchor — it renders nothing and reports
   * nothing (a known issue the CHANGELOG admits to). The compiler knows the ancestor chain, so it specifies explicitly.
   */
  describe('SVG namespace inheritance', () => {
    it('a / title inside SVG go explicitly through createSvgElement', () => {
      const a = compileWithSourceMap(`const el = <svg><a href="/x">link</a></svg>`).code
      expect(a).toContain('createSvgElement("a")')
      const title = compileWithSourceMap(`const el = <svg><title>t</title></svg>`).code
      expect(title).toContain('createSvgElement("title")')
    })

    it('inherits through one level (<svg><g><a>)', () => {
      expect(compileWithSourceMap(`const el = <svg><g><a href="/y">n</a></g></svg>`).code)
        .toContain('createSvgElement("a")')
    })

    it('foreignObject switches the subtree back to HTML', () => {
      const code = compileWithSourceMap(`const el = <svg><foreignObject><a href="/z">h</a></foreignObject></svg>`).code
      expect(code).not.toContain('createSvgElement("a")')
    })

    it('a in ordinary HTML is unaffected', () => {
      expect(compileWithSourceMap(`const el = <div><a href="/w">h</a></div>`).code).not.toContain('createSvgElement')
    })

    it('SVG subtrees never get static hoisting (templates use the HTML parser)', () => {
      // <a> is itself static; hoisted into a template it would clone an HTML anchor
      expect(compileWithSourceMap(`const el = <svg><a href="/x">link</a></svg>`).code).not.toContain('createTemplate')
    })
  })

  /*
   * The `{...props}` spread must be reactive.
   *
   * It used to emit only spreadProps (applied once at creation): changing props had no effect and deleted keys stayed
   * on the DOM, neither erroring. Now it emits bindSpreadProps (incremental application each round + removal of vanished keys).
   */
  describe('{...props} spread', () => {
    it('emits bindSpreadProps instead of the one-shot spreadProps', () => {
      const code = compileWithSourceMap(`const el = <div {...props}>x</div>`).code
      expect(code).toContain('bindSpreadProps(')
      expect(code).not.toMatch(/[^d]spreadProps\(/)
    })

    it('goes through binding when static props coexist with a spread', () => {
      const code = compileWithSourceMap(`const el = <div id="a" {...props}>x</div>`).code
      expect(code).toContain('bindSpreadProps(')
      expect(code).toContain('"a"')
    })

    it('emits nothing without a spread', () => {
      expect(compileWithSourceMap(`const el = <div id="a">x</div>`).code).not.toContain('bindSpreadProps')
    })
  })
