import { DevToolsPanel } from '@vobs/devtools-ui'
import { KitPage } from '@vobs/kit'

export function DevToolsPage() {
  return (
    <KitPage
      class="demo-shell"
      title="Runtime DevTools"
      description="Inspect the live component ownership tree and reactive graph."
    >
      <DevToolsPanel />
    </KitPage>
  )
}
