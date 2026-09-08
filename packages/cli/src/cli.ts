import { cac } from 'cac'
import { initCommand } from './commands/init.js'
import { devCommand } from './commands/dev.js'
import { buildCommand } from './commands/build.js'
import { generateCommand } from './commands/generate.js'
import { addCommand } from './commands/add.js'
import { showBanner, showLogo, showDevBanner } from './banner.js'

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
    .command('logo', 'Show the vobs CLI logo and version info')
    .action(() => {
      showLogo()
    })

  cli.on('--help', () => {
    showBanner()
  })

  cli.help()
  cli.version('1.0.0')

  return cli
}