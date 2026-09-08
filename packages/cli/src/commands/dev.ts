import { createServer } from 'vite'
import { logger } from '../utils/logger.js'
import type { DevOptions } from '../types.js'

export async function devCommand(options: DevOptions): Promise<void> {
  logger.info('Starting dev server...')

  const server = await createServer({
    configFile: options.config,
    server: {
      port: options.port,
      open: options.open
    }
  })

  await server.listen()
  server.printUrls()
  logger.success('Dev server is running')
}