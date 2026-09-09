import { createInjectionKey, inject, type VobsContext, type VobsPlugin } from '@vobs/vobs'
import { WechatClient } from './client'
import type { WechatClientOptions } from './types'

export const WECHAT_KEY = createInjectionKey<WechatClient>('vobs.payment.wechat')

export interface WechatPluginOptions {
  /** 微信支付客户端配置（未传入 client 时必填） */
  config?: WechatClientOptions
  /** 可选的已有客户端实例（指定后忽略 config） */
  client?: WechatClient
}

/** 从 vobs 插件上下文获取微信支付客户端 */
export function useWechat(): WechatClient {
  const client = inject(WECHAT_KEY)
  if (!client) {
    throw new Error('Vobs Payment: 找不到 WechatClient，请安装 wechatPlugin')
  }
  return client
}

/**
 * 微信支付插件
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
        throw new Error('Vobs Payment: wechatPlugin 需要提供 config 或 client 之一')
      }
      // 仅销毁插件自建的客户端；外部传入的实例由其所有者负责生命周期。
      const ownClient = !options.client
      const client = options.client ?? new WechatClient(options.config!)
      context.provide(WECHAT_KEY, client)
      return ownClient ? () => client.dispose() : undefined
    }
  }
}
