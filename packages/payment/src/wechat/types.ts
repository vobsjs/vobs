/** 微信支付 APIv3 交易状态 */
export type WechatTradeState =
  | 'SUCCESS'
  | 'REFUND'
  | 'NOTPAY'
  | 'CLOSED'
  | 'REVOKED'
  | 'USERPAYING'
  | 'PAYERROR'

/** 微信支付 APIv3 退款状态 */
export type WechatRefundStatus = 'SUCCESS' | 'CLOSED' | 'PROCESSING' | 'ABNORMAL'

export interface WechatPayParams {
  /** 商户订单号（6-32 位，商户侧唯一） */
  outTradeNo: string
  /** 商品描述 */
  description: string
  /** 订单金额（单位：分） */
  amount: WechatOrderAmount
  /** 支付者 openid（jsapi / 小程序支付必填） */
  openid?: string
  /** 附加数据，回调时原样返回 */
  attach?: string
  /** 优惠标记 */
  goodsTag?: string
  /** 订单过期时间（RFC 3339，如 2018-06-08T10:34:56+08:00） */
  timeExpire?: string
}

/** H5 支付参数（额外要求支付者 IP） */
export interface WechatH5PayParams extends WechatPayParams {
  /** 用户客户端 IP */
  payerClientIp: string
  /** 场景信息 */
  sceneInfo?: {
    payerClientIp?: string
    deviceType?: string
  }
}

/** JSAPI / 小程序调起支付所需参数（wx.requestPayment / WeixinJSBridge） */
export interface WechatJsapiPayResult {
  appId: string
  timeStamp: string
  nonceStr: string
  package: string
  signType: 'RSA'
  paySign: string
}

/** APP 调起支付所需参数（与 JSAPI 同构） */
export interface WechatAppPayResult extends WechatJsapiPayResult {}

/** Native 下单结果：二维码链接 */
export interface WechatNativePayResult {
  codeUrl: string
}

/** H5 下单结果：收银台跳转链接 */
export interface WechatH5PayResult {
  h5Url: string
}

/** 交易查询参数（outTradeNo 与 transactionId 二选一） */
export interface WechatQueryParams {
  outTradeNo?: string
  transactionId?: string
}

/** 交易查询结果（snake_case 已映射为 camelCase） */
export interface WechatQueryResult {
  appid: string
  mchid: string
  outTradeNo: string
  transactionId: string
  tradeType?: string
  tradeState: WechatTradeState
  tradeStateDesc?: string
  bankType?: string
  attach?: string
  successTime?: string
  /** 订单总金额（分） */
  total: number
  /** 用户实付金额（分） */
  payerTotal?: number
}

/** 退款金额 */
export interface WechatRefundParams {
  outTradeNo?: string
  transactionId?: string
  /** 商户退款单号（商户侧唯一） */
  outRefundNo: string
  /** 退款金额（单位：分） */
  amount: WechatRefundAmount
  /** 退款原因 */
  reason?: string
  /** 退款结果回调地址 */
  notifyUrl?: string
  /** 退款资金来源：AVAILABLE（可用余额）| UNSETTLED（待结算资金），默认 AVAILABLE */
  fundsAccount?: 'AVAILABLE' | 'UNSETTLED'
}

/** 退款申请结果 */
export interface WechatRefundResult {
  refundId: string
  outRefundNo: string
  outTradeNo: string
  transactionId: string
  status: WechatRefundStatus
  /** 退款金额（分） */
  refundAmount: number
  /** 订单总金额（分） */
  total: number
  /** 退款入账账户金额（分） */
  userReceivedAmount?: number
  successTime?: string
  reason?: string
}

/** 退款查询参数（outRefundNo 与 refundId 二选一） */
export interface WechatRefundQueryParams {
  outRefundNo?: string
  refundId?: string
}

/** 异步通知报文 resource 字段（AES-256-GCM 加密） */
export interface WechatNotifyResource {
  originalType?: string
  algorithm?: string
  ciphertext: string
  associatedData?: string
  nonce: string
}

/** 异步通知验签所需的 HTTP 头 */
export interface WechatNotifyHeaders {
  /** Wechatpay-Timestamp */
  timestamp: string
  /** Wechatpay-Nonce */
  nonce: string
  /** Wechatpay-Serial（平台证书序列号 / 微信支付公钥 ID） */
  serial: string
  /** Wechatpay-Signature */
  signature: string
}

/** 解密后的支付成功/状态变更通知 */
export interface WechatNotifyTransaction {
  mchid: string
  appid: string
  outTradeNo: string
  transactionId: string
  tradeType?: string
  tradeState: WechatTradeState
  tradeStateDesc?: string
  bankType?: string
  attach?: string
  successTime?: string
  amount: {
    total: number
    payerTotal?: number
    currency?: string
    payerCurrency?: string
  }
}

/** 解密后的退款结果通知 */
export interface WechatNotifyRefund {
  mchid: string
  outTradeNo: string
  transactionId: string
  outRefundNo: string
  refundId: string
  refundStatus: WechatRefundStatus
  successTime?: string
  amount: {
    total: number
    refund: number
    payerTotal?: number
    userReceivedAmount?: number
    currency?: string
  }
  userAccount?: string
}

/** 微信支付客户端配置 */
export interface WechatClientOptions {
  /** 商户号 */
  mchid: string
  /** 商户 API 证书序列号 */
  serial: string
  /** 商户 API 私钥（PEM 字符串） */
  privateKey: string
  /** 平台证书 / 微信支付公钥，{序列号(或公钥ID): PEM} 映射；通知验签按 Wechatpay-Serial 查找 */
  certs: Record<string, string>
  /** 应用 ID（公众号 / 小程序 / APP），用于下单与调起签名 */
  appid: string
  /** APIv3 密钥（32 字节，回调解密用） */
  apiv3Key: string
  /** 异步通知地址（下单时可被 params.notifyUrl 覆盖） */
  notifyUrl?: string
  /** 请求超时（毫秒） */
  timeout?: number
}

/** 订单金额（单位：分） */
export interface WechatOrderAmount {
  /** 订单总金额（分） */
  total: number
  /** 币种，默认 CNY */
  currency?: string
}

/** 退款金额（单位：分） */
export interface WechatRefundAmount {
  /** 退款金额（分） */
  refund: number
  /** 原订单金额（分），分账等场景必填 */
  total?: number
  currency?: string
}
