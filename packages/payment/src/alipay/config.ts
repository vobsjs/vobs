import type { AlipayClientOptions } from './types'

/**
 * 支付宝配置管理
 * 遵循 vobs 生命周期管理：可创建、可销毁、可替换
 */
export class AlipayConfig {
  private _options: AlipayClientOptions

  constructor(options: AlipayClientOptions) {
    this.validate(options)
    this._options = { ...options }
  }

  /** 获取完整配置 */
  get options(): Readonly<AlipayClientOptions> {
    return this._options
  }

  /** 应用 ID */
  get appId(): string {
    return this._options.appId
  }

  /** 网关地址 */
  get gateway(): string {
    return this._options.gateway ?? 'https://openapi.alipay.com/gateway.do'
  }

  /** 异步通知地址 */
  get notifyUrl(): string | undefined {
    return this._options.notifyUrl
  }

  /** 同步跳转地址 */
  get returnUrl(): string | undefined {
    return this._options.returnUrl
  }

  /** 更新配置（部分更新） */
  update(patch: Partial<AlipayClientOptions>): void {
    const merged = { ...this._options, ...patch }
    this.validate(merged)
    this._options = merged
  }

  /** 替换配置 */
  replace(options: AlipayClientOptions): void {
    this.validate(options)
    this._options = { ...options }
  }

  /** 创建沙箱配置的快捷方法 */
  static forSandbox(options: Omit<AlipayClientOptions, 'gateway'>): AlipayConfig {
    return new AlipayConfig({
      ...options,
      gateway: 'https://openapi-sandbox.dl.alipaydev.com/gateway.do'
    })
  }

  private validate(options: AlipayClientOptions): void {
    if (!options.appId) {
      throw new Error('AlipayConfig: appId 不能为空')
    }
    if (!options.privateKey) {
      throw new Error('AlipayConfig: privateKey 不能为空')
    }
    if (!options.alipayPublicKey) {
      throw new Error('AlipayConfig: alipayPublicKey 不能为空')
    }
  }
}