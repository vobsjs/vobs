import type { WechatClient } from './client'
import { unwrapV3 } from './response'
import type {
  WechatRefundParams,
  WechatRefundQueryParams,
  WechatRefundResult,
  WechatRefundStatus
} from './types'

/**
 * 微信退款（APIv3）
 *
 * 覆盖申请退款与退款状态查询。
 * ⚠️ 退款结果以异步通知（refund.irqevent）或 queryRefund 为准。
 */
export function createRefund(client: WechatClient) {
  return {
    /**
     * 申请退款（POST /v3/refund/domestic/refunds）
     * @param params 退款参数（outTradeNo 与 transactionId 二选一）
     * @throws {WechatApiError} 参数错误、余额不足、订单不可退等失败
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
      // 移除 undefined 字段
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
     * 查询退款（GET /v3/refund/domestic/refunds/{out_refund_no | refund_id}）
     * @throws {WechatApiError} 退款单不存在等失败
     */
    async queryRefund(params: WechatRefundQueryParams): Promise<WechatRefundResult> {
      const id = params.refundId ?? params.outRefundNo
      if (!id) {
        throw new Error('WechatClient: queryRefund 需要 outRefundNo 或 refundId')
      }
      const { data } = await unwrapV3(
        client.sdk.client.request(`/v3/refund/domestic/refunds/${encodeURIComponent(id)}`, 'GET')
      )
      return mapRefund(data)
    }
  }
}

/** snake_case 响应映射 */
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
