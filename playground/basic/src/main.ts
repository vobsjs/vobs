import { createVobs } from '@vobs/vobs'
import { App } from './App'
import './icons'
import { routerPluginInstance, resourceRouterPluginInstance } from './router'
import { authPluginInstance } from './plugins/auth'
import { devtoolsPluginInstance } from './plugins/devtools'
import { formsPluginInstance } from './plugins/forms'
import { httpPluginInstance } from './plugins/http'
import { i18nPluginInstance } from './plugins/i18n'
import { jwtAuthPluginInstance } from './plugins/jwt-auth'
import { loggerPluginInstance } from './plugins/logger'
import { mockApiPluginInstance } from './plugins/mock-api'
import { notificationPluginInstance } from './plugins/notification'
import { preferencesPluginInstance } from './plugins/preferences'
import { queuePluginInstance } from './plugins/queue'
import { resourcePluginInstance } from './plugins/resource'
import { storagePluginInstance } from './plugins/storage'
import { syncPluginInstance } from './plugins/sync'
import { themePluginInstance } from './plugins/theme'
import { uploadPluginInstance } from './plugins/upload'
import '@vobs/captcha/styles.css'
import '@vobs/devtools-ui/styles.css'
import '@vobs/ui/styles.css'
import '@vobs/layout/styles.css'
import '@vobs/kit/styles.css'
import '@vobs/table/styles.css'
import '@vobs/tailwind/styles.css'
import './styles/app.css'
import './styles/app-light.css'

createVobs({
  render: App,
  plugins: [
    authPluginInstance,
    jwtAuthPluginInstance,
    routerPluginInstance,
    resourcePluginInstance,
    resourceRouterPluginInstance,
    i18nPluginInstance,
    themePluginInstance,
    formsPluginInstance,
    mockApiPluginInstance,
    storagePluginInstance,
    preferencesPluginInstance,
    queuePluginInstance,
    httpPluginInstance,
    uploadPluginInstance,
    syncPluginInstance,
    notificationPluginInstance,
    loggerPluginInstance,
    devtoolsPluginInstance
  ]
}).mount('#app')
