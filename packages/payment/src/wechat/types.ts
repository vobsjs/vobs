/** WeChat Pay APIv3 trade state */
export type WechatTradeState =
  | 'SUCCESS'
  | 'REFUND'
  | 'NOTPAY'
  | 'CLOSED'
  | 'REVOKED'
  | 'USERPAYING'
  | 'PAYERROR'

/** WeChat Pay APIv3 refund status */
export type WechatRefundStatus = 'SUCCESS' | 'CLOSED' | 'PROCESSING' | 'ABNORMAL'

export interface WechatPayParams {
  /** Merchant order number (6-32 chars, unique on the merchant side) */
  outTradeNo: string
  /** Goods description */
  description: string
  /** Order amount (in cents) */
  amount: WechatOrderAmount
  /** Payer openid (required for jsapi / mini-program pay) */
  openid?: string
  /** Attach data, returned as-is in the callback */
  attach?: string
  /** Discount tag */
  goodsTag?: string
  /** Order expiry time (RFC 3339, e.g. 2018-06-08T10:34:56+08:00) */
  timeExpire?: string
}

/** H5 pay params (additionally requires the payer IP) */
export interface WechatH5PayParams extends WechatPayParams {
  /** User client IP */
  payerClientIp: string
  /** Scene info */
  sceneInfo?: {
    payerClientIp?: string
    deviceType?: string
  }
}

/** Params for launching payment via JSAPI / mini-program (wx.requestPayment / WeixinJSBridge) */
export interface WechatJsapiPayResult {
  appId: string
  timeStamp: string
  nonceStr: string
  package: string
  signType: 'RSA'
  paySign: string
}

/** Params for launching payment via the APP SDK (same shape as JSAPI) */
export interface WechatAppPayResult extends WechatJsapiPayResult {}

/** Native order result: QR code URL */
export interface WechatNativePayResult {
  codeUrl: string
}

/** H5 order result: cashier redirect URL */
export interface WechatH5PayResult {
  h5Url: string
}

/** Trade query params (pass either outTradeNo or transactionId) */
export interface WechatQueryParams {
  outTradeNo?: string
  transactionId?: string
}

/** Trade query result (snake_case mapped to camelCase) */
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
  /** Order total amount (cents) */
  total: number
  /** Payer paid amount (cents) */
  payerTotal?: number
}

/** Refund params */
export interface WechatRefundParams {
  outTradeNo?: string
  transactionId?: string
  /** Merchant refund order number (unique on the merchant side) */
  outRefundNo: string
  /** Refund amount (in cents) */
  amount: WechatRefundAmount
  /** Refund reason */
  reason?: string
  /** Refund result callback URL */
  notifyUrl?: string
  /** Refund fund source: AVAILABLE | UNSETTLED, default AVAILABLE */
  fundsAccount?: 'AVAILABLE' | 'UNSETTLED'
}

/** Refund request result */
export interface WechatRefundResult {
  refundId: string
  outRefundNo: string
  outTradeNo: string
  transactionId: string
  status: WechatRefundStatus
  /** Refund amount (cents) */
  refundAmount: number
  /** Order total amount (cents) */
  total: number
  /** Amount credited to the user's account (cents) */
  userReceivedAmount?: number
  successTime?: string
  reason?: string
}

/** Refund query params (pass either outRefundNo or refundId) */
export interface WechatRefundQueryParams {
  outRefundNo?: string
  refundId?: string
}

/** resource field of the async notification payload (AES-256-GCM encrypted) */
export interface WechatNotifyResource {
  originalType?: string
  algorithm?: string
  ciphertext: string
  associatedData?: string
  nonce: string
}

/** HTTP headers required for async notification signature verification */
export interface WechatNotifyHeaders {
  /** Wechatpay-Timestamp */
  timestamp: string
  /** Wechatpay-Nonce */
  nonce: string
  /** Wechatpay-Serial (platform cert serial / WeChat Pay public key ID) */
  serial: string
  /** Wechatpay-Signature */
  signature: string
}

/** Decrypted payment-success / state-change notification */
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

/** Decrypted refund result notification */
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

/** WeChat Pay client configuration */
export interface WechatClientOptions {
  /** Merchant ID */
  mchid: string
  /** Merchant API certificate serial number */
  serial: string
  /** Merchant API private key (PEM string) */
  privateKey: string
  /** Platform certs / WeChat Pay public keys as {serial (or public key ID): PEM}; notification verify looks up by Wechatpay-Serial */
  certs: Record<string, string>
  /** App ID (official account / mini-program / APP), used for ordering and launch signing */
  appid: string
  /** APIv3 key (32 bytes, for callback decryption) */
  apiv3Key: string
  /** Async notify URL (can be overridden per order via params.notifyUrl) */
  notifyUrl?: string
  /** Request timeout (ms) */
  timeout?: number
}

/** Order amount (in cents) */
export interface WechatOrderAmount {
  /** Order total amount (cents) */
  total: number
  /** Currency, default CNY */
  currency?: string
}

/** Refund amount (in cents) */
export interface WechatRefundAmount {
  /** Refund amount (cents) */
  refund: number
  /** Original order amount (cents); required for profit-sharing scenarios */
  total?: number
  currency?: string
}
