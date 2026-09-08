import { createInjectionKey, inject, type VobsPlugin, type VobsContext } from '@vobs/vobs'
import { AlipayClient } from './client'
import type { AlipayClientOptions } from './types'

export const ALIPAY_KEY = createInjectionKey<AlipayClient>('vobs.payment.alipay')

export interface AlipayPluginOptions {
  /** 支付宝客户端配置 */
  config: AlipayClientOptions
  /** 可选的已有客户端实例（指定后忽略 config） */
  client?: AlipayClient
}

/**
 * 支付宝支付插件
 *
 * 将 AlipayClient 注入到 vobs 框架中，可通过 useAlipay() 获取。
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
      const client = options.client ?? new AlipayClient(options.config)
      context.provide(ALIPAY_KEY, client)
      return () => client.dispose()
    }
  }
}

/**
 * 获取支付宝客户端实例
 * 必须在已安装 alipayPlugin 的组件或上下文中调用
 */
export function useAlipay(): AlipayClient {
  const client = inject(ALIPAY_KEY)
  if (!client) {
    throw new Error(
      'Vobs Payment: 找不到 AlipayClient，请安装 alipayPlugin'
    )
  }
  return client
}