import { cac } from 'cac'
import { initCommand } from './commands/init.js'
import { devCommand } from './commands/dev.js'
import { buildCommand } from './commands/build.js'
import { generateCommand } from './commands/generate.js'
import { addCommand } from './commands/add.js'
import { dshCommand } from './commands/dsh.js'
import { checkCommand } from './commands/check.js'
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
    .command('check [dir]', '静态检查源码：effect 自订阅 / 列表写进分支 / 组件体里读信号（行内抑制：上一行写 // vobs-check-ignore-next-line）')
    .option('--json', '以 JSON 输出（给 AI 与工具消费）')
    .option('--write', `把结果写到 ${'.vobs/check.json'}（开发台面板读它）`)
    .option('--include-tests', '把测试文件也纳入检查（默认跳过）')
    .action(async (dir: string | undefined, options: Record<string, unknown>) => {
      await checkCommand({
        dir,
        json: options.json === true,
        write: options.write === true,
        includeTests: options.includeTests === true
      })
    })

  cli
    .command('dsh [action] [target]', 'DSH 插件工具链（init / dev / build / check / install）')
    .option('--dir <dir>', 'init：目标目录')
    .option('--pm <pm>', 'init：包管理器（pnpm/npm）')
    .option('--port <port>', 'dev：预览端口', { default: 5199 })
    .option('--profile <name>', 'install：DSH profile 名', { default: 'desktop' })
    .option('--spec <spec>', 'install：完整安装 spec')
    .option('--repo <owner/name>', 'install：GitHub owner/name')
    .option('--tag <ref>', 'install：Git tag / 分支 / commit')
    .option('--subpath <path>', 'install：仓库内子目录')
    .option('--from <path>', 'install：从本地目录安装')
    .option('--dry', 'install：只打印命令，不执行')
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
 * 已注册的子命令名（含别名）。
 *
 * 存在的理由：cac 对"没有命令匹配"不做任何兜底（既不报错也不输出，直接返回），
 * 而 `start()` 的 `--version` 短路又用的是 `args.includes('--version')` ——
 * 于是 `vobs chekc`（拼错）静默成功，`vobs check --version` 则只打 banner、check 根本没跑。
 * 用这份清单把"跑某个命令"与"顶层用法错误"分开。
 */
export const KNOWN_SUBCOMMANDS: readonly string[] = [
  'init', 'create', 'dev', 'build', 'generate', 'g', 'add', 'check', 'dsh', 'logo'
]
