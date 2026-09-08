import type { AlipayClient } from './client'
import type {
  AlipayRefundParams,
  AlipayRefundResult,
  AlipayRefundQueryParams,
  AlipayRefundQueryResult,
  AlipayCloseParams,
  AlipayCloseResult
} from './types'

/**
 * 退款与交易关闭
 *
 * 包含退款、退款查询、交易关闭的完整退款生命周期管理。
 */
export function createRefund(client: AlipayClient) {
  return {
    /**
     * 交易退款 (alipay.trade.refund)
     * 交易发生后 12 个月内可退款，退款资金原路返回。
     */
    async refund(params: AlipayRefundParams): Promise<AlipayRefundResult> {
      const result = await client.sdk.exec('alipay.trade.refund', {
        bizContent: params
      })

      const response = result as Record<string, any>
      const alipayResponse = response.alipay_trade_refund_response ?? response

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
     * 退款查询 (alipay.trade.fastpay.refund.query)
     * 查询退款状态，确认退款是否成功。
     */
    async queryRefund(params: AlipayRefundQueryParams): Promise<AlipayRefundQueryResult> {
      const result = await client.sdk.exec('alipay.trade.fastpay.refund.query', {
        bizContent: params
      })

      const response = result as Record<string, any>
      const alipayResponse = response.alipay_trade_fastpay_refund_query_response ?? response

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
     * 关闭交易 (alipay.trade.close)
     * 关闭未支付的订单。
     */
    async close(params: AlipayCloseParams): Promise<AlipayCloseResult> {
      const result = await client.sdk.exec('alipay.trade.close', {
        bizContent: params
      })

      const response = result as Record<string, any>
      const alipayResponse = response.alipay_trade_close_response ?? response

      return {
        tradeNo: alipayResponse.trade_no,
        outTradeNo: alipayResponse.out_trade_no
      }
    }
  }
}