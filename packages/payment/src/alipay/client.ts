import { AlipaySdk } from 'alipay-sdk'
import { AlipayConfig } from './config'
import type { AlipayClientOptions, AlipayKeyType } from './types'

/**
 * Alipay client wrapper
 *
 * Wraps the alipay-sdk AlipaySdk instance with unified lifecycle management.
 * Can be used standalone or registered into the vobs framework via alipayPlugin.
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

  /** Get the underlying AlipaySdk instance */
  get sdk(): AlipaySdk {
    this.ensureActive()
    return this._sdk
  }

  /** Update configuration and rebuild the SDK instance */
  updateConfig(patch: Partial<AlipayClientOptions>): void {
    this.ensureActive()
    this.config.update(patch)
    this._sdk = this.createSdk(this.config.options as AlipayClientOptions)
  }

  /** Dispose the client */
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
      throw new Error('AlipayClient: client has been disposed')
    }
  }
}