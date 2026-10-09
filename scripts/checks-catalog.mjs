/*
 * `pnpm run checks` —— **仓库能力索引**：列出"已经替你做过的事"。
 *
 * ## 为什么需要它（实测 4 次重复造轮子换来的）
 *
 * 这一轮里我在同一个失败模式上栽了**四次**：
 *
 * | # | 我重复的东西 | 为什么没早发现 |
 * |---|---|---|
 * | 1 | `inferStateDebugName`（已存在且更正确） | 没查导出 |
 * | 2 | `onDestroy`（能力有，只是名字是 `onDispose`） | 没查导出 |
 * | 3 | `vobs check` 是全仓扫描（用户还手搓了一个） | 没查命令 |
 * | 4 | **`scripts/check-imports.mjs`** —— 白写一遍，还按错误结论改坏了 3 个包 | 没读文件头 |
 *
 * **`vobs api` 拦不住 3 与 4** —— 它索引的是"导出的符号"，而我重复的是
 * **"仓库已有的检查/脚本"**，那是另一层。拦住我的其实是**那个文件的头注释**。
 *
 * 所以这个索引解决的是：把「先查有没有」从**两次操作**（想起来 → 去找）
 * 压成**一次**（跑一条命令）。
 *
 * ## 数据来源
 *
 * - `package.json` 的 scripts（名字 + 命令）
 * - 被指向的 `scripts/*.mjs` 的**头注释第一段**（这个仓库的头注释写得很实在，
 *   里面常有"为什么必须单独查"和"踩过的坑"—— 那正是最该被先读到的部分）
 *
 * **自动抽取**，所以随仓库演进自动更新，不会漂移。
 *
 * ## 用法
 *
 * ```
 * pnpm run checks            # 打印索引
 * pnpm run checks -- --write # 写成 docs/checks.md（便于被直接读到）
 * ```
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const json = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const scripts = json.scripts ?? {}

/** 取一个文件头注释里的**第一段**（标题句 + 紧随的一段）。 */
function headerSummary(file) {
  let text
  try { text = readFileSync(file, 'utf8') } catch { return null }
  const match = text.match(/^\s*\/\*\*([\s\S]*?)\*\//)
  if (!match) return null
  const lines = match[1]
    .split(/\r?\n/)
    .map(line => line.replace(/^\s*\*\s?/, '').trim())
  // 跳过纯装饰行，取第一段连续非空文本
  const out = []
  let started = false
  for (const line of lines) {
    if (!started) {
      if (line === '' || line.startsWith('```')) continue
      started = true
    }
    if (line === '' && out.length > 0) break
    out.push(line)
  }
  return out.join(' ').replace(/\s+/g, ' ').trim() || null
}

/** 找出 scripts/ 下的全部 .mjs（含子目录）。 */
function listScriptFiles(dir, depth = 0) {
  if (depth > 3 || !existsSync(dir)) return []
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) { out.push(...listScriptFiles(full, depth + 1)); continue }
    if (entry.name.endsWith('.mjs')) out.push(full)
  }
  return out
}

const scriptFiles = listScriptFiles(path.join(ROOT, 'scripts'))

/** npm script 名 → 它跑的仓库脚本（只认 scripts/ 下的 .mjs）。 */
function scriptFileFor(name) {
  const command = scripts[name] ?? ''
  const match = command.match(/scripts[/\\]([\w.-]+\.mjs)/)
  if (match === null) return null
  return scriptFiles.find(file => path.basename(file) === match[1]) ?? null
}

const CHECK_PREFIX = /^(?:check|verify|test|lint|release)/
const entries = Object.keys(scripts)
  .filter(name => CHECK_PREFIX.test(name) || scriptFileFor(name) !== null)
  .sort()
  .map(name => {
    const file = scriptFileFor(name)
    return {
      command: name,
      value: scripts[name],
      file: file === null ? null : path.relative(ROOT, file).split(path.sep).join('/'),
      summary: file === null ? null : headerSummary(file)
    }
  })

/** 渲染 `docs/checks.md` 的完整内容。`--write` 与 `--check` 共用，保证两者永不脱节。 */
function renderCatalog(entries) {
  const lines = [
    '# 仓库能力索引',
    '',
    '> **本文件由 `pnpm run checks -- --write` 生成，不要手改。**',
    '>',
    '> 动手写新的脚本 / 检查 / 工具之前**先看这里** ——',
    '> 实测有 4 次「重复造轮子」，其中一次还按错误结论改坏了 3 个包。',
    '> 要查**导出符号**用 `vobs api <关键词>`；要查**诊断规则**用 `vobs explain`。',
    ''
  ]
  for (const item of entries) {
    lines.push(`## \`${item.command}\``)
    lines.push('')
    lines.push(item.summary ?? '（该脚本没有头注释摘要）')
    lines.push('')
    lines.push(`- 运行：\`pnpm run ${item.command}\``)
    if (item.file !== null) lines.push(`- 实现：\`${item.file}\``)
    lines.push('')
  }
  return lines.join('\n')
}

/*
 * `--check`：比对 `docs/checks.md` 与当前仓库是否一致，不一致就**失败**。
 *
 * ## 为什么必须有它
 *
 * `docs/checks.md` 是**生成物**，但生成物最大的风险是**悄悄失真** ——
 * 加了新脚本、改了头注释，文档还停在旧样子。而"索引失信"正是这一轮
 * 重复造 5 次轮子的根因（第 5 次就是没意识到 `check-imports` 已经存在）。
 *
 * 一个会漂移的索引，比没有索引更糟：它让人**以为查过了**。
 *
 * 做法与 `vobs agent-doc --check` 相同：重新渲染 → 与磁盘比对。
 * 因为整份文件都是生成的，直接比全文最简单也最不容易留死角。
 */
const TARGET = path.join(ROOT, 'docs', 'checks.md')
const rendered = renderCatalog(entries)

if (process.argv.includes('--check')) {
  if (!existsSync(TARGET)) {
    console.error('docs/checks.md 不存在 —— 跑 `pnpm run checks -- --write` 生成。')
    process.exitCode = 1
  } else {
    const onDisk = readFileSync(TARGET, 'utf8').replace(/\r\n/g, '\n')
    if (onDisk !== rendered.replace(/\r\n/g, '\n')) {
      console.error('docs/checks.md 与当前仓库**不一致** —— 索引已失真。')
      console.error('  修法：pnpm run checks -- --write')
      // 指出第一处差异，省去人工全文 diff
      const a = onDisk.split('\n')
      const b = rendered.split('\n')
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if (a[i] !== b[i]) {
          console.error(`  第一处差异在第 ${i + 1} 行：`)
          console.error(`    磁盘: ${a[i] ?? '(无)'}`)
          console.error(`    当前: ${b[i] ?? '(无)'}`)
          break
        }
      }
      process.exitCode = 1
    } else {
      console.log(`vobs checks --check —— docs/checks.md 与仓库一致（${entries.length} 项）✓`)
    }
  }
} else if (process.argv.includes('--write')) {
  writeFileSync(TARGET, rendered, 'utf8')
  console.log(`已写入 docs/checks.md（${entries.length} 项）`)
} else {
  console.log(`仓库能力索引（${entries.length} 项）—— 动手前先看这里\n`)
  for (const item of entries) {
    console.log(`  ${item.command}`)
    if (item.summary !== null) console.log(`      ${item.summary.slice(0, 110)}`)
    if (item.file !== null) console.log(`      → ${item.file}`)
  }
  console.log('\n写成文档：pnpm run checks -- --write')
}
