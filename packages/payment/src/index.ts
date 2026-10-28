/**
 * @vobs/payment root entry
 *
 * - Among the generic factories, createRefund / createNotifyHandler share the same name
 *   across the two providers; they are accessed uniformly via the alipay.* / wechat.*
 *   namespaces to avoid implicitly calling the same-named API on the wrong client.
 * - Top-level flat exports cover provider-agnostic symbols (clients, configs, error classes,
 *   plugins, injection keys, plus factories whose names are unambiguous: createPagePay /
 *   createWapPay / createQuery / createPayment).
 */
export * as alipay from './alipay'
export * as wechat from './wechat'

export {
  AlipayClient,
  AlipayConfig,
  AlipayApiError,
  createPagePay,
  createWapPay,
  createQuery,
  alipayPlugin,
  useAlipay,
  ALIPAY_KEY
} from './alipay'
export type {
  AlipayClientOptions,
  AlipayKeyType,
  AlipaySdkConfig,
  AlipaySdkSignType,
  AlipayPagePayConfig,
  AlipayPagePayParams,
  AlipayPagePayResult,
  AlipayWapPayConfig,
  AlipayWapPayParams,
  AlipayWapPayResult,
  AlipayQueryParams,
  AlipayQueryResult,
  AlipayRefundParams,
  AlipayRefundResult,
  AlipayRefundQueryParams,
  AlipayRefundQueryResult,
  AlipayCloseParams,
  AlipayCloseResult,
  AlipayNotifyParams,
  TradeStatus,
  AlipayPluginOptions
} from './alipay'

export {
  WechatClient,
  WechatConfig,
  WechatApiError,
  createPayment,
  wechatPlugin,
  useWechat,
  WECHAT_KEY
} from './wechat'
export type {
  WechatClientOptions,
  WechatPayParams,
  WechatH5PayParams,
  WechatJsapiPayResult,
  WechatAppPayResult,
  WechatNativePayResult,
  WechatH5PayResult,
  WechatQueryParams,
  WechatQueryResult,
  WechatRefundParams,
  WechatRefundResult,
  WechatRefundQueryParams,
  WechatRefundAmount,
  WechatOrderAmount,
  WechatTradeState,
  WechatRefundStatus,
  WechatNotifyResource,
  WechatNotifyHeaders,
  WechatNotifyTransaction,
  WechatNotifyRefund,
  WechatPluginOptions
} from './wechat'
