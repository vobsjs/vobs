import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import { vobsPlugin } from '@vobs/vite-plugin'
import { workspaceAliases } from '../../scripts/vite-workspace.mjs'

/**
 * vite preview 的静态服务（sirv）只对尾斜杠路径解析目录 index.html，
 * 无斜杠的 /features 会被 SPA fallback 回退到首页。此中间件把磁盘上存在
 * <outDir>/<path>/index.html 的无斜杠 GET 请求重写为带斜杠形式，使
 * /features 与 /features/ 行为一致；生产部署（nginx/静态主机）自带目录
 * index 解析，无需此逻辑。
 */
function previewDirectoryIndex(): Plugin {
  return {
    name: 'vobs-preview-directory-index',
    apply: 'serve',
    configurePreviewServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.method !== 'GET' || !req.url) return next()
        const [pathname, query] = req.url.split('?')
        const lastSegment = pathname.split('/').pop() ?? ''
        if (pathname.endsWith('/') || lastSegment.includes('.')) return next()
        if (existsSync(resolve(import.meta.dirname, 'dist', pathname.slice(1), 'index.html'))) {
          req.url = `${pathname}/${query !== undefined ? `?${query}` : ''}`
        }
        next()
      })
    }
  }
}

export default defineConfig({
  plugins: [
    // 水合应用必须关闭静态模板提升：cloneTemplate 产出的克隆节点不在服务端 DOM 中，
    // 水合认领（claim）机制无法匹配，会整树 HydrationMismatch。
    // （框架级修复：runtime 模板认领适配器，见 packages/runtime/src/template.ts）
    vobsPlugin({ compiler: { hoistTemplates: false } }),
    previewDirectoryIndex()
  ],
  resolve: {
    alias: workspaceAliases()
  }
})
