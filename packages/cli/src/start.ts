import { createCLI } from './cli.js'
import { showBanner } from './banner.js'
import { startRepl } from './repl.js'

/** Entry point: decides between interactive REPL and single-shot commands */
export async function start(args: string[]): Promise<void> {
  // No args (or explicit `cli`) → launch the interactive REPL
  if (args.length === 0 || args[0] === 'cli') {
    await startRepl()
    return
  }

  if (args.includes('--version') || args.includes('-V')) {
    showBanner()
    return
  }

  // Let cac read the full process.argv so single-shot commands dispatch correctly
  createCLI().parse()
}