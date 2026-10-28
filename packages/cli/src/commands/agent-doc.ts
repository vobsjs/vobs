import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DIAGNOSTIC_GUIDES } from '@vobs/runtime'
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
  /**
   * Agent 轻量知识分发通道（项目外可发现）：往指定目录写三个公网可 fetch 的文件
   * —— `llms.txt`（索引，llms.txt 规范）、`vobs-context.md`（完整契约）、
   * `diagnostics.md`（全部诊断码的 why/correct/wrong）。
   * 目标是让**还没安装 vobs** 的 Agent 先读懂契约再决定采用。
   */
  readonly llms?: string
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

export type ContractSyncStatus =
  | { readonly status: 'synced' }
  | { readonly status: 'missing' }
  | { readonly status: 'no-block' }
  | { readonly status: 'drifted'; readonly problems: readonly string[] }

/**
 * 契约版本对齐检查（供 `vobs check` 主入口与 `agent-doc --check` 共用）。
 *
 * 「契约随框架版本分发」不能只停留在生成时的承诺 —— 这里把它变成**每次检查都可验证**的事实：
 * 项目里已有的契约块（vobs:begin/end）逐字节比对当前框架契约，不一致即漂移。
 * `missing` / `no-block` 不是漂移 —— agent-doc 是显式 opt-in 的能力，未生成契约的项目
 * 不该被主入口骚扰（`agent-doc --check` 的 CI 硬校验语义在 agentDocCommand 里单独保留）。
 */
export function checkContractSync(root: string): ContractSyncStatus {
  const agentsPath = resolve(root, 'AGENTS.md')
  if (!existsSync(agentsPath)) return { status: 'missing' }
  const existing = readFileSync(agentsPath, 'utf8')
  const block = extractBlock(existing)
  if (block === null) return { status: 'no-block' }
  const generated = buildAgentsDoc(readContract())
  if (block !== extractBlock(generated)) {
    return {
      status: 'drifted',
      problems: ['AGENTS.md 的 vobs 契约块与当前框架版本不一致 —— 框架新增的诊断码与语义修正不在你现有的契约里']
    }
  }
  return { status: 'synced' }
}

/** 单个诊断码的文档节（diagnostics.md 与 diagnostics/<code>.md 单码页共用）。 */
function renderGuideSection(guide: (typeof DIAGNOSTIC_GUIDES)[number]): string[] {
  const lines: string[] = [
    `## ${guide.code} · ${guide.severity} — ${guide.title}`,
    '',
    `why: ${guide.why}`,
    '',
    `correct: ${guide.correct}`,
    '',
    `wrong: ${guide.wrong}`,
    ''
  ]
  for (const rewrite of guide.rewrites ?? []) {
    lines.push(
      '```ts',
      `// before (triggers ${guide.code})`,
      rewrite.wrong,
      '// after (zero diagnostics)',
      rewrite.correct,
      '```',
      ''
    )
  }
  return lines
}

/** 诊断码知识文档：全部 `VOBS_C*` 的 why / correct / wrong / rewrites（`vobs explain` 的可 fetch 版）。 */
export function buildDiagnosticsDoc(): string {
  const lines: string[] = [
    '# vobs diagnostics',
    '',
    'All `VOBS_C*` codes with why / correct / wrong, plus machine-applicable `rewrites`',
    '(before → after pairs verified by guide-verification: rewriting to `after` yields zero diagnostics).',
    'Runtime query: `vobs explain <code>` / `vobs explain --json`. Single-code pages: `diagnostics/<code>.md`.',
    ''
  ]
  for (const guide of DIAGNOSTIC_GUIDES) lines.push(...renderGuideSection(guide))
  return lines.join('\n')
}

/** 单码页：按需 fetch 一个诊断码，不拉全表。 */
export function buildSingleDiagnosticDoc(code: string): string | null {
  const guide = DIAGNOSTIC_GUIDES.find(item => item.code === code)
  if (!guide) return null
  return [
    `# ${guide.code} · ${guide.severity} — ${guide.title}`,
    '',
    ...renderGuideSection(guide).slice(1)
  ].join('\n')
}

/** llms.txt 索引（llms.txt 规范：H1 + blockquote 摘要 + 链接分节）。 */
export function buildLlmsIndex(): string {
  return [
    '# vobs',
    '',
    '> Signals-first compiled UI framework: run-once components, fine-grained updates, standard JSX.',
    '> AI-first: machine-generated contract, dual-layer diagnostics (static + runtime guardrails), every fix verified.',
    '',
    '## Start here',
    '',
    '- [vobs-context.md](/vobs-context.md): the full AI contract — component model (run-once), reactive graph semantics (conditional dependencies, on/untrack), JSX rules, error codes. Load this first.',
    '- [diagnostics.md](/diagnostics.md): every `VOBS_C*` code with why / correct / wrong.',
    '',
    '## CLI',
    '',
    '- `vobs agent-doc --write`: write this contract into your project AGENTS.md (marker-block merge, user content preserved).',
    '- `vobs check`: whole-repo static analysis + compiler diagnostics; also verifies the contract is in sync with the installed framework version.',
    '- `vobs explain <code>` / `vobs explain --json`: query any diagnostic (schema is stable, additive-only; includes verified `rewrites`).',
    '- `vobs check:runtime --json`: machine-readable runtime guardrail verdict `{ pass, routes: [{ route, status, guardFailures }] }` from a real Chrome pass — run it after generating code to self-verify before asking a human.',
    '- `vobs mcp`: MCP stdio server (JSON-RPC 2.0) exposing `check_runtime`, `explain_diagnostic`, `contract_status` — point a coding agent at it for autonomous verification.',
    '- Per-diagnostic pages: [diagnostics/VOBS_C233.md](/diagnostics/VOBS_C233.md) pattern (one file per code, fetch on demand instead of pulling the full table).'
  ].join('\n')
}

/** 上下文成本指标（可验证的 Agent 友好性：ArrowJS 用「文档占上下文窗口比例」做卖点，同一思路）。 */
export function estimateTokens(text: string): number {
  // 近似：CJK 字符约 1 token/字，ASCII 约 4 字符/token。契约中日文混排，取保守上界。
  const cjk = (text.match(/[\u4e00-\u9fff\u3040-\u30ff]/gu) ?? []).length
  const rest = text.length - cjk
  return cjk + Math.ceil(rest / 4)
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

  if (options.llms !== undefined) {
    const llmsDir = resolve(root, options.llms)
    mkdirSync(llmsDir, { recursive: true })
    const context = `${readContract()}\n`
    const diagnostics = buildDiagnosticsDoc()
    writeFileSync(resolve(llmsDir, 'llms.txt'), `${buildLlmsIndex()}\n`, 'utf8')
    writeFileSync(resolve(llmsDir, 'vobs-context.md'), context, 'utf8')
    writeFileSync(resolve(llmsDir, 'diagnostics.md'), diagnostics, 'utf8')
    // 按需 fetch 的单码页：Agent 查单个诊断码不用拉全表（层级化分发）
    mkdirSync(resolve(llmsDir, 'diagnostics'), { recursive: true })
    for (const guide of DIAGNOSTIC_GUIDES) {
      writeFileSync(resolve(llmsDir, 'diagnostics', `${guide.code}.md`), `${buildSingleDiagnosticDoc(guide.code)}\n`, 'utf8')
    }
    console.log(`[agent-doc] Agent 知识分发文件已写入 ${llmsDir}`)
    console.log(`  - llms.txt（索引）`)
    console.log(`  - vobs-context.md（契约全文，约 ${estimateTokens(context)} tokens）`)
    console.log(`  - diagnostics.md（${DIAGNOSTIC_GUIDES.length} 个诊断码，约 ${estimateTokens(diagnostics)} tokens）+ diagnostics/<code>.md 单码页`)
    console.log(`部署到公网任意路径后，Agent 无需安装 vobs 即可 fetch 读懂契约。`)
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
