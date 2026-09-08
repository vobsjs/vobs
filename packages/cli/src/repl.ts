import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import pc from 'picocolors'
import { showLogo, showBanner } from './banner.js'
import { initCommand } from './commands/init.js'
import { generateCommand } from './commands/generate.js'
import { addCommand } from './commands/add.js'

/**
 * Interactive REPL shell. Runs `vobs` with no arguments and stays in CLI
 * mode accepting repeated commands until the user types `exit` / `quit`
 * or presses Ctrl+C / Ctrl+D.
 */
export async function startRepl(): Promise<void> {
  showLogo()

  const rl = createInterface({
    input: stdin,
    output: stdout,
    prompt: `  ${pc.magenta('❯')} `,
    terminal: true
  })

  rl.prompt()

  for await (const rawLine of rl) {
    const line = rawLine.trim()

    if (!line) {
      rl.prompt()
      continue
    }

    // Split into args, honoring simple double quotes
    const args = splitArgs(line)

    try {
      await dispatch(args)
    } catch (err) {
      console.error(`  ${pc.red('✖')} ${err instanceof Error ? err.message : String(err)}`)
    }

    rl.prompt()
  }
}

type Command = (args: string[]) => Promise<void>

/** Internal command table for the REPL */
const TABLE: Record<string, { cmd: Command; help: string }> = {
  help: {
    cmd: async () => {
      console.log(`  ${pc.bold('Available commands:')}`)
      console.log(`    ${pc.dim('exit|quit')}      Leave the interactive CLI`)
      console.log(`    ${pc.dim('clear')}          Clear the screen`)
      console.log(`    ${pc.dim('logo')}           Re-print the banner`)
      console.log(`    ${pc.dim('version')}        Show version`)
      console.log(`    ${pc.dim('init <name>')}    Create a new vobs project`)
      console.log(`    ${pc.dim('generate <name>')} Generate a component/page`)
      console.log(`    ${pc.dim('add <package>')}   Add a package`)
      console.log(`    ${pc.dim('dev|build')}       Use \`vobs dev\` / \`vobs build\` in a terminal`)
    },
    help: ''
  },
  logo: { cmd: async () => showLogo(), help: '' },
  version: { cmd: async () => showBanner(), help: '' },
  clear: {
    cmd: async () => {
      process.stdout.write('\x1Bc')
    },
    help: ''
  },
  exit: { cmd: async () => process.exit(0), help: '' },
  quit: { cmd: async () => process.exit(0), help: '' },
  init: {
    cmd: async (args) => {
      await initCommand({
        name: args[0],
        targetDir: undefined,
        packageManager: undefined,
        typescript: true,
        git: true
      })
    },
    help: ''
  },
  generate: {
    cmd: async (args) => {
      await generateCommand({
        name: args[0],
        type: undefined,
        targetDir: undefined
      })
    },
    help: ''
  },
  g: {
    cmd: async (args) => {
      await generateCommand({
        name: args[0],
        type: undefined,
        targetDir: undefined
      })
    },
    help: ''
  },
  add: {
    cmd: async (args) => {
      await addCommand({ package: args[0], dev: args.includes('-D') || args.includes('--dev') })
    },
    help: ''
  }
}

/** Dispatch a parsed command line to the internal table */
async function dispatch(args: string[]): Promise<void> {
  const name = args[0]
  const rest = args.slice(1)

  if (!name) return

  const entry = TABLE[name]
  if (entry) {
    await entry.cmd(rest)
    return
  }

  console.log(`  ${pc.yellow('⚠')} Unknown command: ${pc.bold(String(name))}. Type ${pc.cyan('help')} to see options.`)
}

/** Minimal tokenizer supporting double-quoted arguments */
function splitArgs(line: string): string[] {
  const out: string[] = []
  const re = /[^\s"']+|"([^"]*)"|'([^']*)'/g
  let m: RegExpExecArray | null
  while ((m = re.exec(line)) !== null) {
    out.push(m[1] ?? m[2] ?? m[0])
  }
  return out
}