import { cac } from 'cac'
import { initCommand } from './commands/init.js'
import { mcpCommand } from './commands/mcp.js'
import { devCommand } from './commands/dev.js'
import { buildCommand } from './commands/build.js'
import { generateCommand } from './commands/generate.js'
import { addCommand } from './commands/add.js'
import { dshCommand } from './commands/dsh.js'
import { checkCommand } from './commands/check.js'
import { agentDocCommand } from './commands/agent-doc.js'
import { explainCommand } from './commands/explain.js'
import { apiCommand } from './commands/api.js'
import { showBanner, showLogo, showDevBanner } from './banner.js'
import { cliVersion } from './version.js'

export function createCLI(): ReturnType<typeof cac> {
  const cli = cac('vobs')

  cli
    .command('init [name]', 'Create a new vobs project')
    .option('--dir <dir>', 'Target directory')
    .option('--pm <pm>', 'Package manager (pnpm/npm/yarn)')
    .option('--no-typescript', 'Do not use TypeScript')
    .option('--no-git', 'Do not initialize git')
    .action(async (name: string, options: Record<string, unknown>) => {
      await initCommand({
        name,
        targetDir: options.dir as string | undefined,
        packageManager: options.pm as 'pnpm' | 'npm' | 'yarn' | undefined,
        typescript: options.typescript !== false,
        git: options.git !== false
      })
    })

  cli
    .command('create [name]', 'Alias for init')
    .option('--dir <dir>', 'Target directory')
    .option('--pm <pm>', 'Package manager (pnpm/npm/yarn)')
    .option('--no-typescript', 'Do not use TypeScript')
    .option('--no-git', 'Do not initialize git')
    .action(async (name: string, options: Record<string, unknown>) => {
      await initCommand({
        name,
        targetDir: options.dir as string | undefined,
        packageManager: options.pm as 'pnpm' | 'npm' | 'yarn' | undefined,
        typescript: options.typescript !== false,
        git: options.git !== false
      })
    })

  cli
    .command('dev', 'Start the dev server')
    .option('--config <path>', 'Vite config file')
    .option('--port <port>', 'Port to listen on')
    .option('--open', 'Open browser on start')
    .action(async (options: Record<string, unknown>) => {
      showDevBanner()
      await devCommand({
        config: options.config as string | undefined,
        port: options.port as number | undefined,
        open: options.open as boolean | undefined
      })
    })

  cli
    .command('build', 'Build for production')
    .option('--config <path>', 'Vite config file')
    .option('--outDir <dir>', 'Output directory')
    .option('--mode <mode>', 'Build mode')
    .action(async (options: Record<string, unknown>) => {
      await buildCommand({
        config: options.config as string | undefined,
        outDir: options.outDir as string | undefined,
        mode: options.mode as string | undefined
      })
    })

  cli
    .command('generate [name]', 'Generate code (component/page)')
    .alias('g')
    .option('--type <type>', 'Type: component or page')
    .option('--dir <dir>', 'Target directory')
    .action(async (name: string, options: Record<string, unknown>) => {
      await generateCommand({
        name,
        type: (options.type as 'component' | 'page') || undefined,
        targetDir: options.dir as string | undefined
      })
    })

  cli
    .command('add [package]', 'Add a package')
    .option('-D, --dev', 'Save as dev dependency')
    .action(async (pkg: string, options: Record<string, unknown>) => {
      await addCommand({
        package: pkg,
        dev: options.dev as boolean | undefined
      })
    })

  cli
    .command('check [dir]', 'Statically check source: effect self-subscription / list written into a branch / signal reads in the component body (inline suppression: write // vobs-check-ignore-next-line on the previous line)')
    .option('--json', 'Output as JSON (for AI and tools)')
    .option('--write', `Write the report to ${'.vobs/check.json'} (read by the devtools panel)`)
    .option('--include-tests', 'Include test files in the check (skipped by default)')
    .option('--no-compiler', 'Skip compiler diagnostics (static analysis only; faster)')
    .action(async (dir: string | undefined, options: Record<string, unknown>) => {
      await checkCommand({
        dir,
        json: options.json === true,
        write: options.write === true,
        includeTests: options.includeTests === true,
        // With --no-compiler, commander sets compiler to false
        compiler: options.compiler !== false
      })
    })

  cli
    .command('api [query]', 'Framework export index (which package exports which name)')
    .option('--json', 'Machine-readable output (for AI and tools)')
    .option('--dir <dir>', 'Repository root directory')
    .action(async (query: string | undefined, options: Record<string, unknown>) => {
      await apiCommand({ query, json: options.json === true, dir: options.dir as string | undefined })
    })

  cli
    .command('explain [code]', 'Diagnostic code reference (Rust\'s rustc --explain pattern)')
    .option('--json', 'Machine-readable output')
    .option('--missing', 'List codes that exist in the source but have no entry')
    .option('--dir <dir>', 'Source root directory used by --missing')
    .action(async (code: string | undefined, options: Record<string, unknown>) => {
      await explainCommand({
        code,
        json: options.json === true,
        missing: options.missing === true,
        dir: options.dir as string | undefined
      })
    })

  cli
    .command('agent-doc', 'Generate/verify the LLM-facing framework contract (AGENTS.md + CLAUDE.md)')
    .option('--dir <dir>', 'Target directory', { default: process.cwd() })
    .option('--write', 'Write files (prints to stdout by default)')
    .option('--check', 'Verify the project copy matches the current framework version (CI-ready)')
    .option('--body', 'Print only the contract body (without the marker block)')
    .option('--llms <dir>', 'Generate agent knowledge-distribution files (llms.txt / vobs-context.md / diagnostics.md)')
    .action(async (options: Record<string, unknown>) => {
      await agentDocCommand({
        dir: options.dir as string | undefined,
        write: options.write === true,
        check: options.check === true,
        body: options.body === true,
        llms: options.llms as string | undefined
      })
    })
  cli
    .command('mcp', 'MCP stdio server (JSON-RPC 2.0): agents autonomously invoke runtime guardrails / diagnostic details / contract status')
    .action(async () => {
      await mcpCommand()
    })

  cli
    .command('dsh [action] [target]', 'DSH plugin toolchain (init / dev / build / check / install)')
    .option('--dir <dir>', 'init: target directory')
    .option('--pm <pm>', 'init: package manager (pnpm/npm)')
    .option('--port <port>', 'dev: preview port', { default: 5199 })
    .option('--profile <name>', 'install: DSH profile name', { default: 'desktop' })
    .option('--spec <spec>', 'install: full install spec')
    .option('--repo <owner/name>', 'install: GitHub owner/name')
    .option('--tag <ref>', 'install: Git tag / branch / commit')
    .option('--subpath <path>', 'install: subdirectory within the repo')
    .option('--from <path>', 'install: install from a local directory')
    .option('--dry', 'install: print the command without executing it')
    .action(async (action: string, target: string | undefined, options: Record<string, unknown>) => {
      await dshCommand(action, target, {
        dir: options.dir as string | undefined,
        pm: options.pm as 'pnpm' | 'npm' | undefined,
        profile: options.profile as string | undefined,
        spec: options.spec as string | undefined,
        repo: options.repo as string | undefined,
        tag: options.tag as string | undefined,
        subpath: options.subpath as string | undefined,
        from: options.from as string | undefined,
        dry: options.dry === true,
        port: options.port === undefined ? undefined : Number(options.port)
      })
    })

  cli
    .command('logo', 'Show the vobs CLI logo and version info')
    .action(() => {
      showLogo()
    })

  cli.on('--help', () => {
    showBanner()
  })

  cli.help()
  cli.version(cliVersion())

  return cli
}

/**
 * Registered subcommand names (including aliases).
 *
 * Reason it exists: cac does nothing for "no command matched" (no error, no output — it
 * just returns), while `start()`'s `--version` short-circuit uses
 * `args.includes('--version')` — so `vobs chekc` (typo) silently "succeeds", and
 * `vobs check --version` only prints the banner while check never runs. This list
 * separates "run a command" from "top-level usage error".
 */
export const KNOWN_SUBCOMMANDS: readonly string[] = [
  'init', 'create', 'dev', 'build', 'generate', 'g', 'add', 'check', 'dsh', 'agent-doc', 'explain', 'api', 'logo'
]
