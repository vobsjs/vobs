import { createMemoryTransport, loggerPlugin } from '@vobs/logger'

export const loggerPluginInstance = loggerPlugin({
  level: 'debug',
  transports: [createMemoryTransport(40)]
})
