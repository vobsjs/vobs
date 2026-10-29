import type { WechatClient } from './client'
import { unwrapV3 } from './response'
import type {
  WechatRefundParams,
  WechatRefundQueryParams,
  WechatRefundResult,
  WechatRefundStatus
} from './types'

/**
 * WeChat refunds (APIv3)
 *
 * Covers refund requests and refund status queries.
 * ⚠️ Treat the refund result as authoritative only via async notification (refund.irqevent) or queryRefund.
 */
export function createRefund(client: WechatClient) {
  return {
    /**
     * Request a refund (POST /v3/refund/domestic/refunds)
     * @param params refund params (pass either outTradeNo or transactionId)
     * @throws {WechatApiError} on failures such as invalid params, insufficient balance, or non-refundable order
     */
    async refund(params: WechatRefundParams): Promise<WechatRefundResult> {
      const body: Record<string, any> = {
        out_trade_no: params.outTradeNo,
        transaction_id: params.transactionId,
        out_refund_no: params.outRefundNo,
        reason: params.reason,
        notify_url: params.notifyUrl ?? client.config.notifyUrl,
        funds_account: params.fundsAccount,
        amount: {
          refund: params.amount.refund,
          total: params.amount.total,
          currency: params.amount.currency ?? 'CNY'
        }
      }
      // Strip undefined fields
      for (const key of Object.keys(body)) {
        if (body[key] === undefined) delete body[key]
      }
      for (const key of Object.keys(body.amount)) {
        if ((body.amount as any)[key] === undefined) delete (body.amount as any)[key]
      }

      const { data } = await unwrapV3(client.sdk.v3.refund.domestic.refunds.post(body))
      return mapRefund(data)
    },

    /**
     * Query a refund (GET /v3/refund/domestic/refunds/{out_refund_no | refund_id})
     * @throws {WechatApiError} on failures such as a nonexistent refund order
     */
    async queryRefund(params: WechatRefundQueryParams): Promise<WechatRefundResult> {
      const id = params.refundId ?? params.outRefundNo
      if (!id) {
        throw new Error('WechatClient: queryRefund requires outRefundNo or refundId')
      }
      const { data } = await unwrapV3(
        client.sdk.client.request(`/v3/refund/domestic/refunds/${encodeURIComponent(id)}`, 'GET')
      )
      return mapRefund(data)
    }
  }
}

/** snake_case response mapping */
function mapRefund(data: Record<string, any>): WechatRefundResult {
  return {
    refundId: data.refund_id,
    outRefundNo: data.out_refund_no,
    outTradeNo: data.out_trade_no,
    transactionId: data.transaction_id,
    status: data.status as WechatRefundStatus,
    refundAmount: data.amount?.refund,
    total: data.amount?.total,
    userReceivedAmount: data.amount?.user_received_amount,
    successTime: data.success_time,
    reason: data.reason
  }
}
