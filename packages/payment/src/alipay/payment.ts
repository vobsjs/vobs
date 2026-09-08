import type { AlipayClient } from './client'
import type {
  AlipayPagePayConfig,
  AlipayPagePayParams,
  AlipayPagePayResult
} from './types'

/**
 * 电脑网站支付 (alipay.trade.page.pay)
 *
 * 生成支付宝支付表单 HTML，前端渲染后自动提交表单跳转至支付宝收银台。
 *
 * ⚠️ 必须使用 pageExecute() 方法，禁止使用 exec()。
 * ⚠️ 返回值为 HTML 表单字符串，不是 URL，前端必须渲染 form 并自动提交。
 * ⚠️ 支付结果以异步通知或查询接口为准，不可依赖同步跳转。
 */
export function createPagePay(client: AlipayClient) {
  return {
    /**
     * 发起电脑网站支付
     * @param config 支付配置
     * @returns 支付表单 HTML
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

      // 使用 pageExecute() 生成 POST 表单 HTML
      // 注意：必须使用 pageExecute，不能使用 exec()
      const formHtml = client.sdk.pageExecute(
        'alipay.trade.page.pay',
        'POST',
        { bizContent: sanitizeParams(bizParams) }
      )

      return { formHtml }
    }
  }
}

/** 移除 undefined 字段 */
function sanitizeParams<T extends Record<string, any>>(params: T): Record<string, any> {
  const result: Record<string, any> = {}
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      result[key] = value
    }
  }
  return result
}