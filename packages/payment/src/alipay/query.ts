import type { AlipayClient } from './client'
import type { AlipayQueryParams, AlipayQueryResult, TradeStatus } from './types'

/**
 * 交易查询 (alipay.trade.query)
 *
 * 查询支付宝交易状态，用于确认支付结果。
 * 当异步通知未收到时，应主动调用此接口兜底。
 */
export function createQuery(client: AlipayClient) {
  return {
    /**
     * 查询交易状态
     * @param params 查询参数（outTradeNo 和 tradeNo 至少传一个）
     */
    async query(params: AlipayQueryParams): Promise<AlipayQueryResult> {
      const result = await client.sdk.exec('alipay.trade.query', {
        bizContent: params
      })

      const response = result as Record<string, any>
      const alipayResponse = response.alipay_trade_query_response ?? response

      return {
        tradeNo: alipayResponse.trade_no,
        outTradeNo: alipayResponse.out_trade_no,
        buyerLogonId: alipayResponse.buyer_logon_id,
        tradeStatus: alipayResponse.trade_status as TradeStatus,
        totalAmount: alipayResponse.total_amount,
        receiptAmount: alipayResponse.receipt_amount ?? '0.00',
        buyerPayAmount: alipayResponse.buyer_pay_amount ?? '0.00',
        sendPayDate: alipayResponse.send_pay_date ?? '',
        gmtPayment: alipayResponse.gmt_payment ?? null,
        gmtClose: alipayResponse.gmt_close ?? null,
        refundAmount: alipayResponse.refund_amount ?? '0.00',
        subject: alipayResponse.subject ?? '',
        passbackParams: alipayResponse.passback_params ?? null,
        fundChannel: alipayResponse.fund_channel ?? null
      }
    },

    /**
     * 判断交易是否支付成功
     * 只有 TRADE_SUCCESS 或 TRADE_FINISHED 才表示支付成功
     */
    isSuccessful(status: TradeStatus): boolean {
      return status === 'TRADE_SUCCESS' || status === 'TRADE_FINISHED'
    }
  }
}