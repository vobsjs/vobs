/*
 * `vobs explain` 给出的**建议本身必须有效**（P3）。
 *
 * ## 这一轮吃过两次亏
 *
 * 1. **C104 的 fix 误导管线**：它推荐 `class={cond ? 'is-on' : 'is-off'}`，
 *    而真实项目只有组合选择器（`.seq-param-group.is-off`）—— 照着改会得到
 *    "类名加上了但样式不生效"。
 * 2. **C108 的 fix 第一版只对了一半**：它说"写到使用位置"，实测那**只对 JSX 子节点位置成立**；
 *    在组件顶层 `return` 处改成三元会**从"崩"变成"界面不切换"**（更隐蔽）。
 *
 * 两次都是**人肉发现**的。所以：**诊断的 fix 文案也是代码，也得验证。**
 *
 * ## 夹具的单一真相源（2026-10-28 起）
 *
 * before/after 改写对**不再是本文件的手写夹具**，而是 `DiagnosticGuide.rewrites`
 * 元数据（@vobs/runtime 的 diagnostic-guide.ts）—— `vobs explain --json` 与
 * `diagnostics.md` 原样透出给 AI。本文件只做一件事：**验证每一条 rewrites** ——
 * wrong 必须真的报出该码、correct 必须零诊断。元数据与验证同源，不可能漂移。
 */
import { describe, expect, it } from 'vitest'
import { compileWithSourceMap } from './index'
import { analyzeSource } from './analyze'
import { DIAGNOSTIC_GUIDES } from '@vobs/runtime'

/** 该源码在**静态通道**上报出了哪些码（编译器 + 分析器合并，与 vobs check 一致）。 */
function codesOf(source: string): string[] {
  const compiled = compileWithSourceMap(source, { filename: 'a.tsx' }).diagnostics.map(item => item.code)
  const analyzed = analyzeSource(source, 'a.tsx').map(item => item.code)
  return [...new Set([...compiled, ...analyzed])]
}

describe('每条 rewrites 都必须有效（元数据即真相）', () => {
  for (const guide of DIAGNOSTIC_GUIDES) {
    for (const [index, pair] of (guide.rewrites ?? []).entries()) {
      it(`${guide.code}[${index}]：反例必须报出该码`, () => {
        expect(codesOf(pair.wrong), `${guide.code} 的反例夹具没触发它 —— 这个验证就是空的`).toContain(guide.code)
      })

      it(`${guide.code}[${index}]：**按建议改写后必须零诊断**`, () => {
        const codes = codesOf(pair.correct)
        expect(codes, `${guide.code} 的建议改写后仍有诊断：${codes.join(', ')} —— 那是把用户引到另一个坑`).toEqual([])
      })
    }
  }

  it('**关键诊断码都带 rewrites**（缺一个 = AI 拿到码拿不到改写指令）', () => {
    const required = ['VOBS_C104', 'VOBS_C105', 'VOBS_C106', 'VOBS_C107', 'VOBS_C108',
      'VOBS_C118', 'VOBS_C120', 'VOBS_C210', 'VOBS_C232', 'VOBS_C233', 'VOBS_C234']
    for (const code of required) {
      const guide = DIAGNOSTIC_GUIDES.find(item => item.code === code)
      expect(guide?.rewrites?.length ?? 0, `${code} 没有 rewrites —— AI 只能拿到描述，拿不到可直接替换的 before/after`).toBeGreaterThan(0)
    }
  })
})
