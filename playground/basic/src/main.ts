import { createVobs } from '@vobs/vobs'
import { App } from './App'
import { authPluginInstance } from './auth'
import { devtoolsPluginInstance } from './devtools'
import { mockApiPluginInstance } from './mock-api'
import { formsPluginInstance } from './forms'
import { httpPluginInstance } from './http'
import { i18nPluginInstance } from './i18n'
import { loggerPluginInstance } from './logger'
import { notificationPluginInstance } from './notification'
import { preferencesPluginInstance } from './preferences'
import { queuePluginInstance } from './queue'
import { resourcePluginInstance } from './resource'
import { resourceRouterPluginInstance, routerPluginInstance } from './router'
import { storagePluginInstance } from './storage'
import { syncPluginInstance } from './sync'
import { themePluginInstance } from './theme'
import { uploadPluginInstance } from './upload'
import '@vobs/captcha/styles.css'
import '@vobs/devtools-ui/styles.css'
import '@vobs/ui/styles.css'
import '@vobs/layout/styles.css'
import '@vobs/kit/styles.css'
import '@vobs/table/styles.css'
import '@vobs/tailwind/styles.css'
import './app.css'
import './playground-light.css'

createVobs({
  render: App,
  plugins: [
    authPluginInstance,
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
