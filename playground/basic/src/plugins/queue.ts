import { queuePlugin } from '@vobs/queue'

export const queuePluginInstance = queuePlugin({ concurrency: 2 })
