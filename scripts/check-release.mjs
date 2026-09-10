import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const publishablePackages = [
  'reactivity',
  'runtime',
  'dom',
  'vobs',
  'compiler',
  'icon-core',
  'notification',
  'auth',
  'i18n',
  'layout',
  'resource',
  'theme',
  'ui',
  'kit',
  'router',
  'forms',
  'table',
  'captcha',
  'devtools',
  'devtools-ui',
  'dict',
  'http',
  'jwt-auth',
  'logger',
  'preferences',
  'queue',
  'ssr',
  'storage',
  'sync',
  'tailwind',
  'test-utils',
  'transition',
  'upload',
  'vite-plugin',
  'cli',
  'payment',
]

const tag = process.argv.slice(2).find((argument) => argument !== '--') ?? process.env.GITHUB_REF_NAME ?? ''
if (!tag.startsWith('v') || tag.length < 2) {
  throw new Error(`Expected a release tag such as v1.2.0, received: ${tag || '(empty)'}`)
}

const releaseVersion = tag.slice(1)
const packages = await Promise.all(
  publishablePackages.map(async (name) => {
    const path = resolve('packages', name, 'package.json')
    const manifest = JSON.parse(await readFile(path, 'utf8'))
    return { name: manifest.name, version: manifest.version, private: manifest.private === true, path }
  }),
)

const invalid = packages.filter(
  ({ name, version, private: isPrivate }) =>
    isPrivate || version !== releaseVersion,
)

if (invalid.length > 0) {
  const details = invalid
    .map(({ name, version, private: isPrivate }) => `${name}: ${isPrivate ? 'private' : version}`)
    .join(', ')
  throw new Error(`Release ${tag} does not match all publishable packages: ${details}`)
}

console.log(`[release] ${tag} matches ${packages.length} public packages`)
