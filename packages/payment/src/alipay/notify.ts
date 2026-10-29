import type { AlipayClient } from './client'
import type { AlipayNotifyParams, TradeStatus } from './types'

/**
 * Async notification handling
 *
 * Alipay sends async notifications via POST to notify_url on trade status changes.
 * Key handling rules:
 * 1. Verify the signature first upon receiving a notification
 * 2. After verification, validate key business fields (app_id, out_trade_no, total_amount)
 * 3. Return the string "success" after successful processing (exactly these 7 characters)
 * 4. Handle idempotently and filter out duplicate notifications
 */
export function createNotifyHandler(client: AlipayClient) {
  return {
    /**
     * Verify the signature of an async notification
     * @param params notification params (raw params POSTed by Alipay)
     * @param raw verify against the raw payload (recommended; supported in v4.15+ to avoid verify failures caused by encodeURIComponent differences)
     * @returns whether the signature check passes
     */
    verify(params: Record<string, any>, raw = false): boolean {
      try {
        return client.sdk.checkNotifySign(params, raw)
      } catch {
        return false
      }
    },

    /**
     * Validate the business fields of an async notification
     *
     * Signature verification only proves the notification comes from Alipay; it does not
     * guarantee the notification matches an order in your system. So `expected` has two
     * **mandatory** fields: `outTradeNo` (order number) and `totalAmount` (order amount in yuan).
     *
     * Why mandatory rather than optional "compare if present": with optional chaining
     * (`expected?.outTradeNo`), `validate(params)` would only check app_id and return
     * `valid: true` — any amount, any order number would pass. A subtler trap: when
     * `expected.totalAmount` is an **empty string**, a falsy check short-circuits and the
     * whole amount comparison is **skipped**. Any missing field ends with `valid: false`
     * plus explicit errors (fail-closed) — text warnings cannot stop an API shape where
     * "omitting means passing"; only types can.
     * @param params notification params
     * @param expected merchant-side expected values: outTradeNo (order number), totalAmount (order amount in yuan)
     */
    validate(
      params: AlipayNotifyParams,
      expected: { outTradeNo: string; totalAmount: string }
    ): NotifyValidationResult {
      const errors: string[] = []

      // Validate app_id
      if (params.appId !== client.config.appId) {
        errors.push(`app_id mismatch: expected ${client.config.appId}, got ${params.appId}`)
      }

      // Validate out_trade_no against the merchant order
      if (!expected?.outTradeNo) {
        errors.push('Missing merchant-side expected order number expected.outTradeNo — not compared against own order, rejecting')
      } else if (params.outTradeNo !== expected.outTradeNo) {
        errors.push(`out_trade_no mismatch: expected ${expected.outTradeNo}, got ${params.outTradeNo}`)
      }

      // Validate total_amount against the order amount (server-side strings with two decimals; compare numerically)
      // Note: use === undefined/null instead of truthiness — an empty string must error out, not be short-circuited
      if (expected?.totalAmount === undefined || expected.totalAmount === null || expected.totalAmount === '') {
        errors.push('Missing merchant-side expected amount expected.totalAmount — not compared against own order, rejecting')
      } else if (Number(params.totalAmount) !== Number(expected.totalAmount)) {
        errors.push(`total_amount mismatch: expected ${expected.totalAmount}, got ${params.totalAmount}`)
      }

      // Validate trade_status
      const validStatuses: TradeStatus[] = ['TRADE_SUCCESS', 'TRADE_FINISHED']
      if (!validStatuses.includes(params.tradeStatus as TradeStatus)) {
        errors.push(`trade_status is not final: ${params.tradeStatus}`)
      }

      return {
        valid: errors.length === 0,
        errors
      }
    },

    /**
     * Build the success response for an Alipay async notification
     * Must return the string "success" after processing
     */
    successResponse(): string {
      return 'success'
    },

    /**
     * Build the failure response for an Alipay async notification
     * Returning an empty string or anything other than "success" makes Alipay retry
     */
    failResponse(): string {
      return 'fail'
    }
  }
}

export interface NotifyValidationResult {
  valid: boolean
  errors: string[]
}