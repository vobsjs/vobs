/*
 * **AI 常见错误的语料库 + 覆盖率测量**（P4 与 P2 的合体）。
 *
 * ## 为什么合成一件东西
 *
 * - **P4（评测）**要的是"典型 AI 写法能被编译期拦住多少"
 * - **P2（补静默类）**要的是"还有哪些'编译期合法、运行期错'的形态没被覆盖"
 *
 * 两者是同一份数据的两个视角：**每条语料声明它"应被哪条规则拦住"，
 * 或者"当前静默"**。测试断言**现状**，于是：
 * - 已覆盖的条目 = 评测的分母与分子
 * - `silent: true` 的条目 = **P2 的工作清单**（可见，不靠记忆）
 *
 * ## 语料为什么是「React 形状」
 *
 * AI 报错的大头来自 React 先验。而 vobs 与 React 有几处**根本不同**
 * （组件体只跑一次、无 deps 数组、JSX 是实例不是描述对象）。所以语料挑的是
 * **在 React 里完全正确、在 vobs 里错**的写法 —— 那才是最贵的一类。
 *
 * ## 这个文件的两个用途
 *
 * 1. **回归**：哪天某条被覆盖的形态又变静默了，测试变红
 * 2. **改进方向**：`silent: true` 的条目就是下一步要补的诊断（见 docs/silent-failures.md）
 */
import { describe, expect, it } from 'vitest'
import { compileWithSourceMap } from './index'
import { analyzeSource } from './analyze'

interface Mistake {
  /** 这条为什么是 AI 常犯的（一句话）。 */
  readonly why: string
  /** 典型错误源码。 */
  readonly source: string
  /** 期望被哪个码拦住；`null` 表示**当前静默**（P2 的工作清单）。 */
  readonly caughtBy: string | null
  /**
   * 对"静默"条目的说明：**为什么暂时不做**。
   * 每条静默项都必须写清原因 —— 否则它看起来像忘了。
   */
  readonly silentNote?: string
}

const CORPUS: readonly Mistake[] = [
  {
    why: 'React 里 `const node = <X/>; return cond ? node : null` 完全合法（描述对象随时重建），vobs 里节点被急切创建。',
    source: 'export function P(){ const node = <Picker el={p.value} />; return open.value ? node : null }',
    caughtBy: 'VOBS_C108'
  },
  {
    why: 'React 里 `return cond ? <A/> : null` 每次渲染都重求值；vobs 组件体只跑一次，顶层 return 处也没有 parent/anchor。',
    source: 'export function P(){ return cond.value ? <div>a</div> : null }',
    caughtBy: 'VOBS_C104'
  },
  {
    why: 'React 里 `cond ? <A/> : <B/>` 是最常见的条件渲染；vobs 里顶层 return 处两支都是 JSX 也**一样冻结**。',
    source: 'export function P(){ return cond.value ? <div>a</div> : <div>b</div> }',
    caughtBy: 'VOBS_C107'
  },
  {
    why: 'React 里把派生值取出来放变量很自然（每次渲染重算）；vobs 组件体只跑一次，那是快照。',
    source: [
      "import { state } from '@vobs/vobs'",
      'export function Page() {',
      '  const count = state(0)',
      '  const doubled = count.value * 2',
      '  return <div>{doubled}</div>',
      '}'
    ].join('\n'),
    caughtBy: 'VOBS_C118'
  },
  {
    why: 'React 的 `useEffect(fn, [deps])` 依赖显式声明，且 effect 里写 state 是日常；vobs 依赖自动收集，写自己读的信号即循环。',
    source: [
      "import { effect, state } from '@vobs/vobs'",
      'export function P() {',
      '  const count = state(0)',
      '  effect(() => { count.value = count.value + 1 })',
      '  return <div>{count.value}</div>',
      '}'
    ].join('\n'),
    caughtBy: 'VOBS_C210'
  },
  {
    why: 'React 的 effect 可以是 async（它 await 那个 Promise 只是不等待，但依赖数组让它安全）；vobs 依赖自动收集 + 不等 Promise，首个 await 前是同步的。',
    source: 'export function P(){ effect(async () => { await load() }) }',
    caughtBy: 'VOBS_C106'
  },
  {
    why: 'React 里模块顶层放 JSX 常量很常见（`const MENU = <Item/>`），因为没有"渲染器未初始化"这个阶段。',
    source: 'export const MENU = <div>顶层</div>',
    caughtBy: 'VOBS_C105'
  },
  {
    why: 'React 里 `{cond && list.map(...)}` 很常见，keyed 复用仍由 React 调度；vobs 里 list 写在分支中会失去 insertList。',
    source: 'export function P(){ return <div>{open.value && items.value.map(i => <li key={i}/>)}</div> }',
    caughtBy: 'VOBS_C232'
  },

  /* ---------- 以下为**当前静默**的形态：P2 的工作清单 ---------- */
  {
    why: 'React 里数组原地 push 后靠重新渲染生效；vobs 里引用没变，信号不通知。',
    source: 'export function P(){ const list = state([1]); list.value.push(2); return <div>{list.value.length}</div> }',
    caughtBy: null,
    silentNote: '需要作用域/绑定分析（确认 `list` 确实绑定到 state(...)），否则对普通数组的 push 会误报。'
  },
  {
    why: '组件体内提前 return null 做守卫 —— React 每次渲染重算，vobs 里挂载时固化。',
    source: 'export function P(){ if (loading.value) return null; return <div>done</div> }',
    caughtBy: null,
    silentNote: '**这是有意不做的**：同形态在"渲染辅助函数"里是**正确代码**'
      + '（`function renderRow(x) { if (empty.value) return null; return <tr/> }` 每次求值都重跑）。'
      + '要区分必须知道"这个函数是不是组件"，静态分析决定不了 —— 加了会误报。'
  },
  {
    /*
     * 这条**部分**被覆盖：把查表结果读进 const 这件事被 C118 抓到
     * （组件体只跑一次 → 那是快照）。而"白名单查表 miss → 静默空白"那一半
     * **静态抓不到**（白名单在应用侧），已由运行时缓解：`@vobs/icon-core` 在
     * definition 为空时发出**按名字去重的警告**（66350b9），控制台会点名。
     */
    why: 'React 里按名字查组件表很常见；vobs 里查表结果进 const 是快照（C118 抓），'
      + '而查表 miss 静默空白只有运行时能点名。',
    source: 'export function P(){ const icon = ICONS[name.value]; return <div>{icon}</div> }',
    caughtBy: 'VOBS_C118'
  },
  {
    why: 'React 的 `setState(newValue)` 不依赖读取；vobs 里 `.set()` 与 `.value =` 同义，写自己读的仍循环。',
    source: [
      "import { effect, state } from '@vobs/vobs'",
      'export function P() {',
      '  const count = state(0)',
      '  effect(() => { count.set(count.value + 1) })',
      '  return <div>{count.value}</div>',
      '}'
    ].join('\n'),
    caughtBy: 'VOBS_C210'
  }
]

/** 该源码在静态通道上报出的码（编译器 + 分析器，与 vobs check 一致）。 */
function codesOf(source: string): string[] {
  const compiled = compileWithSourceMap(source, { filename: 'a.tsx' }).diagnostics.map(item => item.code)
  const analyzed = analyzeSource(source, 'a.tsx').map(item => item.code)
  return [...new Set([...compiled, ...analyzed])]
}

const caught = CORPUS.filter(item => item.caughtBy !== null)
const silent = CORPUS.filter(item => item.caughtBy === null)

describe('AI 错误语料：已被编译期拦住的形态（回归）', () => {
  for (const item of caught) {
    it(`${item.caughtBy} ← ${item.why.slice(0, 40)}…`, () => {
      expect(codesOf(item.source), `这条本该被 ${item.caughtBy} 拦住，实际没报`).toContain(item.caughtBy)
    })
  }
})

describe('AI 错误语料：**当前静默**的形态（P2 工作清单）', () => {
  for (const item of silent) {
    it(`静默：${item.why.slice(0, 40)}…`, () => {
      // 断言**现状**（静默）。这条测试的作用是让缺口**可见**而不是被忘记：
      // 哪天补上了诊断，它会变红，提示把 caughtBy 改成对应的码。
      const codes = codesOf(item.source)
      expect(codes, `这条现在有诊断了（${codes.join(', ')}）—— 请把它移到"已覆盖"并填 caughtBy`).toEqual([])
      expect(item.silentNote, '静默项必须写清为什么不做的原因').toBeDefined()
    })
  }
})

describe('覆盖率（P4 的测量面）', () => {
  it('统计并打印覆盖率 —— 这是"编译期能拦住多少 AI 错误"的分子/分母', () => {
    const total = CORPUS.length
    const hit = caught.length
    const ratio = Math.round((hit / total) * 100)
    console.log(`  AI 错误语料覆盖率：${hit}/${total}（${ratio}%）`)
    console.log(`  当前静默（P2 工作清单）：${silent.length} 条`)
    for (const item of silent) console.log(`    - ${item.why.slice(0, 60)}`)
    expect(total).toBeGreaterThan(0)
    // 覆盖率只做记录，不设阈值 —— 设了就会诱使人写"容易通过的语料"
  })
})
