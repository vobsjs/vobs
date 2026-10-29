// Prerender script: imports the compiled entry-server and runs prerenderRoutes,
// assembling each page into a complete HTML file written to dist/<path>/index.html
// (same directory as the client build output; directly usable by preview/static hosting).
import { readdirSync, mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { renderPage } from '@vobs/ssr'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

// 1. Locate build outputs (vite ssr/client build filenames carry hashes; discover them dynamically to avoid coupling)
const serverDir = join(root, 'dist-server')
const serverEntry = readdirSync(serverDir).find(name => /^entry-server\.(js|mjs|cjs)$/.test(name))
if (serverEntry === undefined) {
  throw new Error('entry-server build output not found; run pnpm run build:ssr first')
}

const assetsDir = join(root, 'dist', 'assets')
// vite's default entry filename = the entry source filename (entry-client → index is emitted as index-*.js per chunk naming rules)
const clientEntry = readdirSync(assetsDir).find(name => /^(index|entry-)[\w-]*\.js$/.test(name))
if (clientEntry === undefined) {
  throw new Error('client entry build output not found; run pnpm run build:client first')
}

// 2. Run prerender
const { prerender } = await import(pathToFileURL(join(serverDir, serverEntry)).href)
const { pages } = await prerender()

// 3. Assemble and write to disk: / → dist/index.html; /features → dist/features/index.html
for (const page of pages) {
  const rel = page.path === '/' ? 'index.html' : join(page.path, 'index.html')
  const file = join(root, 'dist', rel)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, renderPage(page, {
    entryScript: `<script type="module" src="/assets/${clientEntry}"></script>`
  }))
  console.log(`✓ prerendered ${page.path} → dist/${rel}`)
}

// 4. Agent knowledge distribution channel (llms.txt / vobs-context.md / diagnostics.md):
// once the website statically hosts these files, Agents without vobs installed can fetch and understand the contracts.
// Generating them via the CLI guarantees strong consistency with the framework version; when deploying outside the
// monorepo, failure does not block the build (deployers run `vobs agent-doc --llms dist/` themselves).
try {
  const cliBin = fileURLToPath(new URL('../../../packages/cli/bin/vobs.js', import.meta.url))
  execFileSync(process.execPath, [cliBin, 'agent-doc', '--llms', join(root, 'dist')], { stdio: 'inherit' })
} catch (error) {
  console.warn(`[prerender] llms.txt generation skipped: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`)
}
