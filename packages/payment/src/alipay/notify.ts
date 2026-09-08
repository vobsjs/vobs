import type { AlipayClient } from './client'
import type { AlipayNotifyParams, TradeStatus } from './types'

/**
 * 异步通知处理
 *
 * 支付宝在交易状态变更时，通过 POST 请求 notify_url 发送异步通知。
 * 处理要点：
 * 1. 收到通知后必须先验签
 * 2. 验签后校验关键业务字段（app_id、out_trade_no、total_amount）
 * 3. 处理成功后返回字符串 "success"（仅此 7 个字符）
 * 4. 需做幂等处理，过滤重复通知
 */
export function createNotifyHandler(client: AlipayClient) {
  return {
    /**
     * 验签异步通知
     * @param params 异步通知参数（支付宝 POST 过来的原始参数）
     * @returns 验签是否通过
     */
    verify(params: Record<string, any>): boolean {
      try {
        return client.sdk.checkNotifySign(params)
      } catch {
        return false
      }
    },

    /**
     * 校验异步通知的业务字段
     * 确保通知中的关键信息与商户自身信息一致
     */
    validate(params: AlipayNotifyParams): NotifyValidationResult {
      const errors: string[] = []

      // 校验 app_id
      if (params.appId !== client.config.appId) {
        errors.push(`app_id 不匹配: 期望 ${client.config.appId}，收到 ${params.appId}`)
      }

      // 校验 trade_status
      const validStatuses: TradeStatus[] = ['TRADE_SUCCESS', 'TRADE_FINISHED']
      if (!validStatuses.includes(params.tradeStatus as TradeStatus)) {
        errors.push(`trade_status 非终态: ${params.tradeStatus}`)
      }

      return {
        valid: errors.length === 0,
        errors
      }
    },

    /**
     * 生成支付宝异步通知的成功响应
     * 处理完成后必须返回字符串 "success"
     */
    successResponse(): string {
      return 'success'
    },

    /**
     * 生成支付宝异步通知的失败响应
     * 返回空字符串或非 success 内容，支付宝会重试通知
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