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
    // 子节点表达式统一走 insertDynamicValue 多态插入（原始值在运行时命中文本快路径）
    expect(result).toContain('insertDynamicValue')
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

  // 回归（Vobs Console 踩坑备忘）：`{cond ? <A/> : items.map(...)}` 里列表那一支
  // 曾被写成 `null` 分支而**静默消失** —— convertDynamicNodeExpression 只要有一支
  // 产出节点就提交条件树，其余分支一律变 null。现在只要有一支不是节点表达式
  // （列表、文本、数值…），整个条件就回落 insertDynamicValue 多态插入。
  it('三元中非节点分支回落多态插入，不被写成 null', () => {
    const withList = compile(`const el = <div>{ok ? <span>empty</span> : items.map(i => <b key={i}>{i}</b>)}</div>`)
    expect(withList).toContain('insertDynamicValue')
    expect(withList).toContain('items.map(i =>')
    // 关键：列表那一支不能再被写成 null
    expect(withList).not.toContain('? cloneTemplate(_tpl1) : null')
    expect(withList).not.toMatch(/\? cloneTemplate\([^)]*\) : null/u)

    const withText = compile(`const el = <div>{ok ? <i>icon</i> : label.value}</div>`)
    expect(withText).toContain('insertDynamicValue')
    expect(withText).toContain('label.value')
    expect(withText).not.toContain(': null')
  })

  it('所有分支都是节点时仍走 insertDynamic 快路径', () => {
    const result = compile(`const el = <div>{ok ? <A/> : <B/>}</div>`)
    expect(result).toContain('insertDynamic(')
    expect(result).not.toContain('insertDynamicValue')
  })

  it('列表作为直接子表达式时仍编译为 keyed insertList', () => {
    const result = compile(`const el = <div>{items.map(i => <b key={i}>{i}</b>)}</div>`)
    expect(result).toContain('insertList')
  })

  // 回归（Labelune 踩坑备忘）：JSX 子节点里的函数调用曾被编译为 bindText 文本绑定
  // （String(fragment) → "[object Object]"）。现在所有非静态子表达式统一走
  // insertDynamicValue 多态插入：值类型由运行时判断，返回节点的辅助函数与返回
  // 字符串的 t('...') 同样安全。
  it('函数调用子表达式编译为 insertDynamicValue 多态插入（不文本绑定）', () => {
    const result = compile(`const el = <div>{renderSections(doc)}{t('greeting')}</div>`)
    expect(result).not.toContain('bindText')
    expect(result).toContain('insertDynamicValue')
    expect(result).toContain('() => renderSections(doc)')
    expect(result).toContain(`() => t('greeting')`)
  })

  // 回归（Labelune 踩坑备忘）：用户态组件透传 children 曾渲染为 "[object HTMLDivElement]"。
  // children 必须编译为 getter 返回节点/节点数组，{children} 表达式走 insertDynamicValue
  // 直传节点，任何一侧都不允许落入文本序列化路径。
  it('用户态组件透传 children 编译为节点 getter 与节点直传（不字符串化）', () => {
    const result = compile(`
      function Section({ children }) {
        return <section>{children}</section>
      }
      const el = <Section><div class="inner">inner</div></Section>
    `)
    // 调用方：children 是 getter，值为构建好的节点（transformElement 求值结果 / 静态提升 clone）
    expect(result).toContain('get children()')
    expect(result).toContain('createComponent(')
    // 被调方：{children} 标识符表达式直传节点（insertDynamicValue），不走 createText(String(...))
    expect(result).toContain('insertDynamicValue')
    expect(result).toContain('() => children')
    expect(result).not.toContain('String(children)')
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

  // 回归（Labelune 踩坑备忘）：残留 JSX（早返回/嵌套分支中主转换未覆盖的 JSX）此前在
  // runtime import 与模板声明生成之后才转换，其引用的 _tplN 模板与 insertDynamicValue
  // 等 helper 不会出现在最终产物中，运行时抛 "XXX is not defined"。
  // 产物自检：每个被引用的 _tplN 必须有声明，每个 helper 调用必须有对应导入。
  function assertNoDanglingReferences(result: string): void {
    const usedTemplates = [...result.matchAll(/_tpl\d+/gu)].map(match => match[0])
    const declaredTemplates = new Set([...result.matchAll(/const (_tpl\d+)\s*=/gu)].map(match => match[1]))
    for (const template of new Set(usedTemplates)) {
      expect(declaredTemplates.has(template), `引用了未声明的模板 ${template}`).toBe(true)
    }
    const runtimeHelpers = [
      'createElement', 'createText', 'createFragment', 'createTemplate', 'cloneTemplate',
      'insertBefore', 'insertDynamic', 'insertDynamicValue', 'insertList',
      'bindText', 'bindAttribute', 'bindProperty', 'setStaticProps', 'addEventListener', 'setRef'
    ]
    const importSection = result.slice(0, result.indexOf('@vobs/vobs'))
    for (const helper of runtimeHelpers) {
      const used = new RegExp(`\\b${helper}\\(`, 'u').test(result)
      if (used) expect(importSection.includes(helper), `调用了 helper ${helper} 但未导入`).toBe(true)
    }
  }

  it('三元分支 JSX：模板声明与 helper 导入完整（残留转换先于 import 生成）', () => {
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

  it('早返回 JSX：模板声明与 helper 导入完整（残留转换先于 import 生成）', () => {
    const result = compile(`
      function DiscoveryResults() {
        if (list.length === 0) return <p class="hint">未发现设备</p>
        return <div class="section">发现 {list.length} 个</div>
      }
    `)
    assertNoDanglingReferences(result)
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
    // IIFE 内的动态子表达式插入映射回表达式子节点所在行
    expect(findSourceLine(segments, codeLines, 'insertDynamicValue(')).toBe(6)
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

  /*
   * 事件名。原来的实现是无条件 `name.slice(2).toLowerCase()`：
   * onDoubleClick 绑到不存在的 "doubleclick"、once 绑到 "ce"，
   * 两者都静默失效 —— 回调永不触发且没有任何报错。
   */
  it('onDoubleClick 编译成 dblclick（DOM 里没有 doubleclick 这个事件）', () => {
    const result = compileWithSourceMap(`const el = <div onDoubleClick={fn}>x</div>`)

    expect(result.code).toContain('"dblclick"')
    expect(result.code).not.toContain('doubleclick')
    expect(result.diagnostics.filter(item => item.code === 'VOBS_C102')).toEqual([])
  })

  it('onDblClick 同样归一到 dblclick', () => {
    expect(compileWithSourceMap(`const el = <div onDblClick={fn}>x</div>`).code).toContain('"dblclick"')
  })

  it('once 这种「on + 非大写」且不是已知事件的属性报 VOBS_C102 错误', () => {
    const result = compileWithSourceMap(`const el = <div once={fn}>x</div>`, { filename: 'src/Once.tsx' })
    const diagnostic = result.diagnostics.find(item => item.code === 'VOBS_C102')

    expect(diagnostic).toBeDefined()
    expect(diagnostic?.severity).toBe('error')
    expect(diagnostic?.message).toContain('"ce"')
    expect(diagnostic?.location).toMatchObject({ file: 'src/Once.tsx', line: 1 })
    expect(diagnostic?.codeFrame).toContain('once')
    expect(diagnostic?.fix).toContain('大写')
    expect(() => compile(`const el = <div once={fn}>x</div>`)).toThrow(VobsError)
  })

  it('onclick 能工作但给出警告（小写只是碰巧对得上）', () => {
    const result = compileWithSourceMap(`const el = <div onclick={fn}>x</div>`)
    const diagnostic = result.diagnostics.find(item => item.code === 'VOBS_C102')

    expect(result.code).toContain('"click"')
    expect(diagnostic?.severity).toBe('warning')
    expect(diagnostic?.fix).toContain('onClick')
  })

  it('未知事件名给警告而不是错误（自定义事件必须继续可用）', () => {
    const result = compileWithSourceMap(`const el = <div onFoo={fn}>x</div>`)
    const diagnostic = result.diagnostics.find(item => item.code === 'VOBS_C102')

    expect(result.code).toContain('"foo"')
    expect(diagnostic?.severity).toBe('warning')
    expect(diagnostic?.message).toContain('自定义事件')
  })

  it('常规事件属性不产生任何诊断', () => {
    const result = compileWithSourceMap(`const el = <input onClick={a} onKeyDown={b} onPointerEnter={c} />`)
    expect(result.diagnostics.filter(item => item.code === 'VOBS_C102')).toEqual([])
  })

  /*
   * JSX 文本的空白规范化。
   *
   * 原来三处都用 `replace(/\s+/g, ' ').trimStart()`，元素之间那个**合法的空格**被删掉：
   * <p><b>a</b> <i>b</i></p> 渲染成 "ab"，而 React / Solid 都是 "a b"。
   * 仓库里恰好没有这种写法，所以任何测试都没覆盖到。
   */
  describe('JSX 文本空白', () => {
    it('元素之间的一个空格保留（提升成模板时也在）', () => {
      const code = compileWithSourceMap(`const el = <p><b>a</b> <i>b</i></p>`).code
      expect(code).toContain('<p><b>a</b> <i>b</i></p>')
    })

    it('本来没有空格就还是没空格', () => {
      const code = compileWithSourceMap(`const el = <p><b>a</b><i>b</i></p>`).code
      expect(code).toContain('<p><b>a</b><i>b</i></p>')
      expect(code).not.toContain('<b>a</b> <i>')
    })

    it('多个空格原样保留', () => {
      expect(compileWithSourceMap(`const el = <p><b>a</b>   <i>b</i></p>`).code)
        .toContain('<b>a</b>   <i>')
    })

    it('换行与缩进被吃掉（与 React 一致）', () => {
      const code = compileWithSourceMap(`const el = <p>\n  <b>a</b>\n  <i>b</i>\n</p>`).code
      expect(code).toContain('<p><b>a</b><i>b</i></p>')
    })

    it('表达式之间的空格成为真实文本节点', () => {
      const code = compileWithSourceMap(`const el = <p>{x} {y}</p>`).code
      expect(code).toContain('createText(" ")')
    })

    it('文本与表达式相邻的空格只在有换行时被吃掉', () => {
      expect(compileWithSourceMap(`const el = <p>a {x}</p>`).code).toContain('createText("a ")')
      expect(compileWithSourceMap(`const el = <p>{x} b</p>`).code).toContain('createText(" b")')
      expect(compileWithSourceMap(`const el = <p>\n  {x}\n  {y}\n</p>`).code).not.toContain('createText(" ")')
    })
  })

  /*
   * SVG 子树不能提升成模板：模板走 HTML 解析器，`<g>`/`<rect>` 会变成
   * HTMLUnknownElement —— 命名空间错了，整棵图形不渲染且没有报错。
   * createElement 那条路径（ops.ts 的 isSvgTag）早就对了，唯独提升这条漏着。
   */
  describe('静态 SVG 不提升成模板', () => {
    it('svg 内的静态子树走 createElement', () => {
      const code = compileWithSourceMap(`const el = <svg width={w}><g><rect width="4" /></g></svg>`).code
      expect(code).not.toContain('createTemplate')
      expect(code).toContain('createElement("g")')
      expect(code).toContain('createElement("rect")')
    })

    it('HTML 外层里嵌的 svg 同样不提升', () => {
      const code = compileWithSourceMap(`const el = <div><svg><circle r="4" /></svg></div>`).code
      expect(code).not.toContain('createTemplate')
      expect(code).toContain('createElement("svg")')
      expect(code).toContain('createElement("circle")')
    })

    it('纯 HTML 子树仍然提升（性能不受影响）', () => {
      expect(compileWithSourceMap(`const el = <div><span>hi</span></div>`).code)
        .toContain('createTemplate("<div><span>hi</span></div>")')
      expect(compileWithSourceMap(`const el = <p><b>a</b></p>`).code).toContain('createTemplate')
    })
  })

  /*
   * 列表判定。
   *
   * 认不出 `.map` 时会静默退化成多态插入：功能仍然正常，但每一项每轮重建、
   * key 与 keyed 复用全部失效，而且**没有任何提示**。这里放宽能安全支持的写法，
   * 剩下确实做不到的（Fragment 体、多语句块体）报警告。
   */
  describe('列表判定', () => {
    const listCode = (source: string) => compileWithSourceMap(source, { filename: 'a.tsx' })

    it('回调体上的 as 断言不再让它漏掉列表', () => {
      const code = listCode(`const el = <ul>{items.map(item => (<li>{item}</li>) as any)}</ul>`).code
      // 列表本身走 insertList（对比：降级时整份 items 会交给 insertDynamicValue）
      expect(code).toContain('insertList(')
      expect(code).not.toMatch(/insertDynamicValue\(_el\w+, null, \(\) => items/)
    })

    it('块体里恰好一个 return 也算列表', () => {
      const code = listCode(`const el = <ul>{items.map(item => { return <li>{item}</li> })}</ul>`).code
      expect(code).toContain('insertList(')
    })

    it('map 带 thisArg 仍然算列表', () => {
      const code = listCode(`const el = <ul>{items.map(item => <li>{item}</li>, this)}</ul>`).code
      expect(code).toContain('insertList(')
    })

    it('Fragment 体退化成多态插入并报 VOBS_C103 警告', () => {
      const result = listCode(`const el = <ul>{items.map(item => <><li>{item}</li></>)}</ul>`)
      const diagnostic = result.diagnostics.find(item => item.code === 'VOBS_C103')

      // 降级的判据是「没有 insertList」——insertDynamicValue 在正常列表里也会出现（列表项内部的文本绑定）
      expect(result.code).not.toContain('insertList(')
      expect(diagnostic?.severity).toBe('warning')
      expect(diagnostic?.message).toContain('Fragment')
      expect(diagnostic?.fix).toContain('Fragment')
    })

    it('多语句块体报 VOBS_C103 警告', () => {
      const result = listCode(`const el = <ul>{items.map(item => { const n = item; return <li>{n}</li> })}</ul>`)
      const diagnostic = result.diagnostics.find(item => item.code === 'VOBS_C103')

      expect(diagnostic?.severity).toBe('warning')
      expect(diagnostic?.message).toContain('多个语句')
      expect(result.diagnostics.every(item => item.severity === 'warning')).toBe(true)
    })

    it('返回字符串的 map 不是列表，也不报警告', () => {
      const result = listCode(`const el = <ul>{items.map(item => item.name)}</ul>`)
      expect(result.diagnostics.filter(item => item.code === 'VOBS_C103')).toEqual([])
    })

    it('正常列表没有任何诊断', () => {
      const result = listCode(`const el = <ul>{items.map(item => <li key={item.id}>{item.name}</li>)}</ul>`)
      expect(result.code).toContain('insertList(')
      expect(result.diagnostics).toEqual([])
    })
  })

  /*
   * 诊断质量：一次只报第一条是最费时间的形态 —— 文件里有 5 处错误要构建 5 次
   * 才能知道全貌。边界组件缺属性原来是直接 throw（连位置都没有），
   * 于是非抛出版本的 compileWithSourceMap 也变成抛异常。
   */
  describe('诊断质量', () => {
    it('compile() 一次列出同一文件里的全部错误', () => {
      const source = `const a = <div once={fn}>x</div>\nconst b = <Foo.Bar />`
      let message = ''
      try {
        compile(source, { filename: 'src/Many.tsx' })
      } catch (error) {
        message = String((error as Error).message)
      }

      expect(message).toContain('"ce"')
      expect(message).toContain('还有 1 处错误')
      expect(message).toContain('VOBS_C101')
      expect(message).toContain('src/Many.tsx:2')
    })

    it('边界组件缺属性返回带位置的诊断，而不是抛异常', () => {
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

    it('codeFrame 的插入符按显示宽度对齐（tab 不再让 ^ 偏掉）', () => {
      const source = 'const a = <div>\n\t\t<div once={fn}>x</div>\n</div>'
      const diagnostic = compileWithSourceMap(source, { filename: 'src/Tab.tsx' })
        .diagnostics.find(item => item.code === 'VOBS_C102')

      const [codeLine, caretLine] = (diagnostic?.codeFrame ?? '').split('\n')
      expect(codeLine).toBeDefined()
      // 展开 tab 后 ^ 必须落在 once 的起始列
      const markerColumn = caretLine.indexOf('^')
      const onceColumn = codeLine.indexOf('once')
      expect(markerColumn).toBe(onceColumn)
    })
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

  /*
   * SVG 命名空间继承。
   *
   * 只按标签名判定命名空间是行不通的：a / title / style / script 与 HTML 同名，
   * 在 <svg> 里必须是 SVG 元素。光看名字会建出 HTML 锚点 —— 不渲染、也不报错
   * （CHANGELOG 里自认的已知问题）。编译器知道祖先链，所以由它显式指定。
   */
  describe('SVG 命名空间继承', () => {
    it('SVG 里的 a / title 显式走 createSvgElement', () => {
      const a = compileWithSourceMap(`const el = <svg><a href="/x">link</a></svg>`).code
      expect(a).toContain('createSvgElement("a")')
      const title = compileWithSourceMap(`const el = <svg><title>t</title></svg>`).code
      expect(title).toContain('createSvgElement("title")')
    })

    it('隔一层也继承（<svg><g><a>）', () => {
      expect(compileWithSourceMap(`const el = <svg><g><a href="/y">n</a></g></svg>`).code)
        .toContain('createSvgElement("a")')
    })

    it('foreignObject 把子树切回 HTML', () => {
      const code = compileWithSourceMap(`const el = <svg><foreignObject><a href="/z">h</a></foreignObject></svg>`).code
      expect(code).not.toContain('createSvgElement("a")')
    })

    it('普通 HTML 里的 a 不受影响', () => {
      expect(compileWithSourceMap(`const el = <div><a href="/w">h</a></div>`).code).not.toContain('createSvgElement')
    })

    it('SVG 子树一律不做静态提升（模板用的是 HTML 解析器）', () => {
      // <a> 本身是静态的，若提升成模板就会 clone 出 HTML 锚点
      expect(compileWithSourceMap(`const el = <svg><a href="/x">link</a></svg>`).code).not.toContain('createTemplate')
    })
  })
