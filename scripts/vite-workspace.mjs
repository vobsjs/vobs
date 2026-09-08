import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const packageNames = [
  'auth',
  'compiler',
  'devtools',
  'devtools-ui',
  'dict',
  'dom',
  'forms',
  'http',
  'icon-core',
  'i18n',
  'jwt-auth',
  'kit',
  'layout',
  'logger',
  'notification',
  'preferences',
  'queue',
  'reactivity',
  'resource',
  'router',
  'runtime',
  'ssr',
  'storage',
  'sync',
  'table',
  'tailwind',
  'test-utils',
  'theme',
  'transition',
  'ui',
  'upload',
  'vite-plugin',
  'vobs'
]

export function workspaceAliases() {
  const aliases = {
    '@vobs/reactivity/state': path.resolve(root, 'packages/reactivity/src/signal.ts'),
    '@vobs/runtime/error': path.resolve(root, 'packages/runtime/src/error.ts'),
    '@vobs/vobs/jsx-runtime': path.resolve(root, 'packages/vobs/src/jsx-runtime.ts'),
    '@vobs/vobs/jsx-dev-runtime': path.resolve(root, 'packages/vobs/src/jsx-dev-runtime.ts'),
    '@vobs/ui/styles.css': path.resolve(root, 'packages/ui/src/styles/styles.css'),
    '@vobs/devtools-ui/styles.css': path.resolve(root, 'packages/devtools-ui/src/styles/styles.css'),
    '@vobs/layout/styles.css': path.resolve(root, 'packages/layout/src/styles/styles.css'),
    '@vobs/kit/styles.css': path.resolve(root, 'packages/kit/src/styles/styles.css'),
    '@vobs/table/styles.css': path.resolve(root, 'packages/table/src/styles/styles.css'),
    '@vobs/tailwind/theme.css': path.resolve(root, 'packages/tailwind/src/theme.css'),
    '@vobs/tailwind/styles.css': path.resolve(root, 'packages/tailwind/src/styles.css'),
    '@vobs/tailwind/styles-prefixed.css': path.resolve(root, 'packages/tailwind/src/styles-prefixed.css')
  }

  for (const name of packageNames) {
    aliases[`@vobs/${name}`] = path.resolve(root, `packages/${name}/src/index.ts`)
  }

  return aliases
}
