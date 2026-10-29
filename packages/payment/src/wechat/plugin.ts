import { createInjectionKey, inject, type VobsContext, type VobsPlugin } from '@vobs/vobs'
import { WechatClient } from './client'
import type { WechatClientOptions } from './types'

export const WECHAT_KEY = createInjectionKey<WechatClient>('vobs.payment.wechat')

export interface WechatPluginOptions {
  /** WeChat Pay client configuration (required when client is not provided) */
  config?: WechatClientOptions
  /** Optional existing client instance (config is ignored when set) */
  client?: WechatClient
}

/** Get the WeChat Pay client from the vobs plugin context */
export function useWechat(): WechatClient {
  const client = inject(WECHAT_KEY)
  if (!client) {
    throw new Error('Vobs Payment: WechatClient not found; install wechatPlugin first')
  }
  return client
}

/**
 * WeChat Pay plugin
 *
 * @example
 * ```ts
 * createVobs({
 *   plugins: [
 *     wechatPlugin({
 *       config: {
 *         mchid: '1900000000',
 *         serial: '...',
 *         privateKey: '...',
 *         certs: { 'PUB_KEY_ID_xxx': '...' },
 *         appid: 'wx1234567890',
 *         apiv3Key: '...'
 *       }
 *     })
 *   ]
 * })
 * ```
 */
export function wechatPlugin(options: WechatPluginOptions): VobsPlugin {
  return {
    name: '@vobs/payment/wechat',
    version: '0.1.0',
    install(context: VobsContext) {
      if (!options.client && !options.config) {
        throw new Error('Vobs Payment: wechatPlugin requires either config or client')
      }
      // Only dispose the client created by the plugin itself; externally provided instances are owned by their creator.
      const ownClient = !options.client
      const client = options.client ?? new WechatClient(options.config!)
      context.provide(WECHAT_KEY, client)
      return ownClient ? () => client.dispose() : undefined
    }
  }
}
