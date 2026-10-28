import { Aes, Formatter, Rsa } from 'wechatpay-axios-plugin'
import type { WechatClient } from './client'
import type {
  WechatNotifyHeaders,
  WechatNotifyRefund,
  WechatNotifyResource,
  WechatNotifyTransaction
} from './types'

/**
 * WeChat Pay async notification handling (APIv3)
 *
 * Full flow:
 * 1. verify()   — verify the message signature with certs (platform certificates / WeChat Pay
 *                 public keys looked up by Wechatpay-Serial)
 * 2. decrypt()  — AES-256-GCM decrypt resource with apiv3Key to get the business data
 * 3. validate() — compare against merchant-side expected values (order number / amount) to
 *                 guard against mismatched payments
 * 4. After handling the business, answer WeChat with successResponse()/failResponse()
 */
export function createNotifyHandler(client: WechatClient) {
  return {
    /**
     * Verify the async notification signature
     * @param headers the Wechatpay-* HTTP headers of the WeChat Pay callback
     * @param body the raw request body string (must be the unparsed original text; never
     *   JSON.parse it and re-serialize)
     * @returns whether signature verification passed
     */
    verify(headers: WechatNotifyHeaders, body: string): boolean {
      const publicKey = client.config.options.certs[headers.serial]
      if (!publicKey) {
        return false
      }
      try {
        const message = Formatter.response(headers.timestamp, headers.nonce, body)
        return Rsa.verify(message, headers.signature, publicKey)
      } catch {
        return false
      }
    },

    /**
     * Decrypt the notification resource field (AES-256-GCM, apiv3Key)
     * @param resource the resource field in the callback JSON
     */
    decrypt<T extends WechatNotifyTransaction | WechatNotifyRefund = WechatNotifyTransaction>(
      resource: WechatNotifyResource
    ): T {
      const plaintext = Aes.AesGcm.decrypt(
        resource.ciphertext,
        client.config.apiv3Key,
        resource.nonce,
        resource.associatedData ?? ''
      )
      return JSON.parse(plaintext) as T
    },

    /**
     * Check the decrypted notification against the merchant-side order.
     * Signature verification only proves the notification comes from WeChat Pay; it does not
     * prove it matches your order.
     *
     * Both entries of `expected` are **required**: `outTradeNo` (order number) and `total`
     * (order amount in cents).
     *
     * Why required instead of an optional "compare when present": with optional chaining
     * (`expected?.outTradeNo`), the laziest call `validate(payload)` would return
     * `valid: true` directly — dressing up "only verified the merchant ID" as "validation
     * passed". An attacker merely needs to match mchid (which is public) to push through any
     * order number with any amount. Missing either entry ends with `valid: false` plus
     * explicit errors (fail closed) — a text warning cannot stop an API shape where
     * "omitting means passing"; only types can.
     */
    validate(
      payload: WechatNotifyTransaction | WechatNotifyRefund,
      expected: { outTradeNo: string; total: number }
    ): { valid: boolean; errors: string[] } {
      const errors: string[] = []

      if (payload.mchid !== client.config.mchid) {
        errors.push(`mchid mismatch: expected ${client.config.mchid}, got ${payload.mchid}`)
      }

      if (!expected?.outTradeNo) {
        errors.push('Missing merchant-side expected order number expected.outTradeNo — not compared against your own order, rejecting')
      } else if (payload.outTradeNo !== expected.outTradeNo) {
        errors.push(`out_trade_no mismatch: expected ${expected.outTradeNo}, got ${payload.outTradeNo}`)
      }

      if (expected?.total === undefined || expected.total === null) {
        errors.push('Missing merchant-side expected amount expected.total — not compared against your own order, rejecting')
      } else if (payload.amount?.total !== expected.total) {
        errors.push(`amount.total mismatch: expected ${expected.total}, got ${payload.amount?.total}`)
      }

      return { valid: errors.length === 0, errors }
    },

    /** Success response for notification handling (HTTP 200/201, body exactly {"code":"SUCCESS"}) */
    successResponse(): { code: 'SUCCESS'; message?: undefined } {
      return { code: 'SUCCESS' }
    },

    /** Failure response for notification handling (WeChat retries the notification at decaying intervals) */
    failResponse(message?: string): { code: 'FAIL'; message: string } {
      return { code: 'FAIL', message: message ?? 'Processing failed' }
    }
  }
}
