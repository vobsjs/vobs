/*
 * `vite-plugin` 必须**也报分析器诊断**（`C118`/`C232`/`C210` 静态规则）。
 *
 * ## 缺口的形状
 *
 * 「诊断存在，但某条通道上不可见」这一轮出现三次。普查（`.artifacts/p7-survey.md`）
 * 发现**缺口是双向的**：
 *
 * - 我修过：编译器诊断在 `vobs check` 里不可见（`6e3a891`）
 * - **但反向同样成立**：分析器诊断在 `vite build`/`dev` 里**一条都不报**
 *
 * 后果：开发时看不到，只有人主动跑 `vobs check` 或 CI 才发现 —— 与「错了不能静默」
 * 直接冲突：**AI 改完代码、`vite build` 通过，但问题还在。**
 *
 * 规则本体已抽到 `@vobs/compiler`（`analyze.ts`），CLI 与 vite-plugin 共用同一份，
 * 所以两个通道的结论**必然一致**（同一个实现）。
 */
import { describe, expect, it, vi } from 'vitest'
import { vobsPlugin } from './index'

function runTransform(code: string, id: string, context: object = {}) {
  const plugin = vobsPlugin()
  const transform = plugin.transform
  if (typeof transform !== 'function') throw new Error('缺少 transform 钩子')
  return transform.call(context as ThisParameterType<typeof transform>, code, id)
}

describe('vite 通道必须能看到分析器诊断', () => {
  it('组件体里读信号存成常量（VOBS_C118）→ this.warn 报出来', () => {
    const warn = vi.fn()
    runTransform(
      `import { state } from '@vobs/vobs'
       export function Page() {
         const count = state(0)
         const snapshot = count.value
         return <div>{snapshot}</div>
       }`,
      'src/Page.tsx',
      { warn }
    )
    const text = warn.mock.calls.map(call => String(call[0])).join('\n')
    expect(warn, 'VOBS_C118 没被报出来 —— 它在 vite 通道上还是隐形的').toHaveBeenCalled()
    expect(text).toContain('VOBS_C118')
    expect(text, '应带上位置').toContain('src/Page.tsx')
    expect(text, '应带上修法（只报错对 AI 没有价值）').toContain('修法')
  })

  it('**干净文件不报警**（否则"总是 warn"也能让上面通过）', () => {
    const warn = vi.fn()
    runTransform(
      `export function Clean() { return <div>{label.value}</div> }`,
      'src/Clean.tsx',
      { warn }
    )
    const text = warn.mock.calls.map(call => String(call[0])).join('\n')
    expect(text, `干净文件报了警：${text}`).not.toContain('VOBS_C1')
    expect(text).not.toContain('VOBS_C2')
  })

  it('拿不到 PluginContext 时退回 console.warn（不静默）', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      runTransform(
        `import { state } from '@vobs/vobs'
         export function Page() {
           const count = state(0)
           const snapshot = count.value
           return <div>{snapshot}</div>
         }`,
        'src/Page2.tsx',
        {}
      )
      const text = spy.mock.calls.map(call => String(call[0])).join('\n')
      expect(text, '分析器诊断既没走 this.warn 也没走 console.warn').toContain('VOBS_C118')
    } finally {
      spy.mockRestore()
    }
  })
})
