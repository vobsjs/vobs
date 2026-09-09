import { storagePlugin } from '@vobs/storage'

export const storagePluginInstance = storagePlugin({ storage: 'local', prefix: 'playground:' })
