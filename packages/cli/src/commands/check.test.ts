import { describe, expect, it } from 'vitest'
import { analyzeSource, VOBS_C118, VOBS_C210, VOBS_C232, type CheckDiagnostic } from './check'

const codes = (diagnostics: readonly CheckDiagnostic[]): string[] => diagnostics.map(item => item.code)

describe('vobs check · VOBS_C210 effect 自订阅', () => {
  /*
   * **这条测试原先断言"误报存在"** —— 我用它把已知限制固定下来，等修好那天它会变红。
   * 那天到了：effect 回调体内**重新声明**过的名字（作用域遮蔽）不再被当成外层信号。
   * 于是断言反过来：**不该报**。严重度也已恢复成 error。
   */
  it('同名局部对象遮蔽**不再**误报（曾经的已知限制，已修）', () => {
    const found = analyzeSource(`
      import { state, effect } from '@vobs/vobs'
      export function P() {
        const count = state(0)
        effect(() => {
          const count = { value: 0 }
          count.value = count.value + 1
        })
        return count.value
      }
    `, 'a.tsx')
    expect(codes(found), '这是局部对象，不是信号 —— 不该报 C210').not.toContain(VOBS_C210)
  })

  it('抓到读 + 写同一个信号', () => {
    const found = analyzeSource(`
import { state, effect } from '@vobs/vobs'
const count = state(0, 'count')
effect(() => {
  count.value++
})
`, 'a.ts')
    expect(codes(found)).toContain(VOBS_C210)
    const item = found.find(entry => entry.code === VOBS_C210)!
    /*
     * **error**（已恢复）。当初降级为 warning 的唯一依据是实测出的误报
     * 「同名局部对象遮蔽」—— 那个误报已修掉：effect 回调体内**重新声明**过的名字
     * 不再被当成外层信号（见 analyze.ts 里 `shadowed` 集合的注释），
     * 对抗测试从 6/7 变成 **7/7**。
     */
    expect(item.severity).toBe('error')
    expect(item.message).toContain('"count"')
    // 文案与运行时护栏**共用同一份**（@vobs/runtime 的 diagnostic-text）：
    // 先教结构（on()），untrack 是兜底 —— 两处都含这两个关键词
    expect(item.fix).toContain('on(')
    expect(item.fix).toContain('untrack')
    expect(item.line).toBe(5)
  })

  it('untrack 包住的写入不报 —— 正是建议的写法', () => {
    const found = analyzeSource(`
import { state, effect, untrack } from '@vobs/vobs'
const count = state(0, 'count')
effect(() => {
  untrack(() => { count.value++ })
})
`, 'a.ts')
    expect(codes(found)).not.toContain(VOBS_C210)
  })

  it('只写不读不算自订阅（例如 effect 里初始化别的信号）', () => {
    const found = analyzeSource(`
import { state, effect } from '@vobs/vobs'
const a = state(0)
const b = state(0)
effect(() => {
  b.value = 1
})
`, 'a.ts')
    expect(codes(found)).not.toContain(VOBS_C210)
  })

  it('嵌套函数里的读写不算在本次 effect 上', () => {
    const found = analyzeSource(`
import { state, effect } from '@vobs/vobs'
const count = state(0)
effect(() => {
  const bump = () => { count.value++ }
  bump()
})
`, 'a.ts')
    expect(codes(found)).not.toContain(VOBS_C210)
  })

  it('> .set() 也算写入', () => {
    const found = analyzeSource(`
import { state, effect } from '@vobs/vobs'
const count = state(0)
effect(() => {
  if (count.value < 1) count.set(count.value + 1)
})
`, 'a.ts')
    expect(codes(found)).toContain(VOBS_C210)
  })
})

describe('vobs check · VOBS_C232 列表写进分支', () => {
  it('三元分支里的 map 会失去 keyed 复用', () => {
    const found = analyzeSource(`
export function List(props: { ok: boolean; items: string[] }) {
  return <div>{props.ok ? <span>empty</span> : props.items.map(item => <b key={item}>{item}</b>)}</div>
}
`, 'a.tsx')
    expect(codes(found)).toContain(VOBS_C232)
    expect(found.find(entry => entry.code === VOBS_C232)?.fix).toContain('直接的')
  })

  it('&& 右侧的 map 同样报', () => {
    const found = analyzeSource(`
export function List(props: { items: string[] }) {
  return <div>{props.items.length > 0 && props.items.map(item => <b key={item}>{item}</b>)}</div>
}
`, 'a.tsx')
    expect(codes(found)).toContain(VOBS_C232)
  })

  it('直接的子表达式列表不报 —— 这是推荐写法', () => {
    const found = analyzeSource(`
export function List(props: { items: string[] }) {
  return <ul>{props.items.map(item => <li key={item}>{item}</li>)}</ul>
}
`, 'a.tsx')
    expect(codes(found)).not.toContain(VOBS_C232)
  })

  it('分支里不是 list 的不报', () => {
    const found = analyzeSource(`
export function A(props: { ok: boolean }) {
  return <div>{props.ok ? <span>a</span> : <em>b</em>}</div>
}
`, 'a.tsx')
    expect(codes(found)).toEqual([])
  })
})

describe('vobs check · VOBS_C118 组件体里读信号', () => {
  it('读信号存进 const 又在 JSX 里用 —— 组件体只跑一次', () => {
    const found = analyzeSource(`
import type { Signal } from '@vobs/vobs'
export function Panel(props: { name: Signal<string> }) {
  const current = props.name.value
  return <div>{current}</div>
}
`, 'a.tsx')
    expect(codes(found)).toContain(VOBS_C118)
    const item = found.find(entry => entry.code === VOBS_C118)!
    expect(item.severity).toBe('warning')
    expect(item.fix).toContain('memo')
    expect(item.message).toContain('"current"')
  })

  it('读取直接写在 JSX 表达式里不报', () => {
    const found = analyzeSource(`
import type { Signal } from '@vobs/vobs'
export function Panel(props: { name: Signal<string> }) {
  return <div>{props.name.value}</div>
}
`, 'a.tsx')
    expect(codes(found)).not.toContain(VOBS_C118)
  })

  it('memo 派生不报 —— 那是正确写法', () => {
    const found = analyzeSource(`
import { memo, type Signal } from '@vobs/vobs'
export function Panel(props: { name: Signal<string> }) {
  const current = memo(() => props.name.value.toUpperCase())
  return <div>{current.value}</div>
}
`, 'a.tsx')
    expect(codes(found)).not.toContain(VOBS_C118)
  })

  it('不是组件的函数不报（不返回 JSX）', () => {
    const found = analyzeSource(`
import type { Signal } from '@vobs/vobs'
export function read(signal: Signal<string>) {
  const current = signal.value
  return current.toUpperCase()
}
`, 'a.ts')
    expect(codes(found)).not.toContain(VOBS_C118)
  })

  /*
   * 回归：这条曾经在真实项目里刷出 21 条误报。
   * `const handler = () => { signal.value }` 里的读取是**延迟**的（点击时才读），
   * 完全正常 —— 第一版的遍历会钻进函数体，把所有事件处理器都报成「组件体里读信号」。
   */
  it('事件处理器里的读取不报 —— 那是延迟读取', () => {
    const found = analyzeSource(`
import { state } from '@vobs/vobs'
const count = state(0)
export function Panel() {
  const bump = () => { count.value++ }
  const simulateMismatch = () => { const current = count.value; return current + 1 }
  return <button onClick={bump}>{simulateMismatch()}</button>
}
`, 'a.tsx')
    expect(codes(found)).not.toContain(VOBS_C118)
  })
})

describe('vobs check · 汇总', () => {
  it('干净文件没有问题', () => {
    const found = analyzeSource(`
import { state, memo } from '@vobs/vobs'
const count = state(0)
const doubled = memo(() => count.value * 2)
export function Counter() {
  return <button onClick={() => count.value++}>{doubled.value}</button>
}
`, 'a.tsx')
    expect(found).toEqual([])
  })

  it('诊断按位置排序，且带可定位的 snippet', () => {
    const found = analyzeSource(`
import { state, effect } from '@vobs/vobs'
const count = state(0)
effect(() => { count.value++ })
`, 'a.ts')
    expect(found.length).toBeGreaterThan(0)
    expect(found[0]?.snippet).toContain('count.value++')
    const lines = found.map(item => item.line)
    expect([...lines].sort((a, b) => a - b)).toEqual(lines)
  })
})

/*
 * 行内抑制。三条规则都是启发式的（靠名字与形状判断），有些合法代码恰好长成那样 ——
 * 检查器没有逃生口的话，用户只能关掉整条规则，那比漏报更糟。
 */
describe('vobs check · 行内抑制', () => {
  const 自订阅 = (前一行: string) => `
import { state, effect } from '@vobs/vobs'
const count = state(0, 'count')
effect(() => {
${前一行}
  count.value++
})
`

  it('上一行的 // vobs-check-ignore-next-line 抑制下一行', () => {
    expect(codes(analyzeSource(自订阅('  // vobs-check-ignore-next-line'), 'a.ts'))).not.toContain(VOBS_C210)
  })

  it('没有注释时照常报', () => {
    expect(codes(analyzeSource(自订阅('  // 只是普通注释'), 'a.ts'))).toContain(VOBS_C210)
  })

  it('只抑制「下一行」，不会顺带放过别的行', () => {
    // 第 5 行写了自订阅、第 7 行也写一个：抑制注释放在第 4 行只该影响第 5 行
    const source = `
import { state, effect } from '@vobs/vobs'
const count = state(0, 'count')
// vobs-check-ignore-next-line
effect(() => { count.value++ })
effect(() => { count.value++ })
`
    const found = analyzeSource(source, 'a.ts')
    expect(codes(found)).toContain(VOBS_C210)
    expect(found.filter(item => item.code === VOBS_C210).length).toBe(1)
    expect(found.find(item => item.code === VOBS_C210)?.line).toBe(6)
  })
})
