import { RouterView, useRouter } from '@vobs/router'
import { DevToolsWidget } from '@vobs/devtools-ui'
import { createComponent, createFragment, insertDynamic } from '@vobs/vobs'
import { ErrorPage } from './pages/errors/ErrorPage'
import { NotFoundPage } from './pages/errors/NotFoundPage'
import { useI18n } from '@vobs/i18n'
import { playgroundThemeMode } from './plugins/theme'

export function App() {
  const i18n = useI18n()
  return (
    <div class="playground-root" data-playground-theme={playgroundThemeMode.value}>
      <RouterView
        loading={<p class="demo-route-state">{i18n.t('common.loading')}</p>}
        notFound={route => <NotFoundPage route={route} />}
        error={(error, retry) => <ErrorPage error={error} retry={retry} />}
      />
      <AppDevTools />
    </div>
  )
}

function AppDevTools() {
  const router = useRouter()
  return createFragment((parent, anchor) => {
    insertDynamic(parent, anchor, () => createComponent(DevToolsWidget, { router }))
  })
}
