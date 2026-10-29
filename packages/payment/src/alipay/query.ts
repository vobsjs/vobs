import type { AlipayClient } from './client'
import { unwrapResponse } from './response'
import type { AlipayQueryParams, AlipayQueryResult, TradeStatus } from './types'

/**
 * Trade query (alipay.trade.query)
 *
 * Queries the Alipay trade status to confirm the payment result.
 * Call this API as a fallback when no async notification is received.
 */
export function createQuery(client: AlipayClient) {
  return {
    /**
     * Query the trade status
     * @param params query params (pass at least one of outTradeNo and tradeNo)
     * @throws {AlipayApiError} when the business call fails (e.g. ACQ.TRADE_NOT_EXIST)
     */
    async query(params: AlipayQueryParams): Promise<AlipayQueryResult> {
      const alipayResponse = unwrapResponse(
        await client.sdk.exec('alipay.trade.query', {
          bizContent: params
        }),
        'alipay.trade.query'
      )

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
     * Check whether a trade was paid successfully
     * Only TRADE_SUCCESS or TRADE_FINISHED means the payment succeeded
     */
    isSuccessful(status: TradeStatus): boolean {
      return status === 'TRADE_SUCCESS' || status === 'TRADE_FINISHED'
    }
  }
}