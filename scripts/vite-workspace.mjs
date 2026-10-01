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
  'dsh',
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
    '@vobs/dsh/react': path.resolve(root, 'packages/dsh/src/react.ts'),
    '@vobs/dsh/vite': path.resolve(root, 'packages/dsh/src/vite.ts'),
    '@vobs/reactivity/state': path.resolve(root, 'packages/reactivity/src/signal.ts'),
    '@vobs/runtime/error': path.resolve(root, 'packages/runtime/src/error.ts'),
    '@vobs/runtime/dom-props': path.resolve(root, 'packages/runtime/src/dom-props.ts'),
    '@vobs/runtime/svg': path.resolve(root, 'packages/runtime/src/svg.ts'),
    '@vobs/vobs/jsx-runtime': path.resolve(root, 'packages/vobs/src/jsx-runtime.ts'),
    '@vobs/vobs/jsx-dev-runtime': path.resolve(root, 'packages/vobs/src/jsx-dev-runtime.ts'),
    // 子路径必须显式列出：别名是「精确匹配或 pattern + '/' 前缀匹配」，只写 @vobs/vobs
    // 会把 @vobs/vobs/dev 拼成 index.ts/dev 这种不存在的路径。
    '@vobs/vobs/dev': path.resolve(root, 'packages/vobs/src/dev.ts'),
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
