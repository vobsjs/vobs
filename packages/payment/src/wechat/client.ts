import { Wechatpay } from 'wechatpay-axios-plugin'
import { WechatConfig } from './config'
import type { WechatClientOptions } from './types'

/**
 * 微信支付客户端封装
 *
 * 封装官方 wechatpay-axios-plugin 的 Wechatpay 实例，提供统一的生命周期管理。
 * 可独立使用，也可通过 wechatPlugin 注册到 vobs 框架。
 *
 * @example
 * ```ts
 * const client = new WechatClient({
 *   mchid: '1900000000',
 *   serial: '商户API证书序列号',
 *   privateKey: '-----BEGIN PRIVATE KEY-----...',
 *   certs: { 'PUB_KEY_ID_xxx': '-----BEGIN PUBLIC KEY-----...' },
 *   appid: 'wx1234567890',
 *   apiv3Key: '32字节APIv3密钥',
 *   notifyUrl: 'https://your-domain.com/wechat/notify'
 * })
 * ```
 */
export class WechatClient {
  readonly config: WechatConfig
  private _sdk: Wechatpay
  private _disposed = false

  constructor(options: WechatClientOptions) {
    this.config = new WechatConfig(options)
    this._sdk = this.createSdk(options)
  }

  /** 获取底层 Wechatpay 实例（链式 API：client.sdk.v3.pay.transactions.jsapi.post(...)） */
  get sdk(): Wechatpay {
    this.ensureActive()
    return this._sdk
  }

  /** 更新配置并重建 SDK 实例 */
  updateConfig(patch: Partial<WechatClientOptions>): void {
    this.ensureActive()
    this.config.update(patch)
    this._sdk = this.createSdk(this.config.options as WechatClientOptions)
  }

  /** 销毁客户端 */
  dispose(): void {
    this._disposed = true
    ;(this._sdk as any) = null
  }

  private createSdk(options: WechatClientOptions): Wechatpay {
    return new Wechatpay({
      mchid: options.mchid,
      serial: options.serial,
      privateKey: options.privateKey,
      certs: options.certs,
      timeout: options.timeout ?? 5000
    })
  }

  private ensureActive(): void {
    if (this._disposed) {
      throw new Error('WechatClient: 客户端已销毁')
    }
  }
}
