/*
 * `VOBS_C105`：**模块顶层**的 JSX。
 *
 * 为什么值得一条编译错误（外部踩坑文档 F 条）：模块顶层表达式在 **import 求值**时执行，
 * 那**早于** `createVobs()` 安装渲染器。于是 JSX 里的 `createElement` 会撞
 * 「渲染器未初始化」—— 报错发生在**运行时**、在某个看起来无关的模块被 import 的时候，
 * 堆栈跟真正的原因（"这个常量写错位置了"）隔得很远。
 *
 * 判据：只在"顶层求值会立即执行"的子树里报；进入函数体就停（那是延迟求值，正确写法）。
 */
import { describe, expect, it } from 'vitest'
import { compileWithSourceMap } from './index'

const c105 = (source: string): Array<{ message: string; fix?: string; severity?: string; location: { line: number; file: string } }> =>
  compileWithSourceMap(source, { filename: 'case.tsx' })
    .diagnostics.filter(d => d.code === 'VOBS_C105')

describe('VOBS_C105 模块顶层 JSX', () => {
  it('顶层 JSX 常量报错（F 条的实际形态）', () => {
    const found = c105("import { KitMenuItem } from './menu'\nexport const MENU = <KitMenuItem />")
    expect(found).toHaveLength(1)
    expect(found[0]!.message).toContain('渲染器未初始化')
    expect(found[0]!.fix).toContain('组件体')
    // 是 warning 而不是 error：error 会让 compile() 抛错，打断所有片段式工具
    expect(found[0]!.severity).toBe('warning')
  })

  it('顶层 JSX 数组也报', () => {
    expect(c105('const ITEMS = [<div>a</div>, <div>b</div>]')).toHaveLength(2)
  })

  it('顶层 fragment 也报', () => {
    expect(c105('const X = <><div>a</div></>')).toHaveLength(1)
  })

  it('定位指向那个 JSX（行号可用）', () => {
    const found = c105("import x from 'y'\nexport const MENU = <div>a</div>")
    expect(found[0]!.location.line).toBe(2)
    expect(found[0]!.location.file).toBe('case.tsx')
  })

  it('组件体内的 JSX **不该**报', () => {
    expect(c105('export const A = () => <div>ok</div>')).toEqual([])
  })

  it('返回节点的函数 **不该**报（延迟求值，是推荐替代写法）', () => {
    expect(c105('const menu = () => [<div>a</div>]')).toEqual([])
  })

  it('函数体内再嵌套也不该报', () => {
    expect(c105('export function A() {\n  const items = [<b>x</b>]\n  return <div>{items}</div>\n}')).toEqual([])
  })

  it('顶层普通常量 / 函数调用不该报', () => {
    expect(c105("const NAME = 'vobs'")).toEqual([])
    expect(c105("const el = createElement('div')")).toEqual([])
  })

  it('import 语句本身不会被误报', () => {
    expect(c105("import { a } from './x'")).toEqual([])
  })
})
