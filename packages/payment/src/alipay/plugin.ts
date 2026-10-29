import { createInjectionKey, inject, type VobsPlugin, type VobsContext } from '@vobs/vobs'
import { AlipayClient } from './client'
import type { AlipayClientOptions } from './types'

export const ALIPAY_KEY = createInjectionKey<AlipayClient>('vobs.payment.alipay')

export interface AlipayPluginOptions {
  /** Alipay client configuration (required when client is not provided) */
  config?: AlipayClientOptions
  /** Optional existing client instance (config is ignored when set) */
  client?: AlipayClient
}

/**
 * Alipay payment plugin
 *
 * Injects AlipayClient into the vobs framework; retrieve it via useAlipay().
 *
 * @example
 * ```ts
 * createVobs({
 *   render: App,
 *   plugins: [
 *     alipayPlugin({
 *       config: {
 *         appId: '202100...',
 *         privateKey: '...',
 *         alipayPublicKey: '...',
 *       }
 *     })
 *   ]
 * })
 * ```
 */
export function alipayPlugin(options: AlipayPluginOptions): VobsPlugin {
  return {
    name: '@vobs/payment/alipay',
    version: '0.1.0',
    install(context: VobsContext) {
      if (!options.client && !options.config) {
        throw new Error('Vobs Payment: alipayPlugin requires either config or client')
      }
      // Only dispose the client created by the plugin itself; externally provided instances are owned by their creator.
      const ownClient = !options.client
      const client = options.client ?? new AlipayClient(options.config!)
      context.provide(ALIPAY_KEY, client)
      return ownClient ? () => client.dispose() : undefined
    }
  }
}

/**
 * Get the AlipayClient instance
 * Must be called within a component or context where alipayPlugin is installed
 */
export function useAlipay(): AlipayClient {
  const client = inject(ALIPAY_KEY)
  if (!client) {
    throw new Error(
      'Vobs Payment: AlipayClient not found; install alipayPlugin first'
    )
  }
  return client
}