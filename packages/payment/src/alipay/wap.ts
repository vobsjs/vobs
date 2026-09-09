import type { AlipayClient } from './client'
import type { AlipayWapPayConfig, AlipayWapPayParams, AlipayWapPayResult } from './types'

/**
 * 手机网站支付 (alipay.trade.wap.pay)
 *
 * 移动端浏览器内拉起支付宝收银台，生成表单 HTML 由前端提交跳转。
 *
 * ⚠️ 必须使用 pageExecute() 方法，禁止使用 exec()。
 * ⚠️ 返回值为 HTML 表单字符串，前端必须渲染 form 并自动提交。
 * ⚠️ 支付结果以异步通知或查询接口为准，不可依赖同步跳转。
 */
export function createWapPay(client: AlipayClient) {
  return {
    /**
     * 发起手机网站支付
     * @param config 支付配置
     * @returns 支付表单 HTML
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
