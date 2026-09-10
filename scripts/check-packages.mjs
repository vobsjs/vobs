import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const packageNames = process.argv.slice(2).filter(argument => !argument.startsWith('-'))
// This checks local build artifacts for every public package.
const packages = packageNames.length > 0 ? packageNames : ['reactivity', 'runtime', 'dom', 'vobs', 'compiler', 'icon-core', 'notification', 'auth', 'i18n', 'layout', 'resource', 'theme', 'ui', 'kit', 'router', 'forms', 'table', 'captcha', 'devtools', 'devtools-ui', 'dict', 'http', 'jwt-auth', 'logger', 'preferences', 'queue', 'ssr', 'storage', 'sync', 'tailwind', 'test-utils', 'transition', 'upload', 'vite-plugin', 'cli', 'payment']

for (const name of packages) {
  const directory = path.join(root, 'packages', name)
  const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'))
  const files = new Set()
  const collect = value => {
    if (typeof value === 'string') files.add(value)
    else if (value && typeof value === 'object') Object.values(value).forEach(collect)
  }
  collect(manifest.exports)
  for (const file of files) {
    if (file.includes('*')) continue
    if (!file.startsWith('./dist/') && !file.startsWith('./src/')) continue
    try {
      await readFile(path.join(directory, file.slice(2)))
    } catch {
      throw new Error(`${manifest.name}: exports points to missing file ${file}`)
    }
  }
  for (const required of ['dist/index.js', 'dist/index.cjs', 'dist/index.d.ts', 'src/index.ts']) {
    try {
      await readFile(path.join(directory, required))
    } catch {
      throw new Error(`${manifest.name}: required file is missing: ${required}`)
    }
  }
  console.log(`[check] ${manifest.name} exports are present`)
}
