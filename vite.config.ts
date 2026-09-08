import { defineConfig } from 'vite'
import { workspaceAliases } from './scripts/vite-workspace.mjs'

export default defineConfig({
  resolve: {
    alias: workspaceAliases()
  }
})
