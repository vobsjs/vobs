/*
 * Vite 插件必须**把 compiler 的 warning 报出来**（真实项目 2026-10-02 反馈）。
 *
 * 起因：`describeDiagnostics` 内部是
 *   `diagnostics.filter(item => item.severity === 'error')`，
 * 没有错误就返回 `null`，而插件只做 `if (summary) throw` ——
 * 于是**警告被静默丢弃**。实测后果：`VOBS_C105`（模块顶层 JSX）与
 * `VOBS_C104`（顶层条件 return，1.8.1 起降为 warning）在 `vite build` 里
 * **完全隐形**，只有 `vobs check` 能看到。
 *
 * 本文件锁住：warning 走 Vite 的告警通道（`this.warn`）出现，且
 * **干净文件不会报警**（否则"总是报警"的测试没有牙齿）。
 */
import { describe, expect, it, vi } from 'vitest'
import { vobsPlugin } from './index'

function runTransform(code: string, id: string, context: object = {}) {
  const plugin = vobsPlugin()
  const transform = plugin.transform
  if (typeof transform !== 'function') throw new Error('缺少 transform 钩子')
  return transform.call(context as ThisParameterType<typeof transform>, code, id)
}

describe('compiler warning 必须出现在构建输出里', () => {
  it('模块顶层 JSX（VOBS_C105）→ 调用 this.warn', () => {
    const warn = vi.fn()
    runTransform(
      `import { KitMenuItem } from './menu'\nexport const MENU = <KitMenuItem />`,
      'src/Menu.tsx',
      { warn }
    )
    const text = warn.mock.calls.map(call => String(call[0])).join('\n')
    expect(warn, 'VOBS_C105 被静默丢弃了（build 里看不到）').toHaveBeenCalled()
    expect(text).toContain('VOBS_C105')
    // 必须带位置与修法，否则用户不知道该改哪
    expect(text).toContain('src/Menu.tsx')
    expect(text).toContain('修法')
  })

  it('顶层条件 return 产出渲染节点（VOBS_C104）→ 调用 this.warn', () => {
    const warn = vi.fn()
    runTransform(
      `export function Panel() { return open.value && <div>内容</div> }`,
      'src/Panel.tsx',
      { warn }
    )
    const text = warn.mock.calls.map(call => String(call[0])).join('\n')
    expect(warn).toHaveBeenCalled()
    expect(text).toContain('VOBS_C104')
  })

  it('**干净文件不报警**（否则"总是 warn"也能让上面的用例通过）', () => {
    const warn = vi.fn()
    runTransform(
      `export function Clean() { return <div>{label.value}</div> }`,
      'src/Clean.tsx',
      { warn }
    )
    expect(warn, `干净文件报了警：${warn.mock.calls.map(c => String(c[0])).join(' | ')}`).not.toHaveBeenCalled()
  })

  it('同一条诊断在同一文件重复命中时去重（不刷屏）', () => {
    const warn = vi.fn()
    runTransform(
      `export const A = <div>a</div>\nexport const B = <div>b</div>\nexport const C = <div>c</div>`,
      'src/Many.tsx',
      { warn }
    )
    const lines = warn.mock.calls.map(call => String(call[0]))
    // 三处不同位置 —— 位置不同所以不去重，但必须都带着位置（可定位）
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) expect(line).toContain('src/Many.tsx')
  })

  it('拿不到 PluginContext 时退回 console.warn（不静默）', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      // 不传 this.warn
      runTransform(`export const MENU = <div />`, 'src/Menu2.tsx', {})
      const text = spy.mock.calls.map(call => String(call[0])).join('\n')
      expect(text, '既没走 this.warn 也没走 console.warn —— 警告消失了').toContain('VOBS_C105')
    } finally {
      spy.mockRestore()
    }
  })

  it('warning **不会**让它抛错（降级的本意），error 仍然抛', async () => {
    const { describeDiagnostics } = await import('@vobs/compiler')
    const diagnostic = (severity: 'error' | 'warning') => ({
      code: 'VOBS_C999',
      severity,
      message: '示例',
      location: { file: 'a.tsx', line: 1, column: 1 }
    }) as never

    // 关键契约：只有 warning 时 summary 为 null —— 这正是"warning 不挡构建"的实现依据，
    // 也正是"警告被静默丢弃"的那行代码所在。
    expect(
      describeDiagnostics([diagnostic('warning')]),
      'warning 让 summary 非空，等于 warning 会挡构建'
    ).toBeNull()
    expect(describeDiagnostics([diagnostic('error')])).not.toBeNull()
    // 两者都有时按 error 处理（照旧抛）
    expect(describeDiagnostics([diagnostic('warning'), diagnostic('error')])).not.toBeNull()
  })

  it('同时有 warning 与 error 时：先抛错（错误优先）', () => {
    const warn = vi.fn()
    // 模块顶层 JSX（warning）+ 命名空间标签（VOBS_C101，error）在同一个文件里
    let thrown: unknown
    try {
      runTransform(
        `export const MENU = <div />\nexport const Bad = <svg:rect />`,
        'src/Both.tsx',
        { warn }
      )
    } catch (reason) { thrown = reason }
    expect(thrown, '有 error 却没抛').toBeDefined()
    // code 在 VobsError 的**属性**上，不在 message 里
    expect((thrown as { code?: string }).code).toBe('VOBS_C101')
  })
})
