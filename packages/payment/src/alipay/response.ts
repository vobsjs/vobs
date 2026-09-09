/**
 * 支付宝开放接口响应解包与业务错误检查。
 *
 * 网关应答（HTTP 200）不代表业务成功：业务失败时响应体内
 * code != '10000' 并携带 sub_code/sub_msg，必须显式检查，
 * 否则会把失败结果当成功映射（字段全部 undefined）。
 */
export class AlipayApiError extends Error {
  readonly code: string
  readonly subCode?: string
  readonly subMsg?: string

  constructor(apiName: string, code: string, subCode: string | undefined, subMsg: string | undefined, msg: string | undefined) {
    super(`支付宝接口 ${apiName} 调用失败: ${subMsg ?? msg ?? '未知错误'} (code=${code}${subCode ? `, sub_code=${subCode}` : ''})`)
    this.name = 'AlipayApiError'
    this.code = code
    this.subCode = subCode
    this.subMsg = subMsg
  }
}

/** alipay.trade.page.pay -> alipay_trade_page_pay_response */
function toResponseKey(apiName: string): string {
  return `${apiName.replace(/\./g, '_')}_response`
}

/**
 * 从网关应答中取出业务响应体，code !== '10000' 时抛出 AlipayApiError。
 */
export function unwrapResponse(raw: unknown, apiName: string): Record<string, any> {
  const outer = raw as Record<string, any> | null | undefined
  const body = (outer && outer[toResponseKey(apiName)]) ?? outer
  if (!body || typeof body !== 'object') {
    throw new AlipayApiError(apiName, 'INVALID_RESPONSE', undefined, undefined, '响应体格式异常')
  }
  if (body.code !== '10000') {
    throw new AlipayApiError(apiName, body.code, body.sub_code, body.sub_msg, body.msg)
  }
  return body
}
