import type { WechatClientOptions } from './types'

/**
 * 微信支付配置管理
 * 遵循 vobs 生命周期管理：可创建、可校验、可更新、可替换
 */
export class WechatConfig {
  private _options: WechatClientOptions

  constructor(options: WechatClientOptions) {
    this.validate(options)
    this._options = { ...options }
  }

  /** 获取完整配置 */
  get options(): Readonly<WechatClientOptions> {
    return this._options
  }

  /** 商户号 */
  get mchid(): string {
    return this._options.mchid
  }

  /** 应用 ID（公众号 / 小程序 / APP） */
  get appid(): string {
    return this._options.appid
  }

  /** 商户 API 证书序列号 */
  get serial(): string {
    return this._options.serial
  }

  /** APIv3 密钥（回调解密用） */
  get apiv3Key(): string {
    return this._options.apiv3Key
  }

  /** 异步通知地址 */
  get notifyUrl(): string | undefined {
    return this._options.notifyUrl
  }

  /** 更新配置（部分更新） */
  update(patch: Partial<WechatClientOptions>): void {
    const merged = { ...this._options, ...patch }
    this.validate(merged)
    this._options = merged
  }

  /** 替换配置 */
  replace(options: WechatClientOptions): void {
    this.validate(options)
    this._options = { ...options }
  }

  private validate(options: WechatClientOptions): void {
    if (!options.mchid) {
      throw new Error('WechatConfig: mchid 不能为空')
    }
    if (!options.serial) {
      throw new Error('WechatConfig: serial（商户 API 证书序列号）不能为空')
    }
    if (!options.privateKey) {
      throw new Error('WechatConfig: privateKey（商户 API 私钥 PEM）不能为空')
    }
    if (!options.certs || Object.keys(options.certs).length === 0) {
      throw new Error('WechatConfig: certs（平台证书/微信支付公钥 {序列号: PEM}）不能为空')
    }
    if (!options.appid) {
      throw new Error('WechatConfig: appid 不能为空')
    }
    if (!options.apiv3Key) {
      throw new Error('WechatConfig: apiv3Key 不能为空')
    }
    if (options.apiv3Key.length !== 32) {
      throw new Error('WechatConfig: apiv3Key 必须为 32 字节字符串')
    }
  }
}
