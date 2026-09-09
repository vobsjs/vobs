/**
 * @vobs/payment 根入口
 *
 * - 通用工厂中 createRefund / createNotifyHandler 在两个提供商间同名，
 *   统一通过 alipay.* / wechat.* 命名空间访问，避免同名不同客户端的隐式误用。
 * - 顶层平铺导出跨提供商无歧义的符号（客户端、配置、错误类、插件、注入键，
 *   以及名称唯一的工厂 createPagePay / createWapPay / createQuery / createPayment）。
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
