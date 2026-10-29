import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import { vobsPlugin } from '@vobs/vite-plugin'
import { workspaceAliases } from '../../scripts/vite-workspace.mjs'

/**
 * vite preview's static server (sirv) only resolves a directory index.html for trailing-slash paths;
 * a slashless /features falls back to the home page via SPA fallback. This middleware rewrites
 * slashless GET requests to the slash form when <outDir>/<path>/index.html exists on disk, making
 * /features and /features/ behave identically. Production deployments (nginx/static hosts) resolve
 * directory indexes natively and do not need this logic.
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
    // Hydrated apps must disable static template hoisting: nodes cloned by cloneTemplate are not part of
    // the server DOM, so the hydration claim mechanism cannot match them, causing a whole-tree HydrationMismatch.
    // (Framework-level fix: the runtime template claim adapter, see packages/runtime/src/template.ts)
    vobsPlugin({ compiler: { hoistTemplates: false } }),
    previewDirectoryIndex()
  ],
  resolve: {
    alias: workspaceAliases()
  }
})
