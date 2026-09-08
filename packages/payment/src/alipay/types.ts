import type { AlipaySdkConfig, AlipaySdkSignType } from 'alipay-sdk'

// ---- 重新导出 alipay-sdk 类型 ----
export type { AlipaySdkConfig, AlipaySdkSignType }

// ---- 电脑网站支付 (alipay.trade.page.pay) ----
export interface AlipayPagePayParams {
  /** 商户订单号，需保证唯一 */
  outTradeNo: string
  /** 订单总金额，单位元，精确到两位小数 */
  totalAmount: string
  /** 订单标题 */
  subject: string
  /** 产品代码，电脑网站支付固定为 FAST_INSTANT_TRADE_PAY */
  productCode?: string
  /** 订单描述 */
  body?: string
  /** 绝对超时时间，格式 yyyy-MM-dd HH:mm:ss */
  timeExpire?: string
  /** 订单相对超时时间，范围 1m~15d */
  timeoutExpress?: string
  /** 商品主类型：0-虚拟，1-实物 */
  goodsType?: '0' | '1'
  /** 公用回传参数，异步通知时原样返回 */
  passbackParams?: string
  /** 支付完成后同步跳转地址 */
  returnUrl?: string
  /** 异步通知地址 */
  notifyUrl?: string
  /** 扩展信息 */
  extendParams?: Record<string, string>
  /** 商户门店编号 */
  storeId?: string
  /** 是否发起实名校验 */
  qrPayMode?: string
  /** 扫码支付模式 */
  qrcodeWidth?: string
}

export interface AlipayPagePayResult {
  /** 支付宝返回的 HTML 表单字符串 */
  formHtml: string
}

// ---- 交易查询 (alipay.trade.query) ----
export interface AlipayQueryParams {
  outTradeNo?: string
  tradeNo?: string
}

export interface AlipayQueryResult {
  /** 支付宝交易号 */
  tradeNo: string
  /** 商户订单号 */
  outTradeNo: string
  /** 买家支付宝账号 */
  buyerLogonId: string
  /** 交易状态 */
  tradeStatus: TradeStatus
  /** 交易的订单金额 */
  totalAmount: string
  /** 实收金额 */
  receiptAmount: string
  /** 买家实付金额 */
  buyerPayAmount: string
  /** 交易创建时间 */
  sendPayDate: string
  /** 交易付款时间 */
  gmtPayment: string | null
  /** 交易关闭时间 */
  gmtClose: string | null
  /** 退款金额 */
  refundAmount: string
  /** 商品描述 */
  subject: string
  /** 商户传入的回传参数 */
  passbackParams: string | null
  /** 本次交易支付工具 */
  fundChannel: string | null
}

// ---- 交易退款 (alipay.trade.refund) ----
export interface AlipayRefundParams {
  outTradeNo?: string
  tradeNo?: string
  refundAmount: string
  refundReason?: string
  outRequestNo?: string
  refundCurrency?: string
}

export interface AlipayRefundResult {
  /** 支付宝交易号 */
  tradeNo: string
  /** 商户订单号 */
  outTradeNo: string
  /** 买家支付宝账号 */
  buyerLogonId: string
  /** 本次退款请求金额 */
  refundAmount: string
  /** 资金变动明细 */
  fundChange: string
  /** 退款时间 */
  gmtRefundPay: string
  /** 退款金额（含各渠道） */
  refundDetailItemList: Array<{
    contributionType: string
    amount: string
  }> | null
}

// ---- 交易关闭 (alipay.trade.close) ----
export interface AlipayCloseParams {
  outTradeNo?: string
  tradeNo?: string
}

export interface AlipayCloseResult {
  /** 支付宝交易号 */
  tradeNo: string
  /** 商户订单号 */
  outTradeNo: string
}

// ---- 退款查询 (alipay.trade.fastpay.refund.query) ----
export interface AlipayRefundQueryParams {
  outTradeNo?: string
  tradeNo?: string
  outRequestNo: string
}

export interface AlipayRefundQueryResult {
  /** 支付宝交易号 */
  tradeNo: string
  /** 商户订单号 */
  outTradeNo: string
  /** 退款金额 */
  refundAmount: string
  /** 退款状态 */
  refundStatus: string
  /** 退款请求号 */
  outRequestNo: string
  /** 退款原因 */
  refundReason: string
}

// ---- 异步通知 ----
export interface AlipayNotifyParams {
  [key: string]: string | undefined
  notifyTime: string
  notifyType: string
  notifyId: string
  appId: string
  charset: string
  version: string
  signType: string
  sign: string
  tradeNo: string
  outTradeNo: string
  outBizNo?: string
  buyerId: string
  buyerLogonId: string
  sellerId: string
  sellerEmail: string
  tradeStatus: string
  totalAmount: string
  receiptAmount: string
  invoiceAmount: string
  buyerPayAmount: string
  pointAmount: string
  refundFee: string
  subject: string
  body: string
  gmtCreate: string
  gmtPayment: string
  gmtClose: string
  fundBillList: string
  passbackParams: string
  voucherDetailList: string
}

// ---- 通用 ----
export type TradeStatus =
  | 'WAIT_BUYER_PAY'
  | 'TRADE_CLOSED'
  | 'TRADE_SUCCESS'
  | 'TRADE_FINISHED'

export type AlipayKeyType = 'PKCS1' | 'PKCS8'

export interface AlipayClientOptions {
  /** 应用 ID */
  appId: string
  /** 应用私钥（Node.js 使用 PKCS#1 格式） */
  privateKey: string
  /** 支付宝公钥 */
  alipayPublicKey: string
  /** 签名类型，默认 RSA2 */
  signType?: AlipaySdkSignType
  /** 网关地址，沙箱使用沙箱网关 */
  gateway?: string
  /** 异步通知地址 */
  notifyUrl?: string
  /** 同步跳转地址 */
  returnUrl?: string
  /** 私钥类型，默认 PKCS1（Node.js 使用 PKCS1） */
  keyType?: AlipayKeyType
  /** 请求超时时间，默认 5000ms */
  timeout?: number
}

/** 电脑网站支付配置 */
export interface AlipayPagePayConfig {
  /** 商户订单号 */
  outTradeNo: string
  /** 订单总金额，单位元 */
  totalAmount: string
  /** 订单标题 */
  subject: string
  /** 订单描述 */
  body?: string
  /** 公用回传参数 */
  passbackParams?: string
}