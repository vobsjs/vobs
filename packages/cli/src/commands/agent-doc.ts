import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { AGENT_CONTRACT } from '../templates/agent-contract.js'

/**
 * `vobs agent-doc` —— 把框架契约**生成**到当前项目，供任何 LLM / agent 读取。
 *
 * ## 为什么是"生成"而不是"手写"
 *
 * 契约随框架演进（1.8.0 加 `Show`/`ClientOnly`、1.8.3 加 `on()` 与 `VOBS_C106`、
 * 1.8.4 加 `VOBS_C107`、1.8.5 改 fix 文案）。手写的话，每个项目一份副本，
 * **必然各自漂移**；而且写的人未必知道最新契约。
 *
 * 生成则天然与版本绑定：`@vobs/cli@1.8.x` 产出 1.8.x 的契约。
 *
 * ## 设计要点
 *
 * 1. **标记块**：只替换 `<!-- vobs:begin -->` 与 `<!-- vobs:end -->` 之间的内容，
 *    块外的**项目自有约定原样保留** —— 重新生成不会覆盖你自己的东西。
 * 2. **`--check`**：校验项目里那份是否与当前框架版本一致，不一致 exit 1。
 *    可以进 CI —— 这样"文档漂移"从"靠人记得"变成"机器拦"。
 * 3. **`CLAUDE.md` 只写一行 `@AGENTS.md`**：内容只有一份，避免两份副本漂移。
 * 4. 由**框架**产出，不由用户手抄；工具无关（内容里不提任何特定 LLM）。
 */

const BEGIN = '<!-- vobs:begin 由 `vobs agent-doc --write` 生成，请勿手改 -->'
const END = '<!-- vobs:end -->'

export interface AgentDocOptions {
  /** 目标目录，默认当前工作目录。 */
  readonly dir?: string
  /** 写入文件（否则打到 stdout）。 */
  readonly write?: boolean
  /** 校验项目里那份是否与当前框架版本一致；不一致 exit 1。 */
  readonly check?: boolean
  /** 只输出框架契约正文（不含标记块外的说明）。 */
  readonly body?: boolean
}

/** 契约正文内联在 `templates/agent-contract.ts`（见那里的注释：读文件在全量测试下会失败）。 */
function readContract(): string {
  return AGENT_CONTRACT.trim()
}

/** 把契约包进标记块 —— 块外是项目自己的内容，重新生成不会动它。 */
function buildAgentsDoc(contract: string): string {
  return [
    BEGIN,
    '',
    contract,
    '',
    END,
    '',
    '<!-- 以下是本项目的自有约定，`vobs agent-doc --write` 不会覆盖。 -->',
    '',
    '## 本项目约定',
    '',
    '（在这里写你自己的目录结构、命名、业务流程等规则。）',
    ''
  ].join('\n')
}

/** 取出文件里的标记块内容（没有标记块时返回 null）。 */
function extractBlock(text: string): string | null {
  const start = text.indexOf(BEGIN)
  const end = text.indexOf(END)
  if (start < 0 || end < 0 || end < start) return null
  return text.slice(start, end + END.length)
}

/**
 * 合并：保留块外内容，只替换块。
 *
 * 没有标记块的既有 `AGENTS.md`（用户手写的）**不直接覆盖** ——
 * 把生成块**追加在后**，用户原有内容全部保留。丢掉别人的规则比不生成更糟。
 */
function mergeAgentsDoc(existing: string | null, generated: string): string {
  if (existing === null) return generated
  const block = extractBlock(generated)
  if (block === null) return generated
  if (extractBlock(existing) === null) return `${existing.trimEnd()}\n\n${block}\n`
  return existing.replace(extractBlock(existing)!, block)
}

export async function agentDocCommand(options: AgentDocOptions = {}): Promise<void> {
  const root = resolve(options.dir ?? process.cwd())
  const contract = readContract()

  if (options.body === true) {
    process.stdout.write(`${contract}\n`)
    return
  }

  const generated = buildAgentsDoc(contract)
  const agentsPath = resolve(root, 'AGENTS.md')
  const claudePath = resolve(root, 'CLAUDE.md')
  // 内容只有一份：CLAUDE.md 只做入口，避免两份副本漂移
  const claudeDoc = '@AGENTS.md\n'

  if (options.check === true) {
    const problems: string[] = []
    if (!existsSync(agentsPath)) {
      problems.push('AGENTS.md 不存在 —— 跑 `vobs agent-doc --write` 生成')
    } else {
      const existing = readFileSync(agentsPath, 'utf8')
      const block = extractBlock(existing)
      if (block === null) {
        problems.push('AGENTS.md 里找不到 vobs 标记块 —— 跑 `vobs agent-doc --write` 补上')
      } else if (block !== extractBlock(generated)) {
        problems.push('AGENTS.md 的 vobs 契约块与当前框架版本不一致 —— 跑 `vobs agent-doc --write` 同步')
      }
    }
    if (!existsSync(claudePath)) {
      problems.push('CLAUDE.md 不存在 —— 跑 `vobs agent-doc --write` 生成（内容只需一行 `@AGENTS.md`）')
    } else if (!readFileSync(claudePath, 'utf8').includes('@AGENTS.md')) {
      problems.push('CLAUDE.md 没有指向 @AGENTS.md')
    }

    if (problems.length > 0) {
      console.error('[agent-doc] 契约与框架版本不同步：')
      for (const problem of problems) console.error(`  - ${problem}`)
      process.exitCode = 1
      return
    }
    console.log('[agent-doc] 契约与当前框架版本一致 ✓')
    return
  }

  if (options.write !== true) {
    process.stdout.write(generated)
    return
  }

  const existingAgents = existsSync(agentsPath) ? readFileSync(agentsPath, 'utf8') : null
  writeFileSync(agentsPath, mergeAgentsDoc(existingAgents, generated), 'utf8')
  writeFileSync(claudePath, claudeDoc, 'utf8')
  console.log(`[agent-doc] 已写入 ${agentsPath}`)
  console.log(`[agent-doc] 已写入 ${claudePath}（内容为 @AGENTS.md）`)
  if (existingAgents !== null && extractBlock(existingAgents) === null) {
    console.log('[agent-doc] 你原有的 AGENTS.md 内容已保留，vobs 契约块追加在后。')
  }
}
