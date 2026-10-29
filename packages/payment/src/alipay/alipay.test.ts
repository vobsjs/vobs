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
  it('unwrapResponse throws AlipayApiError with sub_code on business failure', () => {
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

  it('unwrapResponse returns the business body on success', () => {
    const body = { code: '10000', msg: 'Success', trade_no: 'T-1' }
    expect(unwrapResponse({ alipay_trade_query_response: body }, 'alipay.trade.query')).toBe(body)
  })
})

describe('alipay query', () => {
  it('query maps snake_case response fields on success', async () => {
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

  it('query throws AlipayApiError on business failure instead of returning a fake success', async () => {
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
  it('refund maps refund_fee and provides defaults on success', async () => {
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

  it('close throws AlipayApiError on business failure', async () => {
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
  const expected = { outTradeNo: 'ORDER-1', totalAmount: '299.00' }

  it('passes when app_id, order number, and amount all match', () => {
    const handler = createNotifyHandler(makeClient())
    expect(handler.validate(baseNotify as never, expected).valid).toBe(true)
  })

  it('fails closed when expected is omitted (no longer treats "only app_id checked" as valid)', () => {
    const handler = createNotifyHandler(makeClient())
    // expected is now required at the type level, so demote the whole **call** to never to exercise the runtime path
    // (what we are testing is "what if a JS caller omits it" — types cannot stop JS callers)
    const omitted = handler.validate as never as (params: unknown, expected?: unknown) => { valid: boolean; errors: string[] }
    // before the fix this was valid: true — any order number, any amount would pass
    const result = omitted(baseNotify)
    expect(result.valid).toBe(false)
    expect(result.errors.some(error => error.includes('expected.outTradeNo'))).toBe(true)
    expect(result.errors.some(error => error.includes('expected.totalAmount'))).toBe(true)
  })

  it('fails closed when the expected amount is an empty string (previously skipped by a falsy short-circuit)', () => {
    const handler = createNotifyHandler(makeClient())
    const result = handler.validate(baseNotify as never, { outTradeNo: 'ORDER-1', totalAmount: '' })
    expect(result.valid).toBe(false)
    expect(result.errors.some(error => error.includes('expected.totalAmount'))).toBe(true)
  })

  it('reports an error when app_id mismatches', () => {
    const handler = createNotifyHandler(makeClient())
    const result = handler.validate({ ...baseNotify, appId: 'other-app' } as never, expected)
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('app_id')
  })

  it('reports errors when order number or amount expectations mismatch', () => {
    const handler = createNotifyHandler(makeClient())
    const result = handler.validate(baseNotify as never, { outTradeNo: 'ORDER-2', totalAmount: '300.00' })
    expect(result.valid).toBe(false)
    expect(result.errors.some(error => error.includes('out_trade_no'))).toBe(true)
    expect(result.errors.some(error => error.includes('total_amount'))).toBe(true)
  })

  it('compares amounts numerically: "299.0" and "299.00" are treated as equal', () => {
    const handler = createNotifyHandler(makeClient())
    const result = handler.validate({ ...baseNotify, totalAmount: '299.0' } as never, { outTradeNo: 'ORDER-1', totalAmount: '299.00' })
    expect(result.valid).toBe(true)
  })

  it('reports an error for a non-final trade_status', () => {
    const handler = createNotifyHandler(makeClient())
    const result = handler.validate({ ...baseNotify, tradeStatus: 'WAIT_BUYER_PAY' } as never, expected)
    expect(result.valid).toBe(false)
    expect(result.errors.some(error => error.includes('trade_status'))).toBe(true)
  })

  it('verify passes through the raw param and returns false when the SDK throws', () => {
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
  it('installs its own client and disposes it on uninstall', () => {
    const provide = vi.fn()
    const plugin = alipayPlugin({
      config: { appId: '2021000000000000', privateKey: 'k', alipayPublicKey: 'p' } as AlipayClientOptions
    })
    const cleanup = plugin.install?.({ provide } as unknown as VobsContext)
    const client = provide.mock.calls[0]![1] as AlipayClient
    expect(provide).toHaveBeenCalledWith(ALIPAY_KEY, client)
    expect(typeof cleanup).toBe('function')
    cleanup!()
    expect(() => client.sdk).toThrow('client has been disposed')
  })

  it('does not dispose an externally provided client on uninstall', () => {
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
  it('wap.pay uses the QUICK_WAP_WAY product code and passes through quit_url', async () => {
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
