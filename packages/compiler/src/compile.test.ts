import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import { compile, compileWithSourceMap, createCompiler, createI18nExtractor, type CompilerPlugin } from './index'
import { VobsError } from '@vobs/runtime'

describe('compiler', () => {
  it('提取静态 i18n key，不提取动态 key', () => {
    const extractor = createI18nExtractor()
    compile(`
      const title = t('page.title')
      const label = i18n.t("common.label")
      const dynamic = t(key)
    `, { plugins: [extractor.plugin], filename: 'src/Page.tsx' })

    expect(extractor.getKeys()).toEqual(['common.label', 'page.title'])
  })
  it('解析 JSX', () => {
    const code = `const el = <div>hello</div>`

    const result = compile(code)

    expect(result).toContain('div')
    expect(result).toContain('hello')
  })

  it('编译 JSX 为 DOM 渲染调用', () => {
    const code = `const el = <div>hello {name.value}</div>`

    const result = compile(code)

    expect(result).toContain('createElement')
    expect(result).toContain('createText')
    expect(result).toContain('insertBefore')
  })

  it('编译函数组件', () => {
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
  
  it('编译事件绑定', () => {
    const code = `
  const el = <button onClick={() => { console.log('clicked') }}>点击</button>
  `

    const result = compile(code)

    expect(result).toContain('addEventListener')
    expect(result).toContain('click')
  })

  it('重入安全：插件在编译过程中调用 compile() 不污染外层编译状态', () => {
    // 外层源码的变量名会命中内层片段用到的 helper 名，验证 takenNames/helperAliases
    // 等状态在外层编译全程保持独立（此前为模块级变量，嵌套编译会互相覆盖）。
    const nestedPlugin: CompilerPlugin = {
      name: 'nested-compile',
      analyze() {
        compile(`const el = <span>inner</span>`, { filename: 'inner.tsx' })
      }
    }
    const code = `
  const createElement = () => null
  const el = <div>outer {name.value}</div>
  `

    const result = compileWithSourceMap(code, {
      filename: 'outer.tsx',
      plugins: [nestedPlugin]
    })

    // 外层的局部绑定 createElement 仍在，运行时 helper 注入为别名导入
    expect(result.code).toContain('const createElement = () => null')
    expect(result.code).toContain('_vobs_createElement')
    expect(result.code).toContain('outer')
    expect(result.diagnostics).toEqual([])
  })

  it('重入安全：连续多次编译各自独立，计数器与别名不跨编译泄漏', () => {
    const first = compileWithSourceMap(`const a = <div className="x">{a.value}</div>`, { filename: 'a.tsx' })
    const second = compileWithSourceMap(`const b = <div className="y">{b.value}</div>`, { filename: 'b.tsx' })

    // 临时变量计数器每次编译从 0 开始
    expect(first.code).toContain('_el0')
    expect(second.code).toContain('_el0')
    // 第二次编译不带第一次残留的诊断
    expect(second.diagnostics).toEqual([])
  })

  it('将静态属性合并为一次 setStaticProps 调用', () => {
    const result = compile(`const el = <input className="field" disabled id="name" />`)
    expect(result).toContain('setStaticProps')
    expect(result).not.toContain('setAttribute(_el')
  })

  it('将动态文本和属性编译为 getter 绑定', () => {
    const result = compile(`const el = <input value={name.value}>{name.value}</input>`)

    expect(result).toContain('bindProperty')
    expect(result).toContain('() => name.value')
    expect(result).toContain('bindText')
  })

  it('将首字母大写的标签编译为组件实例', () => {
    const result = compile(`const el = <Counter value={count.value} />`)

    expect(result).toContain('createComponent(resolveComponent(Counter')
    expect(result).toContain('get value()')
  })

  it('保留非 JSX 声明的初始化参数', () => {
    const result = compile(`function Counter() { const count = state(0); return <span>{count.value}</span> }`)

    expect(result).toContain('state(0)')
  })

  it('自动推断 state() 的 debugName（未显式传参时使用变量名）', () => {
    const result = compile(`import { state } from '@vobs/reactivity'\nconst username = state('')`)

    expect(result).toContain(`state('', "username")`)
  })

  it('别名导入的 state 同样推断 debugName', () => {
    const result = compile(`import { state as signal } from '@vobs/reactivity'\nconst username = signal('')`)

    expect(result).toContain(`signal('', "username")`)
  })

  it('显式传入 debugName 时不覆盖', () => {
    const result = compile(`import { state } from '@vobs/reactivity'\nconst username = state('', 'auth.name')`)

    expect(result).toContain(`state('', 'auth.name')`)
    expect(result).not.toContain('"username"')
  })

  it('state 被本地声明遮蔽时不推断 debugName', () => {
    const result = compile(`import { state } from '@vobs/reactivity'\nfunction state(value: unknown) { return value }\nconst username = state('')`)

    expect(result).toContain(`state('')`)
    expect(result).not.toContain('"username"')
  })

  it('非 state 调用不推断 debugName', () => {
    const result = compile(`const items = useState([])`)

    expect(result).toContain('useState([])')
  })

  it('编译条件 JSX 为动态块', () => {
    const result = compile(`const el = <div>{show.value && <span>visible</span>}</div>`)

    expect(result).toContain('insertDynamic')
    expect(result).toContain('show.value ?')
  })

  it('编译 JSX map 为 keyed 列表', () => {
    const result = compile(`const el = <ul>{items.value.map(item => <li key={item.id}>{item.name}</li>)}</ul>`)

    expect(result).toContain('insertList')
    expect(result).toContain('() => items.value')
    expect(result).toContain('(item) => item.id')
    expect(result).not.toContain('setAttribute(_el2, "key"')
  })

  it('编译嵌套三元的全部分支（不再只保留第一个分支）', () => {
    const result = compile(`const el = <div>{flag ? <A /> : other ? <B /> : <C />}</div>`)

    expect(result).toContain('insertDynamic')
    // 三个分支全部编译为组件调用
    expect(result.match(/createComponent\(resolveComponent/gu)).toHaveLength(3)
    expect(result).not.toContain('React')
  })

  it('编译 && 与嵌套动态节点组合', () => {
    const result = compile(`const el = <div>{flag && (other ? <A /> : <B />)}</div>`)

    expect(result).toContain('insertDynamic')
    expect(result.match(/createComponent\(resolveComponent/gu)).toHaveLength(2)
  })

  it('编译 if 块内的 JSX 早返回（不再泄漏到 React 降级路径）', () => {
    const code = `
  function App() {
    if (items.value.length === 0) return <Empty />
    return <div><Footer /></div>
  }
  `
    const result = compile(code)

    // 早返回分支与主 return 分支都编译为 vobs 组件调用，源码中不残留 JSX
    expect(result.match(/createComponent\(resolveComponent/gu)).toHaveLength(2)
    expect(result).not.toContain('<Empty')
    expect(result).not.toContain('<Footer')
    expect(result).not.toContain('React')
  })

  it('编译函数体内部初始化器与嵌套函数中的 JSX', () => {
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

  it('hmrModuleId 将模块顶层 state 包装为 HMR 保鲜引用', () => {
    const code = `import { state } from '@vobs/reactivity'
export const count = state(0)
function helper() {
  const local = state(1)
  return local.value
}
`
    const result = compile(code, { hmrModuleId: 'src/stores/counter.ts' })

    // 顶层声明被包装，函数内的局部声明不受影响
    expect(result).toContain('hmrStateRef("src/stores/counter.ts#count"')
    expect(result).toContain('() => state(0, "count")')
    expect(result).not.toContain('hmrStateRef("src/stores/counter.ts#local"')
  })

  it('hmrModuleId 保留显式 debugName 且兼容别名导入', () => {
    const code = `import { state as st } from '@vobs/reactivity'
export const width = st(50, 'doc.width')
`
    const result = compile(code, { hmrModuleId: 'src/stores/doc.ts' })

    expect(result).toContain('hmrStateRef("src/stores/doc.ts#width"')
    expect(result).toContain("() => st(50, 'doc.width')")
  })

  it('在 JSX 转换前执行编译器插件的分析、程序与节点钩子', () => {
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

  it('支持 createCompiler 与旧版 transformNode 钩子', () => {
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

  it('拒绝重复命名的编译器插件', () => {
    const plugins: CompilerPlugin[] = [{ name: 'duplicate' }, { name: 'duplicate' }]
    expect(() => compile(`const el = <div />`, { plugins })).toThrow('重复插件')
  })

  it('只导入生成代码实际使用的运行时 helper', () => {
    const result = compile(`const el = <div>hello</div>`)

    // 完全静态的子树提升为模板：只需 createTemplate + cloneTemplate
    expect(result).toContain('createTemplate')
    expect(result).toContain('cloneTemplate')
    expect(result).not.toContain('createElement')
    expect(result).not.toContain('insertBefore')
    expect(result).not.toContain('bindAttribute')
    expect(result).not.toContain('bindText')
    expect(result).not.toContain('insertDynamic')
    expect(result).not.toContain('insertList')
  })

  it('编译 Fragment 为无包装节点范围', () => {
    const result = compile(`const el = <><span>one</span><span>two</span></>`)

    expect(result).toContain('createFragment')
    expect(result).toContain('insertBefore(_fragmentParent')
  })

  it('支持显式 Fragment 和 Vobs.Fragment 写法', () => {
    const explicit = compile(`const el = <Fragment><span>one</span><span>two</span></Fragment>`)
    const namespaced = compile(`const el = <Vobs.Fragment><span>one</span><span>two</span></Vobs.Fragment>`)
    expect(explicit).toContain('createFragment')
    expect(namespaced).toContain('createFragment')
    expect(namespaced).not.toContain('createElement("Vobs.Fragment")')
  })

  it('将 JSX 动态表达式统一编译为可归一化的动态节点', () => {
    const result = compile(`const content = <strong>ready</strong>; const el = <div>{content}</div>`)
    expect(result).toContain('insertDynamicValue')
    expect(result).toContain('() => content')
  })

  it('支持 DOM spread 和对象样式', () => {
    const result = compile(`const props = { className: 'card' }; const el = <div {...props} style={{ backgroundColor: 'red' }} />`)
    expect(result).toContain('spreadProps')
    expect(result).toContain('bindAttribute')
  })

  it('编译 ResourceBoundary 为范围内的资源边界指令', () => {
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

  it('编译 ErrorBoundary 为范围内的错误边界指令', () => {
    const result = compile(`
      const el = <ErrorBoundary fallback={(error, retry) => <button onClick={retry}>{error.message}</button>}>
        <p>ready</p>
      </ErrorBoundary>
    `)

    expect(result).toContain('insertErrorBoundary')
    expect(result).toContain('createFragment')
    expect(result).not.toContain('createComponent(ErrorBoundary')
  })

  it('不为没有运行时调用的源码注入 import', () => {
    const result = compile(`export const version = '0.1.0'`)

    expect(result).not.toContain('@vobs/vobs')
  })

  it('源文件已有同名导入时注入别名 import', () => {
    const result = compile(`
      import { createElement } from './shim'
      export const tag = createElement('span')
      const el = <div>hello {name.value}</div>
    `)

    // 用户导入与调用保持不变，编译器 helper 走别名，不再产生重复声明
    expect(result).toContain('import { createElement } from "./shim"')
    expect(result).toContain('createElement as _vobs_createElement')
    expect(result).toContain('from "@vobs/vobs"')
    expect(result).toContain('_vobs_createElement("div")')
    // 用户自己的调用原样保留（保留原始引号风格）
    expect(result).toContain("createElement('span')")
  })

  it('源文件本地声明与 helper 同名时注入别名 import', () => {
    const result = compile(`
      const createText = (value: string) => value
      const el = <div>hello {name.value}</div>
    `)

    expect(result).toContain('createText as _vobs_createText')
    expect(result).toContain('from "@vobs/vobs"')
    expect(result).toContain('insertBefore(_el0, _vobs_createText("hello ")')
    // 用户本地声明不受影响
    expect(result).toContain('const createText = (value: string) => value')
  })

  it('嵌套作用域的同名绑定也触发别名 import', () => {
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

  it('同名绑定触发别名时保留别名一致性（同一 helper 只注入一次）', () => {
    const result = compile(`
      const createElement = String
      const el = <div><span>one {name.value}</span></div>
    `)

    expect(result.match(/_vobs_createElement/g)?.length).toBeGreaterThanOrEqual(2)
    // import 别名声明只出现一次，产物引用与之一致
    expect(result.match(/ as _vobs_createElement/g)?.length).toBe(1)
  })

  it('生成的临时变量避开用户已声明的名称', () => {
    const result = compile(`
      const _el0 = 'reserved'
      const el = <div>hello {name.value}</div>
    `)

    // _el0 被用户占用，编译产物必须改用下一个可用名称
    expect(result).toContain('const _el1 = createElement("div")')
    expect(result).not.toContain('const _el0 = createElement')
  })

  it('组件 children 中的 JSX 表达式保持惰性并递归编译', () => {
    const result = compile(`
      const el = <Layout>{show.value && <Panel>{title.value}</Panel>}</Layout>
    `)

    expect(result).toContain('get children()')
    expect(result).toContain('show.value && createComponent(resolveComponent(Panel')
    expect(result).toContain('return title.value')
    expect(result).not.toContain('<Panel>')
  })

  it('组件属性中的 JSX slot 保持惰性并递归编译', () => {
    const result = compile(`
      const el = <Button icon={<Icon name="search" />}>Search</Button>
    `)

    expect(result).toContain('get icon()')
    expect(result).toContain('createComponent(resolveComponent(Icon')
    expect(result).not.toContain('<Icon')
  })

  it('动态 DOM property 使用 bindProperty，并为组件生成源码位置', () => {
    const result = compile(`
      const el = <Editor><input disabled={locked.value} value={text.value} /></Editor>
    `, { filename: 'src/editor.tsx' })

    expect(result).toContain('bindProperty')
    expect(result).toContain('"disabled"')
    expect(result).toContain('"value"')
    expect(result).toContain('file: "src/editor.tsx"')
    expect(result).toContain('line: 2')
  })

  it('sourceLocation: false 剔除组件源码位置', () => {
    const result = compile(`
      const el = <Editor><input disabled={locked.value} value={text.value} /></Editor>
    `, { filename: 'src/editor.tsx', sourceLocation: false })

    expect(result).toContain('createComponent')
    expect(result).not.toContain('file:')
    expect(result).not.toContain('line:')
    expect(result).not.toContain('column:')
  })

  it('生成包含原始内容的 Source Map', () => {
    const result = compileWithSourceMap(`const el = <div>hello</div>`, { filename: 'src/App.tsx' })

    expect(result.map.version).toBe(3)
    expect(result.map.sources).toEqual(['src/App.tsx'])
    expect(result.map.sourcesContent).toEqual(['const el = <div>hello</div>'])
    expect(result.map.mappings.split(';').length).toBe(result.code.split('\n').length)
  })

  it('Source Map 映射真实源码位置（语句级）', () => {
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

    // 生成行号必须落在产物范围内
    for (const segment of segments) {
      expect(segment.genLine).toBeLessThan(codeLines.length)
      expect(segment.srcLine).toBeLessThan(source.split('\n').length)
    }

    // 用户自己的语句 1:1 映射
    expect(findSourceLine(segments, codeLines, 'const count')).toBe(3)
    // JSX 元素与属性映射回标签所在行（含列号）
    expect(findSourceLine(segments, codeLines, 'createElement("div")')).toBe(5)
    expect(findSourceLine(segments, codeLines, 'addEventListener(')).toBe(5)
    // IIFE 内的文本绑定映射回表达式子节点所在行
    expect(findSourceLine(segments, codeLines, 'bindText(')).toBe(6)
    // 注入的 import 不产生错误映射
    const importLine = codeLines.findIndex(line => line.startsWith('import { createElement'))
    expect(segments.some(segment => segment.genLine === importLine)).toBe(false)
  })

  it('Source Map 覆盖嵌套函数体内的列表语句', () => {
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

  it('返回结构化编译诊断，并在 compile 中抛出 VobsError', () => {
    const result = compileWithSourceMap('const el = <div>', { filename: 'src/Broken.tsx' })
    expect(result.diagnostics.length).toBeGreaterThan(0)
    expect(result.diagnostics[0]).toMatchObject({
      severity: 'error',
      location: { file: 'src/Broken.tsx' }
    })
    expect(() => compile('const el = <div>', { filename: 'src/Broken.tsx' })).toThrow(VobsError)
  })

  it('成员表达式标签产生 VOBS_C101 诊断', () => {
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

  it('命名空间标签产生 VOBS_C101 诊断', () => {
    const result = compileWithSourceMap(`const el = <svg:rect width="1" />`)
    const diagnostic = result.diagnostics.find(item => item.code === 'VOBS_C101')

    expect(diagnostic).toBeDefined()
    expect(diagnostic?.message).toContain('svg:rect')
    expect(diagnostic?.message).toContain('命名空间')
    expect(() => compile(`const el = <svg:rect width="1" />`)).toThrow(VobsError)
  })

  it('小写成员表达式标签同样不被放行', () => {
    const result = compileWithSourceMap(`const el = <foo.bar />`)
    expect(result.diagnostics.find(item => item.code === 'VOBS_C101')).toBeDefined()
  })

  it('Fragment 成员表达式形态仍受支持', () => {
    const result = compileWithSourceMap(`const el = <Vobs.Fragment><span>one</span></Vobs.Fragment>`)

    expect(result.diagnostics.filter(item => item.severity === 'error')).toHaveLength(0)
  })

  it('诊断信息随 compileWithSourceMap 稳定返回（不改变产物结构）', () => {
    const result = compileWithSourceMap(`const el = <Foo.Bar />`)

    // 报诊断的同时产物仍可打印，便于 source map 配对与调试
    expect(result.code).toContain('createElement("Foo.Bar")')
    expect(result.map).toBeDefined()
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
