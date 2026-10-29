import type { AlipayClient } from './client'
import { unwrapResponse } from './response'
import type {
  AlipayRefundParams,
  AlipayRefundResult,
  AlipayRefundQueryParams,
  AlipayRefundQueryResult,
  AlipayCloseParams,
  AlipayCloseResult
} from './types'

/**
 * Refund and trade close
 *
 * Full refund lifecycle management covering refund, refund query, and trade close.
 */
export function createRefund(client: AlipayClient) {
  return {
    /**
     * Trade refund (alipay.trade.refund)
     * Refundable within 12 months of the trade; funds are returned via the original payment channel.
     * @throws {AlipayApiError} when the business call fails
     */
    async refund(params: AlipayRefundParams): Promise<AlipayRefundResult> {
      const alipayResponse = unwrapResponse(
        await client.sdk.exec('alipay.trade.refund', {
          bizContent: params
        }),
        'alipay.trade.refund'
      )

      return {
        tradeNo: alipayResponse.trade_no,
        outTradeNo: alipayResponse.out_trade_no,
        buyerLogonId: alipayResponse.buyer_logon_id,
        refundAmount: alipayResponse.refund_fee,
        fundChange: alipayResponse.fund_change ?? 'N',
        gmtRefundPay: alipayResponse.gmt_refund_pay ?? '',
        refundDetailItemList: alipayResponse.refund_detail_item_list ?? null
      }
    },

    /**
     * Refund query (alipay.trade.fastpay.refund.query)
     * Queries the refund status to confirm whether the refund succeeded.
     * @throws {AlipayApiError} when the business call fails
     */
    async queryRefund(params: AlipayRefundQueryParams): Promise<AlipayRefundQueryResult> {
      const alipayResponse = unwrapResponse(
        await client.sdk.exec('alipay.trade.fastpay.refund.query', {
          bizContent: params
        }),
        'alipay.trade.fastpay.refund.query'
      )

      return {
        tradeNo: alipayResponse.trade_no,
        outTradeNo: alipayResponse.out_trade_no,
        refundAmount: alipayResponse.refund_amount,
        refundStatus: alipayResponse.refund_status,
        outRequestNo: alipayResponse.out_request_no,
        refundReason: alipayResponse.refund_reason ?? ''
      }
    },

    /**
     * Close trade (alipay.trade.close)
     * Closes an unpaid order.
     * @throws {AlipayApiError} when the business call fails
     */
    async close(params: AlipayCloseParams): Promise<AlipayCloseResult> {
      const alipayResponse = unwrapResponse(
        await client.sdk.exec('alipay.trade.close', {
          bizContent: params
        }),
        'alipay.trade.close'
      )

      return {
        tradeNo: alipayResponse.trade_no,
        outTradeNo: alipayResponse.out_trade_no
      }
    }
  }
}