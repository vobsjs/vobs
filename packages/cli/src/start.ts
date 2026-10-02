import { createCLI, KNOWN_SUBCOMMANDS } from './cli.js'
import { showBanner } from './banner.js'
import { startRepl } from './repl.js'

/** 帮助/版本文本里出现的 flag —— 它们不是"未知 flag"。 */
const META_FLAGS = new Set(['--help', '-h', '--version', '-V'])

/**
 * 该 flag 是否属于**顶层**用法（相对"某个子命令的 flag"而言）。
 *
 * `vobs --port 3000` 里的 `--port` 不是顶层 flag（它属于 `dev`），
 * 所以这里只认 `-`/`--` 开头的未知项，交由调用方按"有没有子命令"决定是不是错误。
 */
function isFlag(token: string): boolean {
  return token.startsWith('-') && token !== '-'
}

/**
 * 单命令分发。
 *
 * 此前 `start()` 在 `--version` 之后直接 `createCLI().parse()` 就结束，而 cac 对
 * "没有命令匹配"**不做任何兜底**：既不报错、也不输出、退出码还是 0。
 * 于是 `vobs chekc`（拼错）在 CI 里静默成功；`vobs --totally-unknown` 同样 0 字节 + exit 0。
 * 这里补上兜底：未知子命令与未知顶层 flag 都进 stderr 且 **exit 1**。
 */
export async function start(args: string[]): Promise<void> {
  // No args (or explicit `cli`) → launch the interactive REPL
  if (args.length === 0 || args[0] === 'cli') {
    await startRepl()
    return
  }

  const first = args[0]
  const hasSubcommand = KNOWN_SUBCOMMANDS.includes(first)

  /*
   * `--version` / `-V` 只有在**没有子命令**时才表示"打印版本"。
   * 此前是 `args.includes('--version')` —— 任何位置出现都会短路，
   * 于是 `vobs check --version` 只打 banner、check 根本没跑（静默吞掉一个真命令）。
   */
  if (!hasSubcommand && (args.includes('--version') || args.includes('-V'))) {
    showBanner()
    return
  }

  if (!hasSubcommand && !isFlag(first)) {
    process.stderr.write(`✖ 未知命令：${first}\n\n`)
    try {
      createCLI().parse(['node', 'vobs', '--help'])
    } catch {
      // 帮助输出失败不应掩盖真正的错误：错误已写进 stderr、退出码才是判据
    }
    process.exitCode = 1
    return
  }

  if (!hasSubcommand && isFlag(first) && !META_FLAGS.has(first)) {
    process.stderr.write(`✖ 未知选项：${first}\n\n`)
    try {
      createCLI().parse(['node', 'vobs', '--help'])
    } catch {
      // 同上
    }
    process.exitCode = 1
    return
  }

  // Let cac read the full process.argv so single-shot commands dispatch correctly
  try {
    createCLI().parse()
  } catch (error) {
    /*
     * cac 对**已匹配子命令**的未知选项/缺值会抛 `CACError`。此前它一路冒到
     * `bin/vobs.js` 的顶层 `await start(...)`（无 try/catch），用户看到的是
     * 半屏 Node 栈而不是一句可读的错误。
     */
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`✖ ${message}\n`)
    process.exitCode = 1
  }
}
