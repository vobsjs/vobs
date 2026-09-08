import { defineConfig } from 'vite'
import { vobsPlugin } from '@vobs/vite-plugin'
import { vobsTailwind } from '@vobs/tailwind'
import { workspaceAliases } from '../../scripts/vite-workspace.mjs'

export default defineConfig({
  plugins: [vobsPlugin(), vobsTailwind()],
  resolve: {
    alias: workspaceAliases()
  }
})
