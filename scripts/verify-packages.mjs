import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const execFile = promisify(execFileCallback)
const root = fileURLToPath(new URL('..', import.meta.url))
const packageNames = ['reactivity', 'runtime', 'dom', 'vobs', 'compiler', 'icon-core', 'notification', 'auth', 'i18n', 'layout', 'resource', 'theme', 'ui', 'kit', 'router', 'forms', 'table', 'captcha', 'devtools', 'devtools-ui', 'dict', 'http', 'jwt-auth', 'logger', 'preferences', 'queue', 'ssr', 'storage', 'sync', 'tailwind', 'test-utils', 'transition', 'upload', 'vite-plugin', 'cli', 'payment']
const packageManager = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'vobs-publish-'))
const artifacts = path.join(tempRoot, 'artifacts')
const consumer = path.join(tempRoot, 'consumer')
await writeFile(path.join(tempRoot, '.keep'), '')
await import('node:fs/promises').then(({ mkdir }) => Promise.all([mkdir(artifacts), mkdir(consumer)]))

try {
  for (const name of packageNames) {
    await execFile(packageManager, ['--filter', `@vobs/${name}`, 'pack', '--pack-destination', artifacts], { cwd: root, shell: process.platform === 'win32' })
  }

  const tarballs = Object.fromEntries((await readdir(artifacts)).map(file => [file.replace(/^vobs-/, '').replace(/-\d+\.\d+\.\d+\.tgz$/, ''), file]))
  const dependencies = Object.fromEntries(packageNames.map(name => [`@vobs/${name}`, `file:../artifacts/${tarballs[name]}`]))
  await writeFile(path.join(consumer, 'package.json'), JSON.stringify({
    private: true,
    type: 'module',
    dependencies,
    devDependencies: {
      '@types/node': '24.13.3',
      'alipay-sdk': '4.14.0',
      'wechatpay-axios-plugin': '0.9.6',
      'vite': '7.3.6'
    },
  }, null, 2))
  await execFile(npm, ['install', '--no-audit', '--no-fund', '--package-lock=false'], { cwd: consumer, shell: process.platform === 'win32' })

  await execFile(process.execPath, ['--input-type=module', '-e', "const r=await import('@vobs/vobs'); if(typeof r.createVobs!=='function'||typeof r.state!=='function') throw new Error('ESM entry failed')"], { cwd: consumer })
  await execFile(process.execPath, ['-e', "const r=require('@vobs/vobs'); if(typeof r.createVobs!=='function'||typeof r.state!=='function') throw new Error('CJS entry failed')"], { cwd: consumer })
  await execFile(process.execPath, ['--input-type=module', '-e', "const r=await import('@vobs/vobs/jsx-runtime'); if(typeof r.jsx!=='function') throw new Error('subpath entry failed')"], { cwd: consumer })
  await execFile(process.execPath, ['--input-type=module', '-e', "const cli=await import('@vobs/cli'); const payment=await import('@vobs/payment'); const alipay=await import('@vobs/payment/alipay'); if(typeof cli.createCLI!=='function'||typeof payment.createPayment!=='function'||typeof alipay.AlipayClient!=='function') throw new Error('CLI/payment ESM entry failed')"], { cwd: consumer })
  await execFile(process.execPath, ['-e', "const cli=require('@vobs/cli'); const payment=require('@vobs/payment'); if(typeof cli.createCLI!=='function'||typeof payment.createPayment!=='function') throw new Error('CLI/payment CJS entry failed')"], { cwd: consumer })

  await writeFile(path.join(consumer, 'source-check.ts'), [
    "import { state } from '@vobs/reactivity/source'",
    "import { createVobs } from '@vobs/vobs/source'",
    "import { compile } from '@vobs/compiler/source'",
    "import { createRouter } from '@vobs/router/source'",
    "import { createForm } from '@vobs/forms/source'",
    "import { KitDataTable } from '@vobs/table/source'",
    "import { Button } from '@vobs/ui/source'",
    "import { createAuth } from '@vobs/auth/source'",
    "import { createI18n } from '@vobs/i18n/source'",
    "import { createResourceClient } from '@vobs/resource/source'",
    "import { createTheme } from '@vobs/theme/source'",
    "import { KitLayout } from '@vobs/layout/source'",
    "import { createIcon } from '@vobs/icon-core/source'",
    "import { createNotification } from '@vobs/notification/source'",
    "import { KitPage } from '@vobs/kit/source'",
    "import { Captcha } from '@vobs/captcha/source'",
    "import { createDevTools } from '@vobs/devtools/source'",
    "import { DevToolsPanel } from '@vobs/devtools-ui/source'",
    "import { createDict } from '@vobs/dict/source'",
    "import { createHTTPClient } from '@vobs/http/source'",
    "import { createJWTAuth } from '@vobs/jwt-auth/source'",
    "import { createLogger } from '@vobs/logger/source'",
    "import { createPreferences } from '@vobs/preferences/source'",
    "import { createTaskQueue } from '@vobs/queue/source'",
    "import { createSSRRenderer } from '@vobs/ssr/source'",
    "import { createStorage } from '@vobs/storage/source'",
    "import { createSync } from '@vobs/sync/source'",
    "import { vobsTailwind } from '@vobs/tailwind/source'",
    "import { createTestRenderer } from '@vobs/test-utils/source'",
    "import { Transition } from '@vobs/transition/source'",
    "import { createUpload } from '@vobs/upload/source'",
    "import { vobsPlugin } from '@vobs/vite-plugin/source'",
    "import { createCLI } from '@vobs/cli/source'",
    "import { createPayment } from '@vobs/payment/source'",
    'const count = state(1)',
    'KitDataTable',
    'Button',
    'createVobs',
    'compile',
    'count.value',
    'createCLI',
    'createPayment'
  ].join('\n'))
  await writeFile(path.join(consumer, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      target: 'ES2022',
      lib: ['ES2022', 'DOM', 'DOM.Iterable'],
      module: 'ESNext',
      moduleResolution: 'bundler',
      jsx: 'preserve',
      types: ['node'],
      allowImportingTsExtensions: true
    },
    include: ['source-check.ts']
  }, null, 2))
  await execFile(process.execPath, [path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '--noEmit', '-p', 'tsconfig.json'], { cwd: consumer })
  console.log('[verify] ESM, CJS, subpath, and source TypeScript entries passed')
} finally {
  await rm(tempRoot, { recursive: true, force: true })
}
