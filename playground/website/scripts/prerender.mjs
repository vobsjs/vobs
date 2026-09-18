// 预渲染脚本：import 编译后的 entry-server 执行 prerenderRoutes，
// 把每页组装成完整 HTML 写入 dist/<path>/index.html（与客户端产物同目录，preview/静态托管直接可用）。
import { readdirSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { renderPage } from '@vobs/ssr'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

// 1. 定位编译产物（vite ssr/client 构建的文件名带 hash，动态发现避免耦合）
const serverDir = join(root, 'dist-server')
const serverEntry = readdirSync(serverDir).find(name => /^entry-server\.(js|mjs|cjs)$/.test(name))
if (serverEntry === undefined) {
  throw new Error('未找到 entry-server 产物，请先执行 pnpm run build:ssr')
}

const assetsDir = join(root, 'dist', 'assets')
// vite 默认入口文件名 = 入口源文件名（entry-client → index 时按 chunk 命名规则输出 index-*.js）
const clientEntry = readdirSync(assetsDir).find(name => /^(index|entry-)[\w-]*\.js$/.test(name))
if (clientEntry === undefined) {
  throw new Error('未找到客户端 entry 产物，请先执行 pnpm run build:client')
}

// 2. 执行预渲染
const { prerender } = await import(pathToFileURL(join(serverDir, serverEntry)).href)
const { pages } = await prerender()

// 3. 组装并落盘：/ → dist/index.html；/features → dist/features/index.html
for (const page of pages) {
  const rel = page.path === '/' ? 'index.html' : join(page.path, 'index.html')
  const file = join(root, 'dist', rel)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, renderPage(page, {
    entryScript: `<script type="module" src="/assets/${clientEntry}"></script>`
  }))
  console.log(`✓ prerendered ${page.path} → dist/${rel}`)
}
