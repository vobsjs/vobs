import { describe, expect, it, vi } from 'vitest'
import { AlipayConfig } from './config'
import { AlipayApiError, unwrapResponse } from './response'
import { createNotifyHandler } from './notify'
import { createQuery } from './query'
import { createRefund } from './refund'
import { createWapPay } from './wap'
import { alipayPlugin, ALIPAY_KEY } from './plugin'
import type { AlipayClient } from './client'
import type { AlipayClientOptions } from './types'
import type { VobsContext } from '@vobs/vobs'

function makeClient(sdkOverrides: Partial<AlipayClient['sdk']> = {}): AlipayClient {
  const sdk = {
    exec: vi.fn(),
    checkNotifySign: vi.fn(),
    pageExecute: vi.fn(),
    ...sdkOverrides
  }
  const config = new AlipayConfig({
    appId: '2021000000000000',
    privateKey: 'test-private-key',
    alipayPublicKey: 'test-public-key'
  })
  return { config, sdk } as unknown as AlipayClient
}

const baseNotify = {
  appId: '2021000000000000',
  outTradeNo: 'ORDER-1',
  totalAmount: '299.00',
  tradeStatus: 'TRADE_SUCCESS'
}

describe('alipay response unwrapping', () => {
  it('unwrapResponse 业务失败时抛出 AlipayApiError 并携带 sub_code', () => {
    try {
      unwrapResponse({
        alipay_trade_query_response: {
          code: '40004',
          msg: 'Business Failed',
          sub_code: 'ACQ.TRADE_NOT_EXIST',
          sub_msg: '交易不存在'
        }
      }, 'alipay.trade.query')
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(AlipayApiError)
      const apiError = error as AlipayApiError
      expect(apiError.code).toBe('40004')
      expect(apiError.subCode).toBe('ACQ.TRADE_NOT_EXIST')
      expect(apiError.message).toContain('ACQ.TRADE_NOT_EXIST')
    }
  })

  it('unwrapResponse 成功响应返回业务体', () => {
    const body = { code: '10000', msg: 'Success', trade_no: 'T-1' }
    expect(unwrapResponse({ alipay_trade_query_response: body }, 'alipay.trade.query')).toBe(body)
  })
})

describe('alipay query', () => {
  it('query 成功时映射 snake_case 响应字段', async () => {
    const client = makeClient()
    ;(client.sdk.exec as ReturnType<typeof vi.fn>).mockResolvedValue({
      alipay_trade_query_response: {
        code: '10000',
        msg: 'Success',
        trade_no: 'T-1',
        out_trade_no: 'ORDER-1',
        buyer_logon_id: '138****8000',
        trade_status: 'TRADE_SUCCESS',
        total_amount: '299.00',
        receipt_amount: '299.00',
        buyer_pay_amount: '289.00'
      }
    })

    const result = await createQuery(client).query({ outTradeNo: 'ORDER-1' })
    expect(result.tradeStatus).toBe('TRADE_SUCCESS')
    expect(result.totalAmount).toBe('299.00')
    expect(result.buyerPayAmount).toBe('289.00')
    expect(result.sendPayDate).toBe('')
    expect(result.gmtClose).toBeNull()
  })

  it('query 业务失败时抛出 AlipayApiError，不返回伪成功结果', async () => {
    const client = makeClient()
    ;(client.sdk.exec as ReturnType<typeof vi.fn>).mockResolvedValue({
      alipay_trade_query_response: {
        code: '40004',
        sub_code: 'ACQ.TRADE_NOT_EXIST',
        sub_msg: '交易不存在'
      }
    })

    await expect(createQuery(client).query({ outTradeNo: 'ORDER-404' }))
      .rejects.toThrow('ACQ.TRADE_NOT_EXIST')
  })
})

describe('alipay refund', () => {
  it('refund 成功时映射 refund_fee 并提供默认值', async () => {
    const client = makeClient()
    ;(client.sdk.exec as ReturnType<typeof vi.fn>).mockResolvedValue({
      alipay_trade_refund_response: {
        code: '10000',
        trade_no: 'T-1',
        out_trade_no: 'ORDER-1',
        refund_fee: '10.00',
        fund_change: 'Y'
      }
    })

    const result = await createRefund(client).refund({ outTradeNo: 'ORDER-1', refundAmount: '10.00' })
    expect(result.refundAmount).toBe('10.00')
    expect(result.fundChange).toBe('Y')
    expect(result.gmtRefundPay).toBe('')
    expect(result.refundDetailItemList).toBeNull()
  })

  it('close 业务失败时抛出 AlipayApiError', async () => {
    const client = makeClient()
    ;(client.sdk.exec as ReturnType<typeof vi.fn>).mockResolvedValue({
      alipay_trade_close_response: {
        code: '40004',
        sub_code: 'ACQ.TRADE_STATUS_ERROR',
        sub_msg: '交易状态不合法'
      }
    })

    await expect(createRefund(client).close({ outTradeNo: 'ORDER-1' }))
      .rejects.toBeInstanceOf(AlipayApiError)
  })
})

describe('alipay notify validation', () => {
  it('app_id 与配置一致且无期望值时通过', () => {
    const handler = createNotifyHandler(makeClient())
    expect(handler.validate(baseNotify as never).valid).toBe(true)
  })

  it('app_id 不匹配时报告错误', () => {
    const handler = createNotifyHandler(makeClient())
    const result = handler.validate({ ...baseNotify, appId: 'other-app' } as never)
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('app_id')
  })

  it('订单号与金额期望值不一致时报告错误', () => {
    const handler = createNotifyHandler(makeClient())
    const result = handler.validate(baseNotify as never, { outTradeNo: 'ORDER-2', totalAmount: '300.00' })
    expect(result.valid).toBe(false)
    expect(result.errors.some(error => error.includes('out_trade_no'))).toBe(true)
    expect(result.errors.some(error => error.includes('total_amount'))).toBe(true)
  })

  it('金额按数值比较，"299.0" 与 "299.00" 视为一致', () => {
    const handler = createNotifyHandler(makeClient())
    const result = handler.validate({ ...baseNotify, totalAmount: '299.0' } as never, { totalAmount: '299.00' })
    expect(result.valid).toBe(true)
  })

  it('非终态 trade_status 报告错误', () => {
    const handler = createNotifyHandler(makeClient())
    const result = handler.validate({ ...baseNotify, tradeStatus: 'WAIT_BUYER_PAY' } as never)
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('trade_status')
  })

  it('verify 透传 raw 参数，SDK 异常时返回 false', () => {
    const client = makeClient()
    ;(client.sdk.checkNotifySign as ReturnType<typeof vi.fn>).mockImplementation((_params: unknown, raw?: boolean) => {
      expect(raw).toBe(true)
      return true
    })
    const handler = createNotifyHandler(client)
    expect(handler.verify({ a: '1' }, true)).toBe(true)

    const broken = makeClient()
    ;(broken.sdk.checkNotifySign as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('bad key')
    })
    expect(createNotifyHandler(broken).verify({ a: '1' })).toBe(false)
  })
})

describe('alipay plugin lifecycle', () => {
  it('安装自建客户端并在卸载时销毁', () => {
    const provide = vi.fn()
    const plugin = alipayPlugin({
      config: { appId: '2021000000000000', privateKey: 'k', alipayPublicKey: 'p' } as AlipayClientOptions
    })
    const cleanup = plugin.install?.({ provide } as unknown as VobsContext)
    const client = provide.mock.calls[0]![1] as AlipayClient
    expect(provide).toHaveBeenCalledWith(ALIPAY_KEY, client)
    expect(typeof cleanup).toBe('function')
    cleanup!()
    expect(() => client.sdk).toThrow('客户端已销毁')
  })

  it('外部传入的客户端在卸载时不被销毁', () => {
    const client = makeClient()
    const provide = vi.fn()
    const plugin = alipayPlugin({ client })
    const cleanup = plugin.install?.({ provide } as unknown as VobsContext)
    expect(provide).toHaveBeenCalledWith(ALIPAY_KEY, client)
    expect(cleanup).toBeUndefined()
    expect(() => client.sdk).not.toThrow()
  })
})

describe('alipay wap pay', () => {
  it('wap.pay 使用 QUICK_WAP_WAY 产品码并透传 quit_url', async () => {
    const client = makeClient()
    ;(client.sdk.pageExecute as ReturnType<typeof vi.fn>).mockReturnValue('<form name="pay">wap</form>')

    const result = await createWapPay(client).pay({
      outTradeNo: 'ORDER-9',
      totalAmount: '1.00',
      subject: 'H5 会员',
      quitUrl: 'https://merchant.example.com/quit'
    })

    expect(result.formHtml).toBe('<form name="pay">wap</form>')
    const [apiName, , payload] = (client.sdk.pageExecute as ReturnType<typeof vi.fn>).mock.calls[0] as unknown as [string, string, Record<string, any>]
    expect(apiName).toBe('alipay.trade.wap.pay')
    expect(payload.bizContent.productCode).toBe('QUICK_WAP_WAY')
    expect(payload.bizContent.quitUrl).toBe('https://merchant.example.com/quit')
  })
})
