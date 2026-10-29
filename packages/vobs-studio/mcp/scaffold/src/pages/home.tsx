/**
 * Minimal home page — proves the toolchain compiles and tokens resolve.
 * This page carries NO layout opinions: replace it (or add pages beside it) based on
 * what the user asked for. See design_contract topic "archetypes" for layout recipes.
 */
import { createVobs } from '@vobs/vobs'
import { themePlugin, ThemeBoundary } from '@vobs/theme'
import '../styles/index.css'

function Home() {
  return (
    <div class="flex h-full items-center justify-center bg-background text-foreground">
      <p class="text-lg text-muted">Ready. Describe the pages you want.</p>
    </div>
  )
}

createVobs({
  render: () => (
    <ThemeBoundary>
      <Home />
    </ThemeBoundary>
  ),
  plugins: [themePlugin({ mode: 'system' })]
}).mount('#root')
