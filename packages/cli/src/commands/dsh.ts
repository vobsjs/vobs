import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { execSync, spawnSync } from 'node:child_process'
import { createServer, type ServerResponse } from 'node:http'
import { createRequire } from 'node:module'
import { isAbsolute, basename, dirname, join, relative, resolve } from 'node:path'
import * as p from '@clack/prompts'
import { logger } from '../utils/logger.js'
import { ensureDir, scaffoldProject } from '../utils/file.js'
import { installDependencies, type PackageManager } from '../utils/pm.js'

export interface DshOptions {
  dir?: string
  pm?: PackageManager
  profile?: string
  spec?: string
  repo?: string
  tag?: string
  subpath?: string
  from?: string
  dry?: boolean
  port?: number
}

/** 平台内置模块：这些 `require` 出现在产物里是正常的。 */
const PLATFORM_MODULES = ['react', 'react-dom']

const vobsVersion = (): string => {
  try {
    const manifest = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
    ) as { version?: string }
    return manifest.version ?? '1.7.5'
  } catch {
    return '1.7.5'
  }
}

/** 去掉 scope，得到 cordis 行 id 与目录名都可用的标识。 */
function toRowId(packageName: string): string {
  return packageName.replace(/^@[^/]+\//u, '')
}

/* ------------------------------------------------------------------ init */

async function dshInitCommand(target: string | undefined, options: DshOptions): Promise<void> {
  const name = target ?? ((await p.text({
    message: '插件包名（npm 包名，小写）:',
    placeholder: 'dsh-plugin-my-panel',
    validate: value => (/^[a-z0-9][a-z0-9._~-]*$/u.test(value) ? undefined : '必须是合法的 npm 包名')
  })) as string)

  if (p.isCancel(name)) {
    p.cancel('已取消')
    return
  }

  const packageManager =
    options.pm ??
    ((await p.select({
      message: '包管理器:',
      options: [
        { value: 'pnpm', label: 'pnpm' },
        { value: 'npm', label: 'npm' }
      ]
    })) as PackageManager)

  if (p.isCancel(packageManager)) {
    p.cancel('已取消')
    return
  }

  const targetDir = options.dir !== undefined ? resolve(options.dir) : resolve(process.cwd(), name)
  const rowId = toRowId(name)
  const displayName = rowId
    .replace(/^dsh-plugin-/u, '')
    .split('-')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')

  logger.step(`创建 DSH 插件项目 ${name} …`)
  await scaffoldProject(
    targetDir,
    { packageName: name, rowId, displayName, vobsVersion: vobsVersion() },
    'dsh-plugin'
  )

  // 单独写 .gitignore：模板里的点文件在打包时容易丢，而且这里的规则有一条很关键 ——
  // lib/ 是产物，**必须提交**（DSH 安装时不构建）。
  ensureDir(targetDir)
  writeFileSync(
    resolve(targetDir, '.gitignore'),
    ['node_modules/', '*.log', '*.tsbuildinfo', '', '# lib/ 是构建产物，必须提交：DSH 安装时不会构建你的包。', ''].join('\n'),
    'utf8'
  )
  logger.success('项目已生成')

  logger.step('安装依赖 …')
  try {
    installDependencies(targetDir, packageManager)
    logger.success('依赖已安装')
  } catch {
    logger.warn(`依赖安装失败，请手动执行 ${packageManager} install`)
  }

  logger.step('下一步')
  console.log(`
  cd ${name}
  ${packageManager} run dev     # 本地预览，不用装进 DSH
  ${packageManager} run build   # 产出 lib/{index,client}.js

  # 提交产物并打 tag 之后，在 DSH 插件页填：
  github:<owner>/<repo>#v0.1.0&path:/<本包在仓库中的路径>
`)
}

/* ----------------------------------------------------------------- build */

/**
 * 构建 DSH 插件产物。
 *
 * 一个可安装的插件包有**两半**：Host 侧（cordis 插件，ESM）与 Client 侧
 * （浏览器 bundle）。项目的 vite.config 只负责 Client（`dshBundle()` 会把产物
 * 落到 package.json 声明的位置），Host 这一半由本命令补上 ——
 * 否则 `exports["."]` 指向的文件根本不存在，装进 DSH 必然失败。
 */
async function dshBuildCommand(): Promise<void> {
  const projectDir = process.cwd()
  const configFile = resolve(projectDir, 'vite.config.ts')
  if (!existsSync(configFile)) {
    logger.error('当前目录没有 vite.config.ts，请在插件项目根目录运行。')
    process.exitCode = 1
    return
  }

  const manifest = readManifest(projectDir)
  if (manifest === undefined) {
    logger.error('读不到 package.json。')
    process.exitCode = 1
    return
  }

  const hostEntry = resolveExport(manifest, '.')
  if (hostEntry === undefined) {
    logger.error('package.json 的 exports 里没有 "."，DSH 加载不到 Host 侧插件。')
    process.exitCode = 1
    return
  }

  const { build } = await import('vite')

  logger.info('构建客户端产物 …')
  await build({ configFile, mode: 'production' })

  logger.info('构建 Host 产物 …')
  const hostTarget = resolve(projectDir, hostEntry.replace(/^\.\//u, ''))
  const hostEntrySource = resolve(projectDir, 'src', 'host', 'index.ts')
  if (!existsSync(hostEntrySource)) {
    logger.warn(`没有找到 ${hostEntrySource}，跳过 Host 构建。`)
    return
  }
  await build({
    configFile: false,
    root: projectDir,
    logLevel: 'warn',
    build: {
      outDir: relative(projectDir, dirname(hostTarget)) || '.',
      emptyOutDir: false,
      target: 'es2022',
      minify: false,
      sourcemap: false,
      lib: {
        entry: hostEntrySource,
        formats: ['es'],
        fileName: () => basename(hostTarget)
      }
    }
  })

  logger.success('构建完成 → 客户端与 Host 产物都已就位')
}

/* ------------------------------------------------------------------ dev */

/** 从 exports 字段里取出一个子路径，兼容字符串与一层条件对象两种写法。 */
export function resolveExport(manifest: Record<string, unknown>, key: string): string | undefined {
  const exportsField = (manifest.exports ?? {}) as Record<string, unknown>
  const entry = exportsField[key]
  if (typeof entry === 'string') return entry
  if (typeof entry === 'object' && entry !== null) {
    const record = entry as Record<string, unknown>
    for (const condition of ['default', 'import', 'require']) {
      const value = record[condition]
      if (typeof value === 'string') return value
    }
  }
  return undefined
}

/** 生成预览页。纯函数，便于单测。 */
export function buildPreviewHtml(options: { packageName: string; title?: string }): string {
  // 包名会被嵌进 <script> 里：JSON 序列化不会转义 `/`，所以必须自己把 `<` 干掉，
  // 否则一个含 </script> 的包名就能突破标签。
  const name = JSON.stringify(options.packageName).replace(/</gu, '\\u003c')
  const title = (options.title ?? options.packageName).replace(/[<>&]/gu, '')
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>vobs preview · ${title}</title>
</head>
<body>
<div id="root"></div>

<!-- 1. 先装垫片：必须在插件 bundle 之前，捕获它的 factory 注册 -->
<script>
  window.__VOBS_DSH_PREVIEW__ = { factories: new Map() };
  window.__ModuleLoader__ = {
    load: function (entry) { window.__VOBS_DSH_PREVIEW__.factories.set(entry.id, entry.factory); }
  };
</script>

<!-- 2. 插件产物：它只注册 factory，不产生副作用 -->
<script src="/client.js"></script>

<!-- 3. 启动预览外壳 -->
<script type="module">
  import { startPreview } from '/preview.js';
  window.__VOBS_PREVIEW__ = startPreview({
    container: document.getElementById('root'),
    packageName: ${name}
  });
</script>

<!-- 4. 重建后自动刷新；?static=1 关掉长连接，便于无头截图与 CI 断言 -->
<script>
  if (!location.search.includes('static')) {
    new EventSource('/events').addEventListener('reload', function () { location.reload(); });
  }
</script>
</body>
</html>
`
}

/**
 * vite 的构建监听器。只声明本命令用到的两个成员 ——
 * `vite` 没有把 rollup 的 `RollupWatcher` 再导出，为一个 dev 命令引入 rollup 类型不划算。
 */
interface BuildWatcher {
  on(event: 'event', handler: (event: { code?: string; error?: { message?: string } }) => void): void
  close(): Promise<void>
}

async function dshDevCommand(options: DshOptions): Promise<void> {
  const projectDir = process.cwd()
  const manifest = readManifest(projectDir)
  if (manifest === undefined) {
    logger.error('当前目录没有可读的 package.json。')
    process.exitCode = 1
    return
  }
  if (readManifest(projectDir)?.dsh === undefined) {
    logger.error('这不是一个 DSH 插件项目（package.json 里没有 dsh 字段）。')
    process.exitCode = 1
    return
  }

  const packageName = typeof manifest.name === 'string' ? manifest.name : 'dsh-plugin'
  const clientEntry = resolveExport(manifest, './client')
  if (clientEntry === undefined) {
    logger.error('package.json 的 exports 里没有 "./client"，页面拿不到客户端 bundle。')
    process.exitCode = 1
    return
  }
  const clientFile = resolve(projectDir, clientEntry.replace(/^\.\//u, ''))

  // 预览运行时从**项目自己**的 node_modules 解析：项目才是声明 @vobs/dsh 的那一方。
  let previewFile: string | undefined
  try {
    const projectRequire = createRequire(join(projectDir, 'package.json'))
    let packageRoot: string | undefined
    try {
      // 首选：包导出了 ./package.json（@vobs/dsh 有）。
      packageRoot = dirname(projectRequire.resolve('@vobs/dsh/package.json'))
    } catch {
      // 回退：解析主入口（dist/index.js 或 dist/index.cjs），再回到包根。
      packageRoot = dirname(dirname(projectRequire.resolve('@vobs/dsh')))
    }
    const candidate = join(packageRoot, 'dist', 'preview.js')
    previewFile = existsSync(candidate) ? candidate : undefined
  } catch {
    previewFile = undefined
  }
  if (previewFile === undefined) {
    logger.error('项目里找不到 @vobs/dsh 的预览运行时。先安装依赖：pnpm add -D @vobs/dsh')
    process.exitCode = 1
    return
  }

  const port = options.port ?? 5199
  const clients = new Set<ServerResponse>()
  const broadcast = (event: string): void => {
    for (const client of clients) client.write(`event: ${event}\ndata: 1\n\n`)
  }

  /* 先构建一次，再进监听模式 */
  logger.info('构建产物 …')
  const { build } = await import('vite')
  const configFile = resolve(projectDir, 'vite.config.ts')
  let buildError: string | undefined

  try {
    const watcher = (await build({
      configFile,
      mode: 'development',
      logLevel: 'warn',
      build: { watch: {} }
    })) as unknown as BuildWatcher

    watcher.on('event', event => {
      if (event.code === 'END') {
        buildError = undefined
        logger.success('重新构建完成')
        broadcast('reload')
      } else if (event.code === 'ERROR') {
        buildError = event.error?.message ?? '构建失败'
        logger.error(buildError)
      }
    })
    process.on('SIGINT', () => {
      void watcher.close().then(() => process.exit(0))
    })
  } catch (error) {
    logger.error(`构建失败：${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
    return
  }

  const server = createServer((request, response) => {
    const url = (request.url ?? '/').split('?')[0]

    if (url === '/events') {
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-store',
        connection: 'keep-alive'
      })
      response.write(': connected\n\n')
      clients.add(response)
      request.on('close', () => clients.delete(response))
      return
    }

    const send = (body: string | Buffer, type: string): void => {
      response.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' })
      response.end(body)
    }

    if (url === '/') {
      send(buildPreviewHtml({ packageName }), 'text/html; charset=utf-8')
      return
    }
    if (url === '/preview.js') {
      void readFile(previewFile as string).then(body => send(body, 'text/javascript; charset=utf-8'))
      return
    }
    if (url === '/client.js') {
      if (!existsSync(clientFile)) {
        response.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' })
        response.end(`还没有产物：${clientEntry}\n${buildError ?? ''}`)
        return
      }
      void readFile(clientFile).then(body => send(body, 'text/javascript; charset=utf-8'))
      return
    }

    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('not found')
  })

  await new Promise<void>(resolveListen => {
    server.listen(port, '127.0.0.1', resolveListen)
  })

  logger.success(`预览已就绪：http://127.0.0.1:${port}/`)
  console.log('\n  改代码会自动重建并刷新页面；Ctrl+C 退出。\n')
}

/* ----------------------------------------------------------------- check */

interface CheckResult {
  errors: string[]
  warnings: string[]
  passed: string[]
}

/** 读取并解析 package.json。 */
function readManifest(dir: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(readFileSync(resolve(dir, 'package.json'), 'utf8')) as Record<string, unknown>
  } catch {
    return undefined
  }
}

/**
 * 装前一致性校验：把「装进 DSH 之后才发现坏」的问题提前到本地。
 *
 * 检查项全部来自 DSH 的客户端插件契约与 pnpm 的 Git 子目录安装约束。
 */
export function collectIssues(dir: string): CheckResult {
  const result: CheckResult = { errors: [], warnings: [], passed: [] }
  const manifest = readManifest(dir)

  if (manifest === undefined) {
    result.errors.push('读不到 package.json（JSON 语法错误或文件缺失）')
    return result
  }

  const name = typeof manifest.name === 'string' ? manifest.name : ''
  if (name === '') result.errors.push('package.json 缺少 name')
  else result.passed.push(`包名 ${name}`)

  const dsh = (manifest.dsh ?? {}) as Record<string, unknown>
  const bundle = (dsh.bundle ?? {}) as Record<string, unknown>
  const client = (dsh.client ?? {}) as Record<string, unknown>

  if (typeof bundle.patch !== 'string') {
    result.errors.push('缺少 dsh.bundle.patch —— DSH 不会把这个包当作组合包（bundle）')
  } else {
    const patchPath = resolve(dir, bundle.patch.replace(/^\.\//u, ''))
    if (!existsSync(patchPath)) {
      result.errors.push(`dsh.bundle.patch 指向的 ${bundle.patch} 不存在`)
    } else {
      const text = readFileSync(patchPath, 'utf8')
      if (!text.includes('insert:')) result.errors.push('cordis.patch.yml 里没有 insert: 段落，插件行不会进组合树')
      else if (name !== '' && !text.includes(name)) {
        result.warnings.push(`cordis.patch.yml 里没有出现包名 ${name}，确认 insert 的 name 写对了`)
      } else result.passed.push('cordis.patch.yml 会插入本包的行')
    }
  }

  if (client.platform !== 'web') {
    result.errors.push("dsh.client.platform 必须是 'web' —— 否则 DSH 不会给页面提供客户端 bundle")
  } else result.passed.push('dsh.client.platform = web')

  const exportsField = (manifest.exports ?? {}) as Record<string, string>
  const hostEntry = exportsField['.']
  const clientEntry = exportsField['./client']
  if (typeof hostEntry !== 'string') result.errors.push('exports["."] 未声明 —— DSH 加载不到 Host 侧插件')
  else if (!existsSync(resolve(dir, hostEntry.replace(/^\.\//u, '')))) {
    result.errors.push(`exports["."] 指向的 ${hostEntry} 不存在，先构建`)
  } else result.passed.push('Host 入口存在')

  if (typeof clientEntry !== 'string') result.errors.push('exports["./client"] 未声明 —— 页面拿不到客户端 bundle')

  const scripts = (manifest.scripts ?? {}) as Record<string, string>
  if (scripts.prepare !== undefined || scripts.postinstall !== undefined) {
    result.errors.push('声明了 prepare / postinstall —— DSH 安装时不构建，产物必须预先提交')
  } else result.passed.push('没有安装期生命周期钩子')

  const dependencyText = JSON.stringify({
    dependencies: manifest.dependencies,
    peerDependencies: manifest.peerDependencies,
    devDependencies: manifest.devDependencies
  })
  if (dependencyText.includes('workspace:')) {
    result.errors.push('依赖里出现了 workspace: 协议 —— GitHub 子目录直装时解析不了')
  } else result.passed.push('没有 workspace: 协议依赖')

  if (typeof clientEntry === 'string') {
    const clientPath = resolve(dir, clientEntry.replace(/^\.\//u, ''))
    if (!existsSync(clientPath)) {
      result.errors.push(`客户端产物 ${clientEntry} 不存在，先运行构建`)
    } else {
      const code = readFileSync(clientPath, 'utf8')
      const loads = (code.match(/__ModuleLoader__\.load\(/gu) ?? []).length
      if (loads !== 1) result.errors.push(`客户端产物里 __ModuleLoader__.load 出现 ${loads} 次，应为 1 次（先构建）`)
      else result.passed.push('产物形态是 DSH 客户端模块协议')

      if (code.includes('import(')) result.errors.push('客户端产物里有动态 import()，DSH 只支持自包含 chunk')

      const requires = [...code.matchAll(/require\((['"])([^'"]+)\1\)/gu)].map(match => match[2] ?? '')
      const foreign = requires.filter(id => !PLATFORM_MODULES.includes(id) && !id.startsWith('@deepseek-ai/'))
      if (foreign.length > 0) {
        result.errors.push(`产物 require 了非平台模块：${[...new Set(foreign)].join(', ')} —— 依赖没有被打进产物`)
      } else if (requires.length > 0) {
        result.passed.push(`产物只 require 平台模块（${[...new Set(requires)].join(', ')}）`)
      }

      if (name !== '' && !code.includes(`"${name}"`) && !code.includes(`'${name}'`)) {
        result.warnings.push(`产物里的模块 id 与包名 ${name} 不一致，检查 dshBundle({ id })`)
      }
    }
  }

  return result
}

function dshCheckCommand(): void {
  const dir = process.cwd()
  const result = collectIssues(dir)

  logger.step('DSH 插件装前校验')
  for (const item of result.passed) console.log(`  ✔ ${item}`)
  for (const item of result.warnings) console.log(`  ⚠ ${item}`)
  for (const item of result.errors) console.log(`  ✖ ${item}`)

  if (result.errors.length > 0) {
    logger.error(`${result.errors.length} 项不通过，装进 DSH 后不会正常工作。`)
    process.exitCode = 1
    return
  }
  logger.success(`全部通过（${result.passed.length} 项${result.warnings.length > 0 ? `，${result.warnings.length} 条警告` : ''}）`)
}

/* --------------------------------------------------------------- install */

/** 读取 pnpm 版本；拿不到就返回 undefined。 */
function readPnpmVersion(): string | undefined {
  try {
    return execSync('pnpm --version', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return undefined
  }
}

const majorOf = (version: string | undefined): number => {
  const major = Number.parseInt((version ?? '').split('.')[0] ?? '', 10)
  return Number.isFinite(major) ? major : 0
}

/** 组装安装 spec。 */
export function buildInstallSpec(options: DshOptions): { spec?: string; error?: string } {
  if (options.spec !== undefined) return { spec: options.spec }

  if (options.from !== undefined) {
    const target = resolve(options.from)
    if (!existsSync(target)) return { error: `--from 指向的路径不存在：${target}` }
    return { spec: target }
  }

  if (options.repo !== undefined) {
    const ref = options.tag !== undefined && options.tag !== '' ? `#${options.tag}` : ''
    const sub = options.subpath !== undefined && options.subpath !== '' ? `${ref === '' ? '#' : '&'}path:${options.subpath}` : ''
    return { spec: `github:${options.repo}${ref}${sub}` }
  }

  return { error: '需要 --spec、--from 或 --repo 之一来指定安装来源。' }
}

/**
 * 在 Windows 上调用 dsh 的引号策略。
 *
 * `.cmd` 无法被 CreateProcess 直接执行（EINVAL），必须走 shell；而 shell 会把
 * 裸传参数原样拼接，`github:owner/repo#tag&path:/sub` 里的 `&` 就变成命令分隔符 ——
 * 实测会**静默地把 spec 截断成 `#tag`**，然后装上 monorepo 根而不是目标子包。
 * 所以含特殊字符的参数必须自己加引号。
 */
const CMD_NEEDS_QUOTE = /[\s&|<>^()"']/u

function quoteForCmd(part: string): string {
  return CMD_NEEDS_QUOTE.test(part) ? `"${part.replace(/"/gu, '""')}"` : part
}

/** 组装一条给 shell 执行的命令行（仅供 Windows 使用）。 */
export function buildShellCommand(exe: string, args: readonly string[]): string {
  return [exe, ...args].map(quoteForCmd).join(' ')
}

function spawnDsh(args: string[], dry: boolean): number {
  if (dry) {
    console.log(`\n  ${buildShellCommand('dsh', args)}\n`)
    return 0
  }

  if (process.platform === 'win32') {
    const result = spawnSync(buildShellCommand('dsh', args), { stdio: 'inherit', shell: true })
    return result.status ?? 1
  }

  const result = spawnSync('dsh', args, { stdio: 'inherit' })
  return result.status ?? 1
}

function dshInstallCommand(options: DshOptions): void {
  const profile = options.profile ?? 'desktop'
  const { spec, error } = buildInstallSpec(options)

  if (spec === undefined) {
    logger.error(error ?? '未知错误')
    process.exitCode = 1
    return
  }

  const usesSubpath = spec.includes('path:')
  const pnpmVersion = readPnpmVersion()

  if (usesSubpath && pnpmVersion !== undefined && majorOf(pnpmVersion) < 11) {
    logger.warn(
      `检测到 pnpm ${pnpmVersion}：11 以下不支持 git 子目录语法（#…&path:），` +
        '会静默装成仓库根而不是你想要的子包。DSH 内置的 pnpm 11 不受影响 —— 建议改用 DSH 插件页安装。'
    )
  }

  if (usesSubpath && process.platform === 'win32') {
    logger.info('Windows：会通过 cmd /d /s /c 执行，避免 & 被当成命令分隔符。')
  }

  logger.step(`安装到 profile「${profile}」`)
  console.log(`  spec: ${spec}`)

  if (!isAbsolute(spec) && !spec.startsWith('github:') && !spec.startsWith('git+') && !spec.startsWith('http')) {
    logger.warn('这个 spec 既不是绝对路径也不是 git/URL，确认没有写错。')
  }

  const status = spawnDsh(['plugin', '--profile', profile, 'add', spec], options.dry === true)
  if (options.dry === true) {
    logger.info('dry run：以上命令没有执行。')
    return
  }
  if (status !== 0) {
    logger.error(`安装失败（退出码 ${status}）。诊断日志在 ~/.dsh/profiles/${profile}/.plugin-manager/logs/`)
    process.exitCode = status
    return
  }
  logger.success('安装完成 —— 完全退出 DSH 再打开即可生效')
}

/* ------------------------------------------------------------- dispatcher */

const ACTIONS: Record<string, string> = {
  init: '创建一个 DSH 插件项目',
  dev: '本地预览（浏览器里看面板，不用装进 DSH）',
  build: '构建 lib/{index,client}.js',
  check: '装前一致性校验',
  install: '把插件装进 DSH profile'
}

/** `vobs dsh <action> [target]` 的分发入口。 */
export async function dshCommand(
  action: string | undefined,
  target: string | undefined,
  options: DshOptions
): Promise<void> {
  switch (action) {
    case 'init':
    case 'create':
      await dshInitCommand(target, options)
      return
    case 'dev':
      await dshDevCommand(options)
      return
    case 'build':
      await dshBuildCommand()
      return
    case 'check':
      dshCheckCommand()
      return
    case 'install':
      dshInstallCommand(options)
      return
    default:
      // 不带子命令时只列用法（这是最自然的「我该用什么」入口），
      // 真正写错子命令时才报错。
      if (action !== undefined && action !== '') logger.error(`未知子命令: ${action}`)
      console.log('\n  可用子命令：')
      for (const [name, description] of Object.entries(ACTIONS)) {
        console.log(`    vobs dsh ${name.padEnd(8)} ${description}`)
      }
      if (action !== undefined && action !== '') process.exitCode = 1
  }
}
