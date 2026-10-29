import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import { vobsPlugin } from '@vobs/vite-plugin'
import { vobsTailwind } from '@vobs/tailwind'

// Multi-page: one HTML entry per file in pages/ — Vobs Studio previews each one.
const pages = Object.fromEntries(
  readdirSync(resolve(__dirname, 'pages'))
    .filter(file => file.endsWith('.html'))
    .map(file => [file.replace(/\.html$/u, ''), resolve(__dirname, 'pages', file)])
)

export default defineConfig({
  plugins: [vobsPlugin(), vobsTailwind()],
  build: {
    rollupOptions: { input: pages }
  }
})
