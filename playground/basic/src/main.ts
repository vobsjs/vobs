import { createVobs } from '@vobs/vobs'
import { registerIcon } from '@vobs/ui'
import { App } from './App'
import { authPluginInstance } from './auth'
import { jwtAuthPluginInstance } from './jwt-auth'
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

// 登录页 JWT 模式使用的图标（VUI_ICON_PATHS 内置注册表中没有 lock/key）。
registerIcon({ name: 'lock', path: '<rect x="4" y="11" width="16" height="10"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>' })
registerIcon({ name: 'key', path: '<circle cx="7.5" cy="14.5" r="3.5"/><line x1="10" y1="12" x2="22" y2="12"/><line x1="22" y1="12" x2="22" y2="16"/><line x1="18" y1="12" x2="18" y2="15"/>' })

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
