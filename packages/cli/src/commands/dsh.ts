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

/** Platform built-in modules: `require` calls for these in the bundle are expected. */
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

/** Strip the scope, producing an identifier usable as both the cordis row id and a directory name. */
function toRowId(packageName: string): string {
  return packageName.replace(/^@[^/]+\//u, '')
}

/* ------------------------------------------------------------------ init */

async function dshInitCommand(target: string | undefined, options: DshOptions): Promise<void> {
  const name = target ?? ((await p.text({
    message: 'Plugin package name (npm name, lowercase):',
    placeholder: 'dsh-plugin-my-panel',
    validate: value => (/^[a-z0-9][a-z0-9._~-]*$/u.test(value) ? undefined : 'must be a valid npm package name')
  })) as string)

  if (p.isCancel(name)) {
    p.cancel('Cancelled')
    return
  }

  const packageManager =
    options.pm ??
    ((await p.select({
      message: 'Package manager:',
      options: [
        { value: 'pnpm', label: 'pnpm' },
        { value: 'npm', label: 'npm' }
      ]
    })) as PackageManager)

  if (p.isCancel(packageManager)) {
    p.cancel('Cancelled')
    return
  }

  const targetDir = options.dir !== undefined ? resolve(options.dir) : resolve(process.cwd(), name)
  const rowId = toRowId(name)
  const displayName = rowId
    .replace(/^dsh-plugin-/u, '')
    .split('-')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')

  logger.step(`Creating DSH plugin project ${name} …`)
  await scaffoldProject(
    targetDir,
    { packageName: name, rowId, displayName, vobsVersion: vobsVersion() },
    'dsh-plugin'
  )

  // .gitignore is written separately: dotfiles in templates are easy to lose during
  // packaging, and one rule here is critical — lib/ is build output and **must be
  // committed** (DSH does not build at install time).
  ensureDir(targetDir)
  writeFileSync(
    resolve(targetDir, '.gitignore'),
    ['node_modules/', '*.log', '*.tsbuildinfo', '', '# lib/ is build output and must be committed: DSH does not build your package at install time.', ''].join('\n'),
    'utf8'
  )
  logger.success('Project generated')

  logger.step('Installing dependencies …')
  try {
    installDependencies(targetDir, packageManager)
    logger.success('Dependencies installed')
  } catch {
    logger.warn(`Dependency installation failed; run ${packageManager} install manually`)
  }

  logger.step('Next steps')
  console.log(`
  cd ${name}
  ${packageManager} run dev     # local preview, no need to install into DSH
  ${packageManager} run build   # produces lib/{index,client}.js

  # After committing the build output and tagging, fill in on the DSH plugin page:
  github:<owner>/<repo>#v0.1.0&path:/<this package's path within the repo>
`)
}

/* ----------------------------------------------------------------- build */

/**
 * Build the DSH plugin artifacts.
 *
 * An installable plugin package has **two halves**: the Host side (a cordis plugin, ESM)
 * and the Client side (a browser bundle). The project's vite.config only covers the Client
 * (`dshBundle()` writes its output to the location declared in package.json); the Host half
 * is produced by this command — otherwise the file `exports["."]` points at does not exist
 * and installing into DSH is guaranteed to fail.
 */
async function dshBuildCommand(): Promise<void> {
  const projectDir = process.cwd()
  const configFile = resolve(projectDir, 'vite.config.ts')
  if (!existsSync(configFile)) {
    logger.error('No vite.config.ts in the current directory; run this from the plugin project root.')
    process.exitCode = 1
    return
  }

  const manifest = readManifest(projectDir)
  if (manifest === undefined) {
    logger.error('Cannot read package.json.')
    process.exitCode = 1
    return
  }

  const hostEntry = resolveExport(manifest, '.')
  if (hostEntry === undefined) {
    logger.error('No "." in package.json exports; DSH will not be able to load the Host-side plugin.')
    process.exitCode = 1
    return
  }

  const { build } = await import('vite')

  logger.info('Building client bundle …')
  await build({ configFile, mode: 'production' })

  logger.info('Building Host bundle …')
  const hostTarget = resolve(projectDir, hostEntry.replace(/^\.\//u, ''))
  const hostEntrySource = resolve(projectDir, 'src', 'host', 'index.ts')
  if (!existsSync(hostEntrySource)) {
    logger.warn(`${hostEntrySource} not found; skipping the Host build.`)
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

  logger.success('Build complete → both the client and Host artifacts are in place')
}

/* ------------------------------------------------------------------ dev */

/** Extract a subpath from the exports field, accepting both the string form and a one-level conditions object. */
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

/** Generate the preview page. Pure function, for unit testing. */
export function buildPreviewHtml(options: { packageName: string; title?: string }): string {
  // The package name gets embedded in a <script>: JSON serialization does not escape `/`,
  // so `<` must be stripped by hand — otherwise a package name containing </script>
  // could break out of the tag.
  const name = JSON.stringify(options.packageName).replace(/</gu, '\\u003c')
  const title = (options.title ?? options.packageName).replace(/[<>&]/gu, '')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>vobs preview · ${title}</title>
</head>
<body>
<div id="root"></div>

<!-- 1. Install the shim first: it must precede the plugin bundle to capture its factory registrations -->
<script>
  window.__VOBS_DSH_PREVIEW__ = { factories: new Map() };
  window.__ModuleLoader__ = {
    load: function (entry) { window.__VOBS_DSH_PREVIEW__.factories.set(entry.id, entry.factory); }
  };
</script>

<!-- 2. Plugin bundle: it only registers its factory, producing no side effects -->
<script src="/client.js"></script>

<!-- 3. Boot the preview shell -->
<script type="module">
  import { startPreview } from '/preview.js';
  window.__VOBS_PREVIEW__ = startPreview({
    container: document.getElementById('root'),
    packageName: ${name}
  });
</script>

<!-- 4. Auto-reload after rebuilds; ?static=1 disables the long connection, for headless screenshots and CI assertions -->
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
 * Vite's build watcher. Only the two members this command uses are declared —
 * `vite` does not re-export rollup's `RollupWatcher`, and pulling in rollup types for one
 * dev command is not worth it.
 */
interface BuildWatcher {
  on(event: 'event', handler: (event: { code?: string; error?: { message?: string } }) => void): void
  close(): Promise<void>
}

async function dshDevCommand(options: DshOptions): Promise<void> {
  const projectDir = process.cwd()
  const manifest = readManifest(projectDir)
  if (manifest === undefined) {
    logger.error('No readable package.json in the current directory.')
    process.exitCode = 1
    return
  }
  if (readManifest(projectDir)?.dsh === undefined) {
    logger.error('This is not a DSH plugin project (no dsh field in package.json).')
    process.exitCode = 1
    return
  }

  const packageName = typeof manifest.name === 'string' ? manifest.name : 'dsh-plugin'
  const clientEntry = resolveExport(manifest, './client')
  if (clientEntry === undefined) {
    logger.error('No "./client" in package.json exports; the page cannot get the client bundle.')
    process.exitCode = 1
    return
  }
  const clientFile = resolve(projectDir, clientEntry.replace(/^\.\//u, ''))

  // The preview runtime is resolved from **the project's own** node_modules: the project
  // is the party that declares @vobs/dsh.
  let previewFile: string | undefined
  try {
    const projectRequire = createRequire(join(projectDir, 'package.json'))
    let packageRoot: string | undefined
    try {
      // Preferred: the package exports ./package.json (@vobs/dsh does).
      packageRoot = dirname(projectRequire.resolve('@vobs/dsh/package.json'))
    } catch {
      // Fallback: resolve the main entry (dist/index.js or dist/index.cjs), then walk back to the package root.
      packageRoot = dirname(dirname(projectRequire.resolve('@vobs/dsh')))
    }
    const candidate = join(packageRoot, 'dist', 'preview.js')
    previewFile = existsSync(candidate) ? candidate : undefined
  } catch {
    previewFile = undefined
  }
  if (previewFile === undefined) {
    logger.error('Could not find the @vobs/dsh preview runtime in the project. Install dependencies first: pnpm add -D @vobs/dsh')
    process.exitCode = 1
    return
  }

  const port = options.port ?? 5199
  const clients = new Set<ServerResponse>()
  const broadcast = (event: string): void => {
    for (const client of clients) client.write(`event: ${event}\ndata: 1\n\n`)
  }

  /* Build once, then enter watch mode */
  logger.info('Building artifacts …')
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
        logger.success('Rebuild complete')
        broadcast('reload')
      } else if (event.code === 'ERROR') {
        buildError = event.error?.message ?? 'build failed'
        logger.error(buildError)
      }
    })
    process.on('SIGINT', () => {
      void watcher.close().then(() => process.exit(0))
    })
  } catch (error) {
    logger.error(`Build failed: ${error instanceof Error ? error.message : String(error)}`)
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
        response.end(`No build output yet: ${clientEntry}\n${buildError ?? ''}`)
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

  logger.success(`Preview ready: http://127.0.0.1:${port}/`)
  console.log('\n  Editing code triggers an automatic rebuild and page refresh; Ctrl+C to quit.\n')
}

/* ----------------------------------------------------------------- check */

interface CheckResult {
  errors: string[]
  warnings: string[]
  passed: string[]
}

/** Read and parse package.json. */
function readManifest(dir: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(readFileSync(resolve(dir, 'package.json'), 'utf8')) as Record<string, unknown>
  } catch {
    return undefined
  }
}

/**
 * Pre-install consistency check: moves "discover it's broken after installing into DSH"
 * forward to local time.
 *
 * Every check item comes from DSH's client-plugin contract and pnpm's Git subdirectory
 * installation constraints.
 */
export function collectIssues(dir: string): CheckResult {
  const result: CheckResult = { errors: [], warnings: [], passed: [] }
  const manifest = readManifest(dir)

  if (manifest === undefined) {
    result.errors.push('Cannot read package.json (JSON syntax error or missing file)')
    return result
  }

  const name = typeof manifest.name === 'string' ? manifest.name : ''
  if (name === '') result.errors.push('package.json is missing name')
  else result.passed.push(`package name ${name}`)

  const dsh = (manifest.dsh ?? {}) as Record<string, unknown>
  const bundle = (dsh.bundle ?? {}) as Record<string, unknown>
  const client = (dsh.client ?? {}) as Record<string, unknown>

  if (typeof bundle.patch !== 'string') {
    result.errors.push('dsh.bundle.patch is missing — DSH will not treat this package as a bundle')
  } else {
    const patchPath = resolve(dir, bundle.patch.replace(/^\.\//u, ''))
    if (!existsSync(patchPath)) {
      result.errors.push(`dsh.bundle.patch points at ${bundle.patch}, which does not exist`)
    } else {
      const text = readFileSync(patchPath, 'utf8')
      if (!text.includes('insert:')) result.errors.push('no insert: section in cordis.patch.yml; the plugin row will not enter the bundle tree')
      else if (name !== '' && !text.includes(name)) {
        result.warnings.push(`the package name ${name} does not appear in cordis.patch.yml; verify the insert name is correct`)
      } else result.passed.push('cordis.patch.yml inserts this package\'s row')
    }
  }

  if (client.platform !== 'web') {
    result.errors.push("dsh.client.platform must be 'web' — otherwise DSH will not serve the client bundle to the page")
  } else result.passed.push('dsh.client.platform = web')

  const exportsField = (manifest.exports ?? {}) as Record<string, string>
  const hostEntry = exportsField['.']
  const clientEntry = exportsField['./client']
  if (typeof hostEntry !== 'string') result.errors.push('exports["."] is not declared — DSH cannot load the Host-side plugin')
  else if (!existsSync(resolve(dir, hostEntry.replace(/^\.\//u, '')))) {
    result.errors.push(`exports["."] points at ${hostEntry}, which does not exist; build first`)
  } else result.passed.push('Host entry exists')

  if (typeof clientEntry !== 'string') result.errors.push('exports["./client"] is not declared — the page cannot get the client bundle')

  const scripts = (manifest.scripts ?? {}) as Record<string, string>
  if (scripts.prepare !== undefined || scripts.postinstall !== undefined) {
    result.errors.push('prepare / postinstall declared — DSH does not build at install time; build output must be committed in advance')
  } else result.passed.push('no install-time lifecycle hooks')

  const dependencyText = JSON.stringify({
    dependencies: manifest.dependencies,
    peerDependencies: manifest.peerDependencies,
    devDependencies: manifest.devDependencies
  })
  if (dependencyText.includes('workspace:')) {
    result.errors.push('the workspace: protocol appears in dependencies — it cannot be resolved by a direct GitHub subdirectory install')
  } else result.passed.push('no workspace: protocol dependencies')

  if (typeof clientEntry === 'string') {
    const clientPath = resolve(dir, clientEntry.replace(/^\.\//u, ''))
    if (!existsSync(clientPath)) {
      result.errors.push(`client bundle ${clientEntry} does not exist; run the build first`)
    } else {
      const code = readFileSync(clientPath, 'utf8')
      const loads = (code.match(/__ModuleLoader__\.load\(/gu) ?? []).length
      if (loads !== 1) result.errors.push(`__ModuleLoader__.load appears ${loads} times in the client bundle; expected 1 (build first)`)
      else result.passed.push('bundle shape matches the DSH client module protocol')

      if (code.includes('import(')) result.errors.push('dynamic import() found in the client bundle; DSH only supports self-contained chunks')

      const requires = [...code.matchAll(/require\((['"])([^'"]+)\1\)/gu)].map(match => match[2] ?? '')
      const foreign = requires.filter(id => !PLATFORM_MODULES.includes(id) && !id.startsWith('@deepseek-ai/'))
      if (foreign.length > 0) {
        result.errors.push(`the bundle requires non-platform modules: ${[...new Set(foreign)].join(', ')} — dependencies were not bundled in`)
      } else if (requires.length > 0) {
        result.passed.push(`the bundle only requires platform modules (${[...new Set(requires)].join(', ')})`)
      }

      if (name !== '' && !code.includes(`"${name}"`) && !code.includes(`'${name}'`)) {
        result.warnings.push(`the module id in the bundle does not match the package name ${name}; check dshBundle({ id })`)
      }
    }
  }

  return result
}

function dshCheckCommand(): void {
  const dir = process.cwd()
  const result = collectIssues(dir)

  logger.step('DSH plugin pre-install check')
  for (const item of result.passed) console.log(`  ✔ ${item}`)
  for (const item of result.warnings) console.log(`  ⚠ ${item}`)
  for (const item of result.errors) console.log(`  ✖ ${item}`)

  if (result.errors.length > 0) {
    logger.error(`${result.errors.length} check(s) failed; the plugin will not work after installation into DSH.`)
    process.exitCode = 1
    return
  }
  logger.success(`All checks passed (${result.passed.length} items${result.warnings.length > 0 ? `, ${result.warnings.length} warning(s)` : ''})`)
}

/* --------------------------------------------------------------- install */

/** Read the pnpm version; returns undefined when unavailable. */
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

/** Assemble the install spec. */
export function buildInstallSpec(options: DshOptions): { spec?: string; error?: string } {
  if (options.spec !== undefined) return { spec: options.spec }

  if (options.from !== undefined) {
    const target = resolve(options.from)
    if (!existsSync(target)) return { error: `the --from path does not exist: ${target}` }
    return { spec: target }
  }

  if (options.repo !== undefined) {
    const ref = options.tag !== undefined && options.tag !== '' ? `#${options.tag}` : ''
    const sub = options.subpath !== undefined && options.subpath !== '' ? `${ref === '' ? '#' : '&'}path:${options.subpath}` : ''
    return { spec: `github:${options.repo}${ref}${sub}` }
  }

  return { error: 'one of --spec, --from, or --repo is required to specify the install source.' }
}

/**
 * Quoting policy when invoking dsh on Windows.
 *
 * A `.cmd` file cannot be executed directly by CreateProcess (EINVAL), so it must go
 * through a shell; the shell concatenates bare arguments verbatim, so the `&` in
 * `github:owner/repo#tag&path:/sub` becomes a command separator —
 * measured: it **silently truncates the spec at `#tag`**, then installs the monorepo root
 * instead of the target subpackage. Arguments containing special characters must therefore
 * be quoted by hand.
 */
const CMD_NEEDS_QUOTE = /[\s&|<>^()"']/u

function quoteForCmd(part: string): string {
  return CMD_NEEDS_QUOTE.test(part) ? `"${part.replace(/"/gu, '""')}"` : part
}

/** Assemble a command line for shell execution (Windows only). */
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
    logger.error(error ?? 'unknown error')
    process.exitCode = 1
    return
  }

  const usesSubpath = spec.includes('path:')
  const pnpmVersion = readPnpmVersion()

  if (usesSubpath && pnpmVersion !== undefined && majorOf(pnpmVersion) < 11) {
    logger.warn(
      `Detected pnpm ${pnpmVersion}: below 11 the git subdirectory syntax (#…&path:) is unsupported, ` +
        'and it silently installs the repo root instead of the subpackage you want. The pnpm 11 bundled with DSH is unaffected — prefer installing from the DSH plugin page.'
    )
  }

  if (usesSubpath && process.platform === 'win32') {
    logger.info('Windows: the command runs through cmd /d /s /c so that & is not treated as a command separator.')
  }

  logger.step(`Installing into profile "${profile}"`)
  console.log(`  spec: ${spec}`)

  if (!isAbsolute(spec) && !spec.startsWith('github:') && !spec.startsWith('git+') && !spec.startsWith('http')) {
    logger.warn('this spec is neither an absolute path nor git/URL; double-check it.')
  }

  const status = spawnDsh(['plugin', '--profile', profile, 'add', spec], options.dry === true)
  if (options.dry === true) {
    logger.info('dry run: the command above was not executed.')
    return
  }
  if (status !== 0) {
    logger.error(`Install failed (exit code ${status}). Diagnostic logs are in ~/.dsh/profiles/${profile}/.plugin-manager/logs/`)
    process.exitCode = status
    return
  }
  logger.success('Install complete — fully quit DSH and reopen it to take effect')
}

/* ------------------------------------------------------------- dispatcher */

const ACTIONS: Record<string, string> = {
  init: 'create a DSH plugin project',
  dev: 'local preview (see the panel in a browser, no need to install into DSH)',
  build: 'build lib/{index,client}.js',
  check: 'pre-install consistency check',
  install: 'install the plugin into a DSH profile'
}

/** Dispatcher for `vobs dsh <action> [target]`. */
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
      // Without a subcommand, only list usage (the most natural "what do I use" entry);
      // an actually-wrong subcommand is what produces the error.
      if (action !== undefined && action !== '') logger.error(`Unknown subcommand: ${action}`)
      console.log('\n  Available subcommands:')
      for (const [name, description] of Object.entries(ACTIONS)) {
        console.log(`    vobs dsh ${name.padEnd(8)} ${description}`)
      }
      if (action !== undefined && action !== '') process.exitCode = 1
  }
}
