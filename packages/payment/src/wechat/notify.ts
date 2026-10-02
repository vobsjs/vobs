import { Aes, Formatter, Rsa } from 'wechatpay-axios-plugin'
import type { WechatClient } from './client'
import type {
  WechatNotifyHeaders,
  WechatNotifyRefund,
  WechatNotifyResource,
  WechatNotifyTransaction
} from './types'

/**
 * 微信支付异步通知处理（APIv3）
 *
 * 完整流程：
 * 1. verify()   — 用 certs（按 Wechatpay-Serial 查找平台证书/微信支付公钥）验证报文签名
 * 2. decrypt()  — 用 apiv3Key 做 AES-256-GCM 解密 resource 得到业务数据
 * 3. validate() — 比对商户侧期望值（订单号 / 金额），防错配
 * 4. 处理业务后用 successResponse()/failResponse() 应答微信
 */
export function createNotifyHandler(client: WechatClient) {
  return {
    /**
     * 验签异步通知
     * @param headers 微信支付回调的 Wechatpay-* 系列 HTTP 头
     * @param body 原始请求体字符串（必须是未解析的原文，不可先 JSON.parse 再序列化）
     * @returns 验签是否通过
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
     * 解密通知 resource 字段（AES-256-GCM，apiv3Key）
     * @param resource 回调 JSON 中的 resource 字段
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
     * 校验解密后的通知与商户侧订单是否一致。
     * 验签只保证通知来自微信支付，不保证与你的订单一致。
     *
     * `expected` 是**必填**的两项：`outTradeNo` 订单号与 `total` 订单金额（分）。
     *
     * 为什么是必填而不是可选的"有就比对"：此前两个比对项都写成可选链
     * （`expected?.outTradeNo`、`expected?.total`），于是**最省事的调用姿势**
     * `validate(payload)` 直接返回 `valid: true` —— 把"只验了商户号"包装成"校验通过"，
     * 攻击者只要把 mchid 对上（那是公开的）就能让任意订单号/任意金额通过。
     * 同类形态在支付宝侧也一样（.artifacts/reports/payment.md 缺点 2）；README:108-127
     * 的文字警告拦不住这种"省略即通过"的 API 外形。
     * 现在缺任何一项都以 `valid: false` + 明确 errors 收场（失败关闭）。
     */
    validate(
      payload: WechatNotifyTransaction | WechatNotifyRefund,
      expected: { outTradeNo: string; total: number }
    ): { valid: boolean; errors: string[] } {
      const errors: string[] = []

      if (payload.mchid !== client.config.mchid) {
        errors.push(`mchid 不匹配: 期望 ${client.config.mchid}，收到 ${payload.mchid}`)
      }

      if (!expected?.outTradeNo) {
        errors.push('缺少商户侧期望订单号 expected.outTradeNo —— 未与自有订单比对，拒绝放行')
      } else if (payload.outTradeNo !== expected.outTradeNo) {
        errors.push(`out_trade_no 不匹配: 期望 ${expected.outTradeNo}，收到 ${payload.outTradeNo}`)
      }

      if (expected?.total === undefined || expected.total === null) {
        errors.push('缺少商户侧期望金额 expected.total —— 未与自有订单比对，拒绝放行')
      } else if (payload.amount?.total !== expected.total) {
        errors.push(`amount.total 不匹配: 期望 ${expected.total}，收到 ${payload.amount?.total}`)
      }

      return { valid: errors.length === 0, errors }
    },

    /** 通知处理成功应答（HTTP 200/201，body 恰为 {"code":"SUCCESS"}） */
    successResponse(): { code: 'SUCCESS'; message?: undefined } {
      return { code: 'SUCCESS' }
    },

    /** 通知处理失败应答（微信会按衰减频率重发通知） */
    failResponse(message?: string): { code: 'FAIL'; message: string } {
      return { code: 'FAIL', message: message ?? '处理失败' }
    }
  }
}
