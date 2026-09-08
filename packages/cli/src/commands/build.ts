import { build } from 'vite'
import { logger } from '../utils/logger.js'
import type { BuildOptions } from '../types.js'

export async function buildCommand(options: BuildOptions): Promise<void> {
  logger.info('Building for production...')

  await build({
    configFile: options.config,
    build: {
      outDir: options.outDir
    },
    mode: options.mode || 'production'
  })

  logger.success('Build complete')
}