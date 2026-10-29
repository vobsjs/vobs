/**
 * Unwraps Alipay open API responses and checks business errors.
 *
 * A gateway response (HTTP 200) does not mean business success: on business failure
 * the response body carries code != '10000' plus sub_code/sub_msg, which must be
 * checked explicitly — otherwise failure results get mapped as success (all fields undefined).
 */
export class AlipayApiError extends Error {
  readonly code: string
  readonly subCode?: string
  readonly subMsg?: string

  constructor(apiName: string, code: string, subCode: string | undefined, subMsg: string | undefined, msg: string | undefined) {
    super(`Alipay API ${apiName} call failed: ${subMsg ?? msg ?? 'unknown error'} (code=${code}${subCode ? `, sub_code=${subCode}` : ''})`)
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
 * Extracts the business response body from the gateway response; throws AlipayApiError when code !== '10000'.
 */
export function unwrapResponse(raw: unknown, apiName: string): Record<string, any> {
  const outer = raw as Record<string, any> | null | undefined
  const body = (outer && outer[toResponseKey(apiName)]) ?? outer
  if (!body || typeof body !== 'object') {
    throw new AlipayApiError(apiName, 'INVALID_RESPONSE', undefined, undefined, 'invalid response body format')
  }
  if (body.code !== '10000') {
    throw new AlipayApiError(apiName, body.code, body.sub_code, body.sub_msg, body.msg)
  }
  return body
}
