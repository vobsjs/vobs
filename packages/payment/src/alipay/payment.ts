import type { AlipayClient } from './client'
import type {
  AlipayPagePayConfig,
  AlipayPagePayParams,
  AlipayPagePayResult
} from './types'

/**
 * Desktop website payment (alipay.trade.page.pay)
 *
 * Generates the Alipay payment form HTML; the frontend renders it and the form
 * auto-submits to redirect to the Alipay cashier.
 *
 * ⚠️ Must use pageExecute(); never use exec().
 * ⚠️ The return value is an HTML form string, not a URL; the frontend must render the form and auto-submit it.
 * ⚠️ Treat the payment result as authoritative only via async notification or the query API; never rely on the sync redirect.
 */
export function createPagePay(client: AlipayClient) {
  return {
    /**
     * Initiate a desktop website payment
     * @param config payment config
     * @returns payment form HTML
     */
    async pay(config: AlipayPagePayConfig): Promise<AlipayPagePayResult> {
      const { outTradeNo, totalAmount, subject, body, passbackParams } = config

      const bizParams: AlipayPagePayParams = {
        outTradeNo,
        totalAmount,
        subject,
        productCode: 'FAST_INSTANT_TRADE_PAY',
        body,
        passbackParams,
        returnUrl: client.config.returnUrl,
        notifyUrl: client.config.notifyUrl
      }

      // Use pageExecute() to generate the POST form HTML
      // Note: must use pageExecute, not exec()
      const formHtml = client.sdk.pageExecute(
        'alipay.trade.page.pay',
        'POST',
        { bizContent: sanitizeParams(bizParams) }
      )

      return { formHtml }
    }
  }
}

/** Strip undefined fields */
function sanitizeParams<T extends Record<string, any>>(params: T): Record<string, any> {
  const result: Record<string, any> = {}
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      result[key] = value
    }
  }
  return result
}