import { AlipaySdk } from 'alipay-sdk'
import { AlipayConfig } from './config'
import type { AlipayClientOptions, AlipayKeyType } from './types'

/**
 * 支付宝客户端封装
 *
 * 封装 alipay-sdk 的 AlipaySdk 实例，提供统一的生命周期管理。
 * 可独立使用，也可通过 alipayPlugin 注册到 vobs 框架。
 *
 * @example
 * ```ts
 * const client = new AlipayClient({
 *   appId: '202100...',
 *   privateKey: '...',
 *   alipayPublicKey: '...',
 *   gateway: 'https://openapi-sandbox.dl.alipaydev.com/gateway.do'
 * })
 * ```
 */
export class AlipayClient {
  readonly config: AlipayConfig
  private _sdk: AlipaySdk
  private _disposed = false

  constructor(options: AlipayClientOptions) {
    this.config = new AlipayConfig(options)
    this._sdk = this.createSdk(options)
  }

  /** 获取底层 AlipaySdk 实例 */
  get sdk(): AlipaySdk {
    this.ensureActive()
    return this._sdk
  }

  /** 更新配置并重建 SDK 实例 */
  updateConfig(patch: Partial<AlipayClientOptions>): void {
    this.ensureActive()
    this.config.update(patch)
    this._sdk = this.createSdk(this.config.options as AlipayClientOptions)
  }

  /** 销毁客户端 */
  dispose(): void {
    this._disposed = true
    ;(this._sdk as any) = null
  }

  private createSdk(options: AlipayClientOptions): AlipaySdk {
    return new AlipaySdk({
      appId: options.appId,
      privateKey: options.privateKey,
      alipayPublicKey: options.alipayPublicKey,
      signType: options.signType ?? 'RSA2',
      gateway: options.gateway,
      timeout: options.timeout ?? 5000,
      keyType: (options.keyType ?? 'PKCS1') as AlipayKeyType
    })
  }

  private ensureActive(): void {
    if (this._disposed) {
      throw new Error('AlipayClient: 客户端已销毁')
    }
  }
}