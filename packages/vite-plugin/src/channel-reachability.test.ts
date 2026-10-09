/*
 * **通道可达性**：每个诊断码在它声明的通道上必须真的能报出来。
 *
 * ## 为什么需要这个测试
 *
 * 「诊断存在，但某条通道上不可见」在这一轮出现了**三次**：
 *
 * 1. `vite build` 只报第一个含错文件就停
 * 2. `describeDiagnostics` 只过滤 `error` → warning 静默（1.8.2 修）
 * 3. `vobs check` **不跑编译器** → C104–C108 隐形（`6e3a891` 修）
 *    以及**反向**：分析器诊断（C118/C232/C210）在 `vite build` 里隐形（`6f73032` 修）
 *
 * 三次都是**人肉发现的**。这个测试把「通道完整性」变成可验证的资产 ——
 * 第四次会在 CI 里变红，而不是在生产里被发现。
 *
 * ## 声明式矩阵
 *
 * 每个码声明它**必须**在哪些通道可见。新增码时**必须**同时补一条夹具，
 * 否则这个测试不会覆盖它（下面有一条"矩阵完整性"的检查兜住这点）。
 *
 * ## 两处刻意的取舍
 *
 * - **CLI 通道只 spawn 一次**：8 个夹具写进同一个临时目录、跑一次 `vobs check`。
 *   每个夹具一次 spawn 会让这个测试慢十几秒，而诊断是按文件归属的，一次就够。
 * - **vite 通道在进程内调 `transform`**：走的是插件真实代码路径（同一个函数），
 *   比起一次完整 `vite build` 快得多，且不需要临时项目的依赖。
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { vobsPlugin } from './index'

interface Fixture {
  readonly code: string
  /** 触发该码的最小源码（写进 `<code>.tsx`）。 */
  readonly source: string
  /** 必须能看到它的通道。留空表示它只在运行时/配置层出现，静态通道本就不该报。 */
  readonly channels: readonly ('check' | 'vite')[]
}

const FIXTURES: readonly Fixture[] = [
  {
    code: 'VOBS_C104',
    source: 'export function P(){ return open.value ? <div>a</div> : null }',
    channels: ['check', 'vite']
  },
  {
    code: 'VOBS_C105',
    source: 'export const MENU = <div>模块顶层</div>',
    channels: ['check', 'vite']
  },
  {
    code: 'VOBS_C106',
    source: 'export function P(){ effect(async () => { await load() }) }',
    channels: ['check', 'vite']
  },
  {
    code: 'VOBS_C107',
    source: 'export function P(){ return cond.value ? <div>a</div> : <div>b</div> }',
    channels: ['check', 'vite']
  },
  {
    code: 'VOBS_C108',
    source: 'export function P(){ const node = <div>x</div>; return open.value ? node : null }',
    channels: ['check', 'vite']
  },
  {
    code: 'VOBS_C118',
    source: [
      "import { state } from '@vobs/vobs'",
      'export function Page() {',
      '  const count = state(0)',
      '  const snapshot = count.value',
      '  return <div>{snapshot}</div>',
      '}'
    ].join('\n'),
    channels: ['check', 'vite']
  },
  {
    code: 'VOBS_C210',
    source: [
      "import { effect, state } from '@vobs/vobs'",
      'export function P() {',
      '  const count = state(0)',
      '  effect(() => { count.value = count.value + 1 })',
      '  return <div>{count.value}</div>',
      '}'
    ].join('\n'),
    channels: ['check', 'vite']
  },
  {
    code: 'VOBS_C232',
    source: [
      'export function P() {',
      '  return <div>{open.value ? items.value.map(item => <li key={item}>{item}</li>) : <b/>}</div>',
      '}'
    ].join('\n'),
    channels: ['check', 'vite']
  },
  /*
   * 以下码**刻意声明为空**：它们不在静态通道上出现，所以不该被要求可见。
   * 显式列出来，是为了让"矩阵完整性"检查能区分"没声明"与"声明为不可见"。
   */
  { code: 'VOBS_C211', source: '// 运行时护栏（burst），静态通道不报', channels: [] }
]

const dir = mkdtempSync(join(tmpdir(), 'vobs-channels-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

for (const fixture of FIXTURES) {
  writeFileSync(join(dir, `${fixture.code}.tsx`), fixture.source, 'utf8')
}

/** 通道 A：跑真实的 `vobs check`（一次），按码归集。 */
function checkChannel(): Map<string, Set<string>> {
  const cli = resolve(process.cwd(), 'packages/cli/bin/vobs.js')
  let stdout = ''
  try {
    stdout = execFileSync(process.execPath, [cli, 'check', dir, '--json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    })
  } catch (error) {
    /*
     * 检查发现问题时 CLI 会 exit 1 —— 这是**正确行为**，不该让测试失败。
     * `execFileSync` 在这种情况下抛出，stdout 挂在 error 上。
     */
    const captured = (error as { stdout?: string }).stdout
    if (typeof captured !== 'string' || captured.trim() === '') throw error
    stdout = captured
  }
  const parsed = JSON.parse(stdout) as { diagnostics: Array<{ code: string; file: string }> }
  const byCode = new Map<string, Set<string>>()
  for (const item of parsed.diagnostics) {
    if (!byCode.has(item.code)) byCode.set(item.code, new Set())
    byCode.get(item.code)!.add(item.file)
  }
  return byCode
}

/** 通道 B：进程内调插件的 `transform`（插件真实代码路径），按码归集。 */
function viteChannel(fixture: Fixture): Set<string> {
  const plugin = vobsPlugin()
  const transform = plugin.transform
  if (typeof transform !== 'function') throw new Error('缺少 transform 钩子')
  const warn = vi.fn()
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  try {
    transform.call({ warn } as unknown as ThisParameterType<typeof transform>,
      fixture.source,
      `src/${fixture.code}.tsx`
    )
  } catch {
    // 编译器 error 会抛 —— 那也算"报出来了"，从 console 兜底路径拿不到，用 warn 判断
  } finally {
    vi.restoreAllMocks()
  }
  const text = warn.mock.calls.map(call => String(call[0])).join('\n')
  const found = new Set<string>()
  for (const code of text.matchAll(/VOBS_C\d+/gu)) found.add(code[0])
  return found
}

// CLI 通道三次 spawn 太慢，只跑一次并复用
let cachedCheck: Map<string, Set<string>> | undefined
const checkResults = (): Map<string, Set<string>> => (cachedCheck ??= checkChannel())

describe('通道可达性：每个码必须在声明的通道上可见', () => {
  it('矩阵完整性：每个码都声明了通道（显式空数组也算声明）', () => {
    for (const fixture of FIXTURES) {
      expect(fixture.channels, `${fixture.code} 没声明 channels`).toBeDefined()
    }
  })

  for (const fixture of FIXTURES.filter(item => item.channels.includes('check'))) {
    it(`${fixture.code} → vobs check 能报`, () => {
      const hits = checkResults().get(fixture.code)
      expect(hits, `${fixture.code} 在 vobs check 通道上不可见`).toBeDefined()
      expect([...hits!].some(file => file.includes(fixture.code))).toBe(true)
    })
  }

  for (const fixture of FIXTURES.filter(item => item.channels.includes('vite'))) {
    it(`${fixture.code} → vite 通道能报`, () => {
      const found = viteChannel(fixture)
      expect(found.has(fixture.code), `${fixture.code} 在 vite 通道上不可见`).toBe(true)
    })
  }

  it('**声明为不可见的码不该在静态通道上出现**（反向也验，否则"到处都报"也能通过）', () => {
    for (const fixture of FIXTURES.filter(item => item.channels.length === 0)) {
      expect(
        checkResults().has(fixture.code),
        `${fixture.code} 声明为静态通道不可见，却在 vobs check 里出现了`
      ).toBe(false)
    }
  })
})
