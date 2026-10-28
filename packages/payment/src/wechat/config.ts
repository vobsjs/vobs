import type { WechatClientOptions } from './types'

/**
 * WeChat Pay configuration management
 * Follows vobs lifecycle management: can be created, validated, updated, and replaced
 */
export class WechatConfig {
  private _options: WechatClientOptions

  constructor(options: WechatClientOptions) {
    this.validate(options)
    this._options = { ...options }
  }

  /** Full configuration */
  get options(): Readonly<WechatClientOptions> {
    return this._options
  }

  /** Merchant ID */
  get mchid(): string {
    return this._options.mchid
  }

  /** App ID (Official Account / Mini Program / App) */
  get appid(): string {
    return this._options.appid
  }

  /** Merchant API certificate serial number */
  get serial(): string {
    return this._options.serial
  }

  /** APIv3 key (used to decrypt callback payloads) */
  get apiv3Key(): string {
    return this._options.apiv3Key
  }

  /** Async notification URL */
  get notifyUrl(): string | undefined {
    return this._options.notifyUrl
  }

  /** Update config (partial update) */
  update(patch: Partial<WechatClientOptions>): void {
    const merged = { ...this._options, ...patch }
    this.validate(merged)
    this._options = merged
  }

  /** Replace config */
  replace(options: WechatClientOptions): void {
    this.validate(options)
    this._options = { ...options }
  }

  private validate(options: WechatClientOptions): void {
    if (!options.mchid) {
      throw new Error('WechatConfig: mchid must not be empty')
    }
    if (!options.serial) {
      throw new Error('WechatConfig: serial (merchant API certificate serial number) must not be empty')
    }
    if (!options.privateKey) {
      throw new Error('WechatConfig: privateKey (merchant API private key PEM) must not be empty')
    }
    if (!options.certs || Object.keys(options.certs).length === 0) {
      throw new Error('WechatConfig: certs (platform certificates / WeChat Pay public keys as {serial: PEM}) must not be empty')
    }
    if (!options.appid) {
      throw new Error('WechatConfig: appid must not be empty')
    }
    if (!options.apiv3Key) {
      throw new Error('WechatConfig: apiv3Key must not be empty')
    }
    if (options.apiv3Key.length !== 32) {
      throw new Error('WechatConfig: apiv3Key must be a 32-byte string')
    }
  }
}
