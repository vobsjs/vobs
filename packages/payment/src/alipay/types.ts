import type { AlipaySdkConfig, AlipaySdkSignType } from 'alipay-sdk'

// ---- Re-exported alipay-sdk types ----
export type { AlipaySdkConfig, AlipaySdkSignType }

// ---- Desktop website payment (alipay.trade.page.pay) ----
export interface AlipayPagePayParams {
  /** Merchant order number; must be unique */
  outTradeNo: string
  /** Order total amount in yuan, precise to two decimals */
  totalAmount: string
  /** Order title */
  subject: string
  /** Product code; fixed to FAST_INSTANT_TRADE_PAY for desktop website payment */
  productCode?: string
  /** Order description */
  body?: string
  /** Absolute timeout, format yyyy-MM-dd HH:mm:ss */
  timeExpire?: string
  /** Order relative timeout, range 1m~15d */
  timeoutExpress?: string
  /** Main goods type: 0 - virtual, 1 - physical */
  goodsType?: '0' | '1'
  /** Passback params, returned as-is in async notifications */
  passbackParams?: string
  /** Sync redirect URL after payment completes */
  returnUrl?: string
  /** Async notify URL */
  notifyUrl?: string
  /** Extended info */
  extendParams?: Record<string, string>
  /** Merchant store ID */
  storeId?: string
  /** Whether to trigger real-name verification */
  qrPayMode?: string
  /** QR-code payment mode */
  qrcodeWidth?: string
}

export interface AlipayPagePayResult {
  /** HTML form string returned by Alipay */
  formHtml: string
}

// ---- Mobile website payment (alipay.trade.wap.pay) ----
export interface AlipayWapPayParams {
  /** Merchant order number; must be unique */
  outTradeNo: string
  /** Order total amount in yuan, precise to two decimals */
  totalAmount: string
  /** Order title */
  subject: string
  /** Product code; fixed to QUICK_WAP_WAY for mobile website payment */
  productCode?: string
  /** Order description */
  body?: string
  /** Absolute timeout, format yyyy-MM-dd HH:mm:ss */
  timeExpire?: string
  /** Order relative timeout, range 1m~15d */
  timeoutExpress?: string
  /** Passback params, returned as-is in async notifications */
  passbackParams?: string
  /** Merchant page URL to return to when the user quits midway */
  quitUrl?: string
  /** Sync redirect URL after payment completes */
  returnUrl?: string
  /** Async notify URL */
  notifyUrl?: string
}

export interface AlipayWapPayResult {
  /** HTML form string returned by Alipay */
  formHtml: string
}

// ---- Trade query (alipay.trade.query) ----
export interface AlipayQueryParams {
  outTradeNo?: string
  tradeNo?: string
}

export interface AlipayQueryResult {
  /** Alipay trade number */
  tradeNo: string
  /** Merchant order number */
  outTradeNo: string
  /** Buyer Alipay account */
  buyerLogonId: string
  /** Trade status */
  tradeStatus: TradeStatus
  /** Order amount of the trade */
  totalAmount: string
  /** Receipt amount */
  receiptAmount: string
  /** Buyer paid amount */
  buyerPayAmount: string
  /** Trade creation time */
  sendPayDate: string
  /** Trade payment time */
  gmtPayment: string | null
  /** Trade close time */
  gmtClose: string | null
  /** Refund amount */
  refundAmount: string
  /** Goods description */
  subject: string
  /** Passback params provided by the merchant */
  passbackParams: string | null
  /** Payment instrument for this trade */
  fundChannel: string | null
}

// ---- Trade refund (alipay.trade.refund) ----
export interface AlipayRefundParams {
  outTradeNo?: string
  tradeNo?: string
  refundAmount: string
  refundReason?: string
  outRequestNo?: string
  refundCurrency?: string
}

export interface AlipayRefundResult {
  /** Alipay trade number */
  tradeNo: string
  /** Merchant order number */
  outTradeNo: string
  /** Buyer Alipay account */
  buyerLogonId: string
  /** Refund amount requested this time */
  refundAmount: string
  /** Fund change detail */
  fundChange: string
  /** Refund time */
  gmtRefundPay: string
  /** Refund amount (per channel) */
  refundDetailItemList: Array<{
    contributionType: string
    amount: string
  }> | null
}

// ---- Trade close (alipay.trade.close) ----
export interface AlipayCloseParams {
  outTradeNo?: string
  tradeNo?: string
}

export interface AlipayCloseResult {
  /** Alipay trade number */
  tradeNo: string
  /** Merchant order number */
  outTradeNo: string
}

// ---- Refund query (alipay.trade.fastpay.refund.query) ----
export interface AlipayRefundQueryParams {
  outTradeNo?: string
  tradeNo?: string
  outRequestNo: string
}

export interface AlipayRefundQueryResult {
  /** Alipay trade number */
  tradeNo: string
  /** Merchant order number */
  outTradeNo: string
  /** Refund amount */
  refundAmount: string
  /** Refund status */
  refundStatus: string
  /** Refund request number */
  outRequestNo: string
  /** Refund reason */
  refundReason: string
}

// ---- Async notifications ----
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

// ---- Common ----
export type TradeStatus =
  | 'WAIT_BUYER_PAY'
  | 'TRADE_CLOSED'
  | 'TRADE_SUCCESS'
  | 'TRADE_FINISHED'

export type AlipayKeyType = 'PKCS1' | 'PKCS8'

export interface AlipayClientOptions {
  /** App ID */
  appId: string
  /** App private key (Node.js uses PKCS#1 format) */
  privateKey: string
  /** Alipay public key */
  alipayPublicKey: string
  /** Sign type, default RSA2 */
  signType?: AlipaySdkSignType
  /** Gateway URL; use the sandbox gateway for sandbox */
  gateway?: string
  /** Async notify URL */
  notifyUrl?: string
  /** Sync return URL */
  returnUrl?: string
  /** Key type, default PKCS1 (Node.js uses PKCS1) */
  keyType?: AlipayKeyType
  /** Request timeout, default 5000ms */
  timeout?: number
}

/** Desktop website payment config */
export interface AlipayPagePayConfig {
  /** Merchant order number */
  outTradeNo: string
  /** Order total amount in yuan */
  totalAmount: string
  /** Order title */
  subject: string
  /** Order description */
  body?: string
  /** Passback params */
  passbackParams?: string
}

/** Mobile website payment config */
export interface AlipayWapPayConfig {
  /** Merchant order number */
  outTradeNo: string
  /** Order total amount in yuan */
  totalAmount: string
  /** Order title */
  subject: string
  /** Order description */
  body?: string
  /** Passback params */
  passbackParams?: string
  /** Merchant page URL to return to when the user quits midway (required for wap pay) */
  quitUrl?: string
}