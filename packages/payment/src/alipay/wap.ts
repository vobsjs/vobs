import type { AlipayClient } from './client'
import type { AlipayWapPayConfig, AlipayWapPayParams, AlipayWapPayResult } from './types'

/**
 * Mobile website payment (alipay.trade.wap.pay)
 *
 * Launches the Alipay cashier inside a mobile browser; generates form HTML for the
 * frontend to submit and redirect.
 *
 * ⚠️ Must use pageExecute(); never use exec().
 * ⚠️ The return value is an HTML form string; the frontend must render the form and auto-submit it.
 * ⚠️ Treat the payment result as authoritative only via async notification or the query API; never rely on the sync redirect.
 */
export function createWapPay(client: AlipayClient) {
  return {
    /**
     * Initiate a mobile website payment
     * @param config payment config
     * @returns payment form HTML
     */
    async pay(config: AlipayWapPayConfig): Promise<AlipayWapPayResult> {
      const { outTradeNo, totalAmount, subject, body, passbackParams, quitUrl } = config

      const bizParams: AlipayWapPayParams = {
        outTradeNo,
        totalAmount,
        subject,
        productCode: 'QUICK_WAP_WAY',
        body,
        passbackParams,
        quitUrl,
        returnUrl: client.config.returnUrl,
        notifyUrl: client.config.notifyUrl
      }

      const formHtml = client.sdk.pageExecute(
        'alipay.trade.wap.pay',
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
