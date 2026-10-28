import { Wechatpay } from 'wechatpay-axios-plugin'
import { WechatConfig } from './config'
import type { WechatClientOptions } from './types'

/**
 * WeChat Pay client wrapper
 *
 * Wraps the official wechatpay-axios-plugin Wechatpay instance with unified lifecycle
 * management. Can be used standalone or registered into the vobs framework via wechatPlugin.
 *
 * @example
 * ```ts
 * const client = new WechatClient({
 *   mchid: '1900000000',
 *   serial: 'merchant API certificate serial number',
 *   privateKey: '-----BEGIN PRIVATE KEY-----...',
 *   certs: { 'PUB_KEY_ID_xxx': '-----BEGIN PUBLIC KEY-----...' },
 *   appid: 'wx1234567890',
 *   apiv3Key: '32-byte APIv3 key',
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

  /** Underlying Wechatpay instance (chained API: client.sdk.v3.pay.transactions.jsapi.post(...)) */
  get sdk(): Wechatpay {
    this.ensureActive()
    return this._sdk
  }

  /** Update config and rebuild the SDK instance */
  updateConfig(patch: Partial<WechatClientOptions>): void {
    this.ensureActive()
    this.config.update(patch)
    this._sdk = this.createSdk(this.config.options as WechatClientOptions)
  }

  /** Dispose the client */
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
      throw new Error('WechatClient: client has been disposed')
    }
  }
}
