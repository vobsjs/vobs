/*
 * `vobs agent-doc` —— 把框架契约**生成**到项目里，供任何 LLM / agent 读取。
 *
 * ## 为什么是"生成"而不是"手写"
 *
 * 契约随框架演进（1.8.0 加 `Show`/`ClientOnly`、1.8.3 加 `on()`/`VOBS_C106`、
 * 1.8.4 加 `VOBS_C107`、1.8.5 改 fix 文案）。手写的话每个项目一份副本，**必然漂移**。
 * 生成则与版本绑定 —— 升级框架后重新生成即可。
 *
 * ## 要锁住的四条行为
 *
 * 1. **标记块**：只替换 `vobs:begin`/`vobs:end` 之间，块外是项目自有约定
 * 2. **不覆盖手写的 `AGENTS.md`**：没有标记块时**追加**生成块，原有内容全保留
 *    （丢掉别人的规则比不生成更糟）
 * 3. **`CLAUDE.md` 只写一行 `@AGENTS.md`**：内容只有一份，避免两份副本漂移
 * 4. **`--check`**：不一致时 exit 1，可进 CI —— 把"文档漂移"从"靠人记得"变成"机器拦"
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { agentDocCommand } from './agent-doc'

const created: string[] = []
function makeProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'vobs-agent-doc-'))
  created.push(dir)
  return dir
}
afterEach(() => {
  while (created.length > 0) rmSync(created.pop()!, { recursive: true, force: true })
})

/** 跑一次命令并吃掉它的 stdout（测试只关心退出码与文件）。 */
async function run(dir: string, options: Record<string, boolean>): Promise<void> {
  const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  try {
    await agentDocCommand({ dir, ...options })
  } finally {
    write.mockRestore(); log.mockRestore(); vi.restoreAllMocks()
  }
}

describe('vobs agent-doc', () => {
  it('--write 生成 AGENTS.md 与 CLAUDE.md，契约要点都在', async () => {
    const dir = makeProject()
    await run(dir, { write: true })

    const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    // 契约必须覆盖这轮落地的关键约束 —— 缺一条就等于没同步
    for (const key of ['run-once', 'RouterView', 'on(deps', 'VOBS_C107', 'VOBS_C210', 'parseNumber', 'ClientOnly']) {
      expect(agents, `契约里缺 ${key}`).toContain(key)
    }
    // 标记块存在（--check 靠它比对）
    expect(agents).toContain('vobs:begin')
    expect(agents).toContain('vobs:end')
    // 内容只有一份：CLAUDE.md 是指针，不是副本
    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8').trim()).toBe('@AGENTS.md')
  })

  it('**手写的 AGENTS.md 不被覆盖** —— 生成块追加在后', async () => {
    const dir = makeProject()
    writeFileSync(join(dir, 'AGENTS.md'), '# 我的项目约定\n- 目录：src/pages\n', 'utf8')
    await run(dir, { write: true })

    const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    expect(agents, '原有的项目约定被覆盖了').toContain('我的项目约定')
    expect(agents).toContain('目录：src/pages')
    expect(agents).toContain('vobs:begin')
  })

  it('再次 --write 只替换契约块，块外的新内容保留', async () => {
    const dir = makeProject()
    await run(dir, { write: true })
    // 用户在块外补自己的内容
    const first = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    writeFileSync(join(dir, 'AGENTS.md'), `${first}\n- 我的新增规则\n`, 'utf8')

    await run(dir, { write: true })
    const second = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    expect(second, '块外的用户内容被清掉了').toContain('我的新增规则')
    // 契约块仍然只有一份（不会重复追加）
    expect(second.match(/vobs:begin/gu)?.length).toBe(1)
  })

  it('--check：未生成时 exit 1，生成后通过', async () => {
    const dir = makeProject()
    process.exitCode = 0
    await run(dir, { check: true })
    expect(process.exitCode, '没生成却通过了检查').toBe(1)

    process.exitCode = 0
    await run(dir, { write: true })
    await run(dir, { check: true })
    expect(process.exitCode, '生成之后仍然检查失败').toBe(0)
    process.exitCode = 0
  })

  it('--check：契约块被手改后报不一致', async () => {
    const dir = makeProject()
    await run(dir, { write: true })
    const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    // 手改块内内容 —— 模拟框架升级后项目里那份没同步
    writeFileSync(join(dir, 'AGENTS.md'), agents.replace('run-once', 'run-once-手改过'), 'utf8')

    process.exitCode = 0
    await run(dir, { check: true })
    expect(process.exitCode, '块被改动了却通过检查').toBe(1)
    process.exitCode = 0
  })

  it('--check：CLAUDE.md 被改成副本而非指针时也有提示', async () => {
    const dir = makeProject()
    await run(dir, { write: true })
    writeFileSync(join(dir, 'CLAUDE.md'), '# 我把内容抄了一份\n', 'utf8')

    process.exitCode = 0
    await run(dir, { check: true })
    expect(process.exitCode, 'CLAUDE.md 没指向 AGENTS.md 却通过了').toBe(1)
    process.exitCode = 0
  })

  it('--body 只输出契约正文（无标记块）', async () => {
    const dir = makeProject()
    let captured = ''
    const write = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      captured += String(chunk)
      return true
    })
    try {
      await agentDocCommand({ dir, body: true })
    } finally {
      write.mockRestore()
    }
    expect(captured).toContain('run-once')
    expect(captured, '--body 不该带标记块').not.toContain('vobs:begin')
  })

  it('不加任何开关时打到 stdout、不写文件', async () => {
    const dir = makeProject()
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    try {
      await agentDocCommand({ dir })
    } finally {
      write.mockRestore()
    }
    expect(existsSync(join(dir, 'AGENTS.md')), '没加 --write 却写了文件').toBe(false)
  })
})
