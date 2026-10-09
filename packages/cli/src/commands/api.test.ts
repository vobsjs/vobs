/*
 * `vobs api` —— 框架导出的可查询索引。
 *
 * ## 为什么需要它
 *
 * LLM 报错的大头是**猜错 API 形状**。这一轮里我自己栽过三次"能力已存在却不知道"
 * （差点重复实现 `inferStateDebugName`、差点把 `LayoutChildren` 做成破坏性变更、
 * 不知道 `vobs check` 全量扫描）—— 而我有**源码访问权**。与其让模型猜，不如给它查。
 *
 * ## 要锁住的
 *
 * 1. 索引来自**已构建的 `dist/*.d.ts`**（随包发布 → 与用户实际拿到的一致、版本准确）
 * 2. **未发布的内部包不进索引**（用户装不到它们，列出来只会误导）
 * 3. 按名与按包都能查
 * 4. 已知限制是**可见**的（kind 基本解析不出来，见 api.ts 的注释）——不假装支持
 */
import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildApiIndex } from './api'

const root = process.cwd()
const hasDist = existsSync(`${root}/packages/runtime/dist`)

describe.skipIf(!hasDist)('vobs api 索引', () => {
  const index = buildApiIndex(root)

  it('索引非空且覆盖多个包', () => {
    expect(index.length).toBeGreaterThan(200)
    expect(new Set(index.map(item => item.package)).size).toBeGreaterThan(10)
  })

  it('**本轮落地的 API 都能查到**（漏一个就等于那条能力仍不可发现）', () => {
    const names = new Set(index.map(item => item.name))
    for (const name of ['state', 'effect', 'untrack', 'on', 'Show', 'ClientOnly', 'onMount', 'onDestroy', 'applyClassList', 'parseNumber']) {
      expect(names.has(name), `${name} 查不到 —— 能力仍不可发现`).toBe(true)
    }
  })

  it('能查到某一个具体符号在哪个包（最常见的猜错）', () => {
    const entry = index.find(item => item.name === 'applyClassList')
    expect(entry?.package).toBe('@vobs/runtime')
  })

  it('**未发布的内部包不进索引**（列出来只会误导）', () => {
    for (const pkg of ['dsh-plugin-vobs', 'dsh-plugin-vobs-console']) {
      expect(index.some(item => item.package === pkg), `${pkg} 是 Git 安装的插件包，不该出现在 npm 索引里`).toBe(false)
    }
  })

  it('同一个包 + 同名的导出只有一条（去重）', () => {
    const keys = index.map(item => `${item.package}|${item.name}`)
    expect(new Set(keys).size, '有重复项').toBe(keys.length)
  })

  it('**种类解析覆盖率不能退回去** —— 曾经 1353/1355 全是 unknown', () => {
    /*
     * 演进：单遍 → 1353/1355 全 unknown；两遍法 → 196/1359（14%）；
     * 补上**别名映射**与**跨包种类回退** → 10/1359（0.7%）。
     *
     * 阈值定 0.9（当前 0.993）—— 守的是"那两条修法还在"，而不是精确值。
     * 退回两遍法（0.86）或单遍（0.001）都会立刻红。
     */
    const named = index.filter(item => item.kind !== 'unknown').length
    const ratio = named / index.length
    expect(ratio, `种类解析率只有 ${Math.round(ratio * 100)}% —— 别名映射或跨包回退是不是被去掉了？`)
      .toBeGreaterThan(0.9)
  })

  it('**跨包再导出**的名字能拿到种类 —— 这是 14% → 0.7% 的一半原因', () => {
    /*
     * `@vobs/vobs` 是一整行再导出列表（`export { AsyncBoundary, … }`），
     * 而这些名字声明在**兄弟包**（@vobs/dom / @vobs/kit）的 dist 里。
     * 按包收集的映射查不到 → 必须回退到全局同名声明。
     */
    const entry = index.find(item => item.name === 'AsyncBoundary' && item.package === '@vobs/vobs')
    expect(entry, 'AsyncBoundary 应在 @vobs/vobs 的索引里').toBeDefined()
    expect(entry!.kind, '跨包再导出的名字不该是 unknown').not.toBe('unknown')
  })

  it('**bundler 改名**（`index_X as X`）的名字也能拿到种类', () => {
    /*
     * 打包器会把声明改名为 `index_AlipaySdkConfig`，再 `export { index_… as AlipaySdkConfig }`。
     * 导出名与声明名不同 → 必须靠别名映射走两步。
     */
    const entry = index.find(item => item.name === 'AlipaySdkConfig' && item.package === '@vobs/payment')
    expect(entry, 'AlipaySdkConfig 应在 @vobs/payment 的索引里').toBeDefined()
    expect(entry!.kind, '经别名导出的名字不该是 unknown').not.toBe('unknown')
  })

  it('已知符号的种类正确（不是"解析出来但错了"）', () => {
    const kinds = new Map(index.map(item => [item.name, item.kind]))
    expect(kinds.get('state'), 'state 应该是函数').toBe('function')
    expect(kinds.get('onMount'), 'onMount 应该是函数').toBe('function')
  })

  it('每条都有包名与名字', () => {
    for (const item of index) {
      expect(item.package.startsWith('@vobs/')).toBe(true)
      expect(item.name).toMatch(/^[A-Za-z_$][\w$]*$/u)
    }
  })
})
