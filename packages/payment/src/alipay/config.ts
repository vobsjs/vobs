import type { AlipayClientOptions } from './types'

/**
 * Alipay configuration management
 * Follows the vobs lifecycle: create, dispose, and replace
 */
export class AlipayConfig {
  private _options: AlipayClientOptions

  constructor(options: AlipayClientOptions) {
    this.validate(options)
    this._options = { ...options }
  }

  /** Get the full configuration */
  get options(): Readonly<AlipayClientOptions> {
    return this._options
  }

  /** App ID */
  get appId(): string {
    return this._options.appId
  }

  /** Gateway URL */
  get gateway(): string {
    return this._options.gateway ?? 'https://openapi.alipay.com/gateway.do'
  }

  /** Async notify URL */
  get notifyUrl(): string | undefined {
    return this._options.notifyUrl
  }

  /** Sync return URL */
  get returnUrl(): string | undefined {
    return this._options.returnUrl
  }

  /** Update configuration (partial merge) */
  update(patch: Partial<AlipayClientOptions>): void {
    const merged = { ...this._options, ...patch }
    this.validate(merged)
    this._options = merged
  }

  /** Replace configuration */
  replace(options: AlipayClientOptions): void {
    this.validate(options)
    this._options = { ...options }
  }

  /** Shortcut for creating a sandbox configuration */
  static forSandbox(options: Omit<AlipayClientOptions, 'gateway'>): AlipayConfig {
    return new AlipayConfig({
      ...options,
      gateway: 'https://openapi-sandbox.dl.alipaydev.com/gateway.do'
    })
  }

  private validate(options: AlipayClientOptions): void {
    if (!options.appId) {
      throw new Error('AlipayConfig: appId is required')
    }
    if (!options.privateKey) {
      throw new Error('AlipayConfig: privateKey is required')
    }
    if (!options.alipayPublicKey) {
      throw new Error('AlipayConfig: alipayPublicKey is required')
    }
  }
}