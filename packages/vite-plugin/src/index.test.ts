import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import { compileHtmlComponent } from './html-component'
import { vobsPlugin } from './index'

describe('vobsPlugin', () => {
  it('将编译器插件配置透传给 TSX 转换', () => {
    const plugin = vobsPlugin({
      compiler: {
        plugins: [{
          name: 'replace-message',
          transform: {
            node(node, context) {
              if (ts.isIdentifier(node) && node.text === 'message') {
                return context.factory.createIdentifier('title')
              }
              return node
            }
          }
        }]
      }
    })
    const transform = plugin.transform
    if (typeof transform !== 'function') throw new Error('Vobs Vite plugin: 缺少 transform 钩子')

    const result = transform.call({} as ThisParameterType<typeof transform>,
      `export function App() { return <span>{message}</span> }`,
      'src/App.tsx'
    )

    expect(result).toMatchObject({ code: expect.stringContaining('() => title') })
  })

  it('返回源码映射并注入可关闭的 HMR 接受器', () => {
    const plugin = vobsPlugin()
    const transform = plugin.transform
    if (typeof transform !== 'function') throw new Error('Vobs Vite plugin: 缺少 transform 钩子')

    const result = transform.call({} as ThisParameterType<typeof transform>,
      `export function App() { return <span>hello</span> }`,
      'src/App.tsx'
    ) as { code: string; map: { sources: string[] } }

    expect(result.map.sources).toEqual(['src/App.tsx'])
    expect(result.code).toContain('import.meta.hot.accept')
    expect(result.code).toContain('updateHmrModule')
  })

  it('可以关闭 HMR 注入', () => {
    const plugin = vobsPlugin({ hmr: false })
    const transform = plugin.transform
    if (typeof transform !== 'function') throw new Error('Vobs Vite plugin: 缺少 transform 钩子')

    const result = transform.call({} as ThisParameterType<typeof transform>,
      `export function App() { return <span>hello</span> }`,
      'src/App.tsx'
    ) as { code: string }

    expect(result.code).not.toContain('import.meta.hot.accept')
  })

  it('生产构建默认不注入 HMR 代码', () => {
    const plugin = vobsPlugin()
    const configResolved = plugin.configResolved as ((config: unknown) => void) | undefined
    configResolved?.({ command: 'build' })
    const transform = plugin.transform
    if (typeof transform !== 'function') throw new Error('Vobs Vite plugin: 缺少 transform 钩子')
    const result = transform.call({} as ThisParameterType<typeof transform>,
      `export const App = () => <main>hello</main>`, 'src/App.tsx') as { code: string }
    expect(result.code).not.toContain('import.meta.hot.accept')
  })

  it('生产构建默认剔除组件源码位置，开发构建保留', () => {
    const compile = (plugin: ReturnType<typeof vobsPlugin>, source: string) => {
      const transform = plugin.transform
      if (typeof transform !== 'function') throw new Error('Vobs Vite plugin: 缺少 transform 钩子')
      return transform.call({} as ThisParameterType<typeof transform>,
        source, 'src/App.tsx') as { code: string }
    }

    const production = vobsPlugin({ hmr: false })
    ;(production.configResolved as (config: unknown) => void)?.({ command: 'build' })
    const productionCode = compile(production, `export function App() { return <Panel /> }`).code
    expect(productionCode).toContain('createComponent')
    expect(productionCode).not.toContain('file:')

    const development = compile(vobsPlugin(), `export function App() { return <Panel /> }`).code
    expect(development).toContain('file: "src/App.tsx"')
  })

  it('显式 compiler.sourceLocation 配置优先于生产默认值', () => {
    const plugin = vobsPlugin({ hmr: false, compiler: { sourceLocation: true } })
    const configResolved = plugin.configResolved as ((config: unknown) => void) | undefined
    configResolved?.({ command: 'build' })
    const transform = plugin.transform
    if (typeof transform !== 'function') throw new Error('Vobs Vite plugin: 缺少 transform 钩子')
    const result = transform.call({} as ThisParameterType<typeof transform>,
      `export function App() { return <Panel /> }`, 'src/App.tsx') as { code: string }
    expect(result.code).toContain('file: "src/App.tsx"')
  })

  it('转换不含 export function 的合法 TSX 模块', () => {
    const plugin = vobsPlugin({ hmr: false })
    const transform = plugin.transform
    if (typeof transform !== 'function') throw new Error('Vobs Vite plugin: 缺少 transform 钩子')

    const result = transform.call({} as ThisParameterType<typeof transform>,
      `export const App = () => <main>hello</main>`,
      'src/App.tsx'
    ) as { code: string }

    // 完全静态的 JSX 提升为模板克隆
    expect(result.code).toContain('createTemplate("<main>hello</main>")')
  })

  it('转换默认箭头导出和带 query 的 TSX 模块', () => {
    const plugin = vobsPlugin({ hmr: false })
    const transform = plugin.transform
    if (typeof transform !== 'function') throw new Error('Vobs Vite plugin: 缺少 transform 钩子')

    const result = transform.call({} as ThisParameterType<typeof transform>,
      `export default () => <main>hello</main>`,
      'src/App.tsx?direct'
    ) as { code: string }

    // 完全静态的 JSX 提升为模板克隆
    expect(result.code).toContain('createTemplate("<main>hello</main>")')
  })

  it('通过 extractI18n 回调收集静态翻译 key', () => {
    const keys: string[] = []
    const plugin = vobsPlugin({ hmr: false, extractI18n: key => keys.push(key) })
    const transform = plugin.transform
    if (typeof transform !== 'function') throw new Error('Vobs Vite Plugin: 缺少 transform 钩子')

    transform.call({} as ThisParameterType<typeof transform>,
      `export const Page = () => <main>{t('page.title')} {i18n.t('common.ok')}</main>`,
      'src/Page.tsx'
    )

    expect(keys).toEqual(['page.title', 'common.ok'])
  })

  it('为 .ts 状态模块注入 HMR 保鲜与接受器（dev 默认开启）', () => {
    const plugin = vobsPlugin()
    const transform = plugin.transform
    if (typeof transform !== 'function') throw new Error('Vobs Vite Plugin: 缺少 transform 钩子')

    const result = transform.call({} as ThisParameterType<typeof transform>,
      `import { state } from '@vobs/reactivity'\nexport const count = state(0)\n`,
      'src/stores/counter.ts'
    ) as { code: string }

    expect(result.code).toContain('hmrStateRef("src/stores/counter.ts#count"')
    expect(result.code).toContain('import.meta.hot.accept')
  })

  it('普通 .ts 模块与 .d.ts 不参与编译', () => {
    const plugin = vobsPlugin()
    const transform = plugin.transform
    if (typeof transform !== 'function') throw new Error('Vobs Vite Plugin: 缺少 transform 钩子')

    expect(transform.call({} as ThisParameterType<typeof transform>, `export const value = 1`, 'src/utils/math.ts')).toBeNull()
    expect(transform.call({} as ThisParameterType<typeof transform>, `export declare const x: number`, 'src/types.d.ts')).toBeNull()
  })

  it('hmrState: false 关闭 .ts 状态模块处理', () => {
    const plugin = vobsPlugin({ hmrState: false })
    const transform = plugin.transform
    if (typeof transform !== 'function') throw new Error('Vobs Vite Plugin: 缺少 transform 钩子')

    const result = transform.call({} as ThisParameterType<typeof transform>,
      `import { state } from '@vobs/reactivity'\nexport const count = state(0)\n`,
      'src/stores/counter.ts'
    )
    expect(result).toBeNull()
  })

  it('生产构建不为 .ts 状态模块注入 HMR', () => {
    const plugin = vobsPlugin()
    ;(plugin.configResolved as (config: unknown) => void)?.({ command: 'build' })
    const transform = plugin.transform
    if (typeof transform !== 'function') throw new Error('Vobs Vite Plugin: 缺少 transform 钩子')

    const result = transform.call({} as ThisParameterType<typeof transform>,
      `import { state } from '@vobs/reactivity'\nexport const count = state(0)\n`,
      'src/stores/counter.ts'
    )
    expect(result).toBeNull()
  })

  it('将 HTML 模块编译为无 innerHTML 的 Vobs 组件', () => {
    const result = compileHtmlComponent('<article class="copy"><h1>Hello</h1><p>Safe</p></article>', {
      filename: 'src/content.html'
    })

    expect(result).toContain("createElement(\"article\")")
    expect(result).toContain("setAttribute(element, \"class\", \"copy\")")
    expect(result).toContain('createText(\"Hello\")')
    expect(result).not.toContain('innerHTML')
  })

  it('将受限的 Vobs 指令连接到响应式 props 和事件', () => {
    const result = compileHtmlComponent(`
      <button data-vobs-on-click="onSave" data-vobs-prop-disabled="disabled">
        <span data-vobs-text="label"></span>
        <span data-vobs-slot="actions"></span>
      </button>
    `)

    expect(result).toContain('addEventListener(element, "click"')
    expect(result).toContain('bindProperty(element, "disabled"')
    expect(result).toContain('bindText(text')
    expect(result).toContain('insertDynamic(element, null')
    expect(result).toContain('props["onSave"]')
    expect(result).toContain('bindProperty(element, "disabled"')
  })

  it('拒绝脚本、事件属性和危险 URL', () => {
    expect(() => compileHtmlComponent('<script>alert(1)</script>')).toThrow('禁止使用 <script>')
    expect(() => compileHtmlComponent('<button onclick="alert(1)">run</button>')).toThrow('禁止使用危险属性')
    expect(() => compileHtmlComponent('<a href="javascript:alert(1)">run</a>')).toThrow('禁止使用危险 URL')
    expect(() => compileHtmlComponent('<button data-vobs-on-click="on-click">run</button>')).toThrow('有效的 props 名称')
    expect(() => compileHtmlComponent('<div data-vobs-bind-style="styleValue"></div>')).toThrow('不允许动态绑定 style')
    expect(() => compileHtmlComponent('<div data-vobs-prop-innerHTML="content"></div>')).toThrow('不允许动态绑定 property')
  })

  it('忽略注释和文档类型声明', () => {
    const result = compileHtmlComponent('<!doctype html><!-- note --><main>content</main>')
    expect(result).toContain('createElement(\"main\")')
    expect(result).not.toContain('tagName')
  })

  it('只将被导入的 HTML 文件交给组件加载器', async () => {
    const plugin = vobsPlugin({ hmr: false })
    const resolveId = plugin.resolveId
    const load = plugin.load
    if (typeof resolveId !== 'function' || typeof load !== 'function') throw new Error('Vobs Vite Plugin: 缺少 HTML 模块钩子')

    expect(resolveId.call({} as ThisParameterType<typeof resolveId>, './content.html', 'src/Page.tsx', { attributes: {}, isEntry: false })).toBeTruthy()
    expect(resolveId.call({} as ThisParameterType<typeof resolveId>, './index.html', undefined, { attributes: {}, isEntry: false })).toBeNull()
  })
})
