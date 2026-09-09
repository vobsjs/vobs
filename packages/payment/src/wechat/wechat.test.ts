import { describe, expect, it, vi, beforeEach } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import { Aes, Formatter, Rsa } from 'wechatpay-axios-plugin'
import { WechatConfig } from './config'
import { WechatApiError, toWechatApiError } from './response'
import { WechatClient } from './client'
import { createPayment } from './payment'
import { createNotifyHandler } from './notify'
import { createRefund } from './refund'
import { wechatPlugin, WECHAT_KEY } from './plugin'
import type { WechatClient as WechatClientType } from './client'
import type { WechatClientOptions, WechatNotifyTransaction } from './types'
import type { VobsContext } from '@vobs/vobs'

/**
 * 在模块边界 mock Wechatpay 类：其构造函数返回的是"魔法链 Proxy"，
 * 原型注入不可行；链式方法与 request 全部落在假实现的 per-instance spy 上。
 * Rsa / Aes / Formatter 保持真实现，测试内完成真实签名与 AES-GCM 往返。
 */
vi.mock('wechatpay-axios-plugin', async (importOriginal) => {
  const actual = await importOriginal<typeof import('wechatpay-axios-plugin')>()

  class FakeWechatpay {
    options: Record<string, any>
    spies: {
      jsapiPost: ReturnType<typeof vi.fn>
      appPost: ReturnType<typeof vi.fn>
      nativePost: ReturnType<typeof vi.fn>
      h5Post: ReturnType<typeof vi.fn>
      refundPost: ReturnType<typeof vi.fn>
      request: ReturnType<typeof vi.fn>
    }

    constructor(options: Record<string, any>) {
      this.options = options
      this.spies = {
        jsapiPost: vi.fn(),
        appPost: vi.fn(),
        nativePost: vi.fn(),
        h5Post: vi.fn(),
        refundPost: vi.fn(),
        request: vi.fn()
      }
    }

    get client() {
      return { request: this.spies.request }
    }

    get v3() {
      const spies = this.spies
      return {
        pay: {
          transactions: {
            jsapi: { post: spies.jsapiPost },
            app: { post: spies.appPost },
            native: { post: spies.nativePost },
            h5: { post: spies.h5Post }
          }
        },
        refund: { domestic: { refunds: { post: spies.refundPost } } }
      }
    }
  }

  return { ...actual, Wechatpay: FakeWechatpay }
})

interface FakeSdk {
  spies: {
    jsapiPost: ReturnType<typeof vi.fn>
    appPost: ReturnType<typeof vi.fn>
    nativePost: ReturnType<typeof vi.fn>
    h5Post: ReturnType<typeof vi.fn>
    refundPost: ReturnType<typeof vi.fn>
    request: ReturnType<typeof vi.fn>
  }
}

function sdkOf(client: WechatClientType): FakeSdk {
  return client.sdk as unknown as FakeSdk
}

function makeTestClient() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()

  const client = new WechatClient({
    mchid: '1900000000',
    serial: 'MCH_CERT_SERIAL_1',
    privateKey: privateKeyPem,
    certs: { PUB_KEY_ID_TEST_1: publicKeyPem },
    appid: 'wx1234567890',
    apiv3Key: '0123456789abcdef0123456789abcdef',
    notifyUrl: 'https://merchant.example.com/wechat/notify'
  })
  return { client, privateKeyPem, publicKeyPem }
}

function axiosFailure(status: number, code: string, message: string) {
  const error = new Error(message) as any
  error.response = { status, data: { code, message } }
  return error
}

const BASE_OPTIONS: WechatClientOptions = {
  mchid: '1900000000',
  serial: 'S1',
  privateKey: '',
  certs: {},
  appid: 'wx1234567890',
  apiv3Key: '0123456789abcdef0123456789abcdef',
  notifyUrl: 'https://merchant.example.com/wechat/notify'
}

describe('wechat client config validation', () => {
  it('缺少 certs 或 apiv3Key 长度错误时拒绝构建', () => {
    expect(() => new WechatConfig({ ...BASE_OPTIONS, privateKey: 'K', certs: {} })).toThrow('certs')
    expect(() => new WechatConfig({
      ...BASE_OPTIONS,
      privateKey: 'K',
      certs: { P: 'K' },
      apiv3Key: 'short'
    })).toThrow('apiv3Key')
  })
})

describe('wechat payment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('jsapiPay 返回可验真的调起签名参数', async () => {
    const { client } = makeTestClient()
    sdkOf(client).spies.jsapiPost.mockResolvedValue({ data: { prepay_id: 'wx29prepay' }, status: 200 })

    const result = await createPayment(client).jsapiPay({
      outTradeNo: 'ORDER-1',
      description: '会员',
      amount: { total: 29900 },
      openid: 'oX-openid'
    })

    expect(result.appId).toBe('wx1234567890')
    expect(result.package).toBe('prepay_id=wx29prepay')
    expect(result.signType).toBe('RSA')

    const message = `${result.appId}\n${result.timeStamp}\n${result.nonceStr}\n${result.package}\n`
    expect(Rsa.verify(message, result.paySign, client.config.options.certs['PUB_KEY_ID_TEST_1'])).toBe(true)
  })

  it('jsapiPay 下单请求体包含 openid、金额与回调地址', async () => {
    const { client } = makeTestClient()
    sdkOf(client).spies.jsapiPost.mockResolvedValue({ data: { prepay_id: 'p1' }, status: 200 })

    await createPayment(client).jsapiPay({
      outTradeNo: 'ORDER-1',
      description: '会员',
      amount: { total: 29900 },
      openid: 'oX-openid',
      attach: 'attach-1'
    })

    const body = sdkOf(client).spies.jsapiPost.mock.calls[0]![0] as Record<string, any>
    expect(body.appid).toBe('wx1234567890')
    expect(body.mchid).toBe('1900000000')
    expect(body.out_trade_no).toBe('ORDER-1')
    expect(body.attach).toBe('attach-1')
    expect(body.notify_url).toBe('https://merchant.example.com/wechat/notify')
    expect(body.amount).toEqual({ total: 29900, currency: 'CNY' })
    expect(body.payer).toEqual({ openid: 'oX-openid' })
  })

  it('nativePay 映射 code_url，h5Pay 携带 payer_client_ip', async () => {
    const { client } = makeTestClient()
    const spies = sdkOf(client).spies
    spies.nativePost.mockResolvedValue({
      data: { code_url: 'weixin://wxpay/bizpayurl?pr=abc' },
      status: 200
    })
    spies.h5Post.mockResolvedValue({
      data: { h5_url: 'https://wx.tenpay.com/cgi-bin/mmpayweb-bin/checkmweb?prepay_id=p' },
      status: 200
    })

    const native = await createPayment(client).nativePay({
      outTradeNo: 'ORDER-2',
      description: '会员',
      amount: { total: 100 }
    })
    expect(native.codeUrl).toContain('weixin://')

    const h5 = await createPayment(client).h5Pay({
      outTradeNo: 'ORDER-3',
      description: '会员',
      amount: { total: 100 },
      payerClientIp: '1.2.3.4'
    })
    expect(h5.h5Url).toContain('checkmweb')
    const h5Body = spies.h5Post.mock.calls[0]![0] as Record<string, any>
    expect(h5Body.scene_info.payer_client_ip).toBe('1.2.3.4')
  })

  it('query 按商户订单号请求并映射响应', async () => {
    const { client } = makeTestClient()
    sdkOf(client).spies.request.mockResolvedValue({
      data: {
        appid: 'wx1234567890',
        mchid: '1900000000',
        out_trade_no: 'ORDER-1',
        transaction_id: '4200001',
        trade_state: 'SUCCESS',
        trade_state_desc: '支付成功',
        amount: { total: 29900, payer_total: 29800 }
      }
    })

    const result = await createPayment(client).query({ outTradeNo: 'ORDER-1' })
    expect(sdkOf(client).spies.request.mock.calls[0]![0]).toBe('/v3/pay/transactions/out-trade-no/ORDER-1')
    expect(result.tradeState).toBe('SUCCESS')
    expect(result.payerTotal).toBe(29800)
  })

  it('接口失败时抛出 WechatApiError 并携带状态码与业务码', async () => {
    const { client } = makeTestClient()
    sdkOf(client).spies.jsapiPost.mockRejectedValue(
      axiosFailure(400, 'PARAM_ERROR', 'openid 与 appid 不匹配')
    )

    await expect(
      createPayment(client).jsapiPay({
        outTradeNo: 'ORDER-1',
        description: 'x',
        amount: { total: 1 },
        openid: 'bad'
      })
    ).rejects.toMatchObject({
      name: 'WechatApiError',
      status: 400,
      code: 'PARAM_ERROR'
    })
  })

  it('toWechatApiError 归一化网络层错误', () => {
    const error = new Error('connect ECONNREFUSED') as any
    error.code = 'ECONNREFUSED'
    const apiError = toWechatApiError(error)
    expect(apiError).toBeInstanceOf(WechatApiError)
    expect(apiError.status).toBeUndefined()
    expect(apiError.code).toBe('ECONNREFUSED')
  })
})

describe('wechat refund', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('refund 提交并映射退款单', async () => {
    const { client } = makeTestClient()
    sdkOf(client).spies.refundPost.mockResolvedValue({
      data: {
        refund_id: 're-1',
        out_refund_no: 'RF-1',
        out_trade_no: 'ORDER-1',
        transaction_id: '4200001',
        status: 'PROCESSING',
        amount: { refund: 100, total: 29900, payer_total: 29900, user_received_amount: 100 }
      }
    })

    const result = await createRefund(client).refund({
      outTradeNo: 'ORDER-1',
      outRefundNo: 'RF-1',
      amount: { refund: 100 },
      reason: '七天无理由'
    })

    const body = sdkOf(client).spies.refundPost.mock.calls[0]![0] as Record<string, any>
    expect(body.out_trade_no).toBe('ORDER-1')
    expect(body.amount.refund).toBe(100)
    expect(result.status).toBe('PROCESSING')
    expect(result.userReceivedAmount).toBe(100)
  })

  it('queryRefund 对路径参数做 URL 编码', async () => {
    const { client } = makeTestClient()
    sdkOf(client).spies.request.mockResolvedValue({ data: { refund_id: 're 1', status: 'SUCCESS', amount: { refund: 1 } } })

    await createRefund(client).queryRefund({ outRefundNo: 'RF 1' })
    expect(sdkOf(client).spies.request.mock.calls[0]![0]).toBe('/v3/refund/domestic/refunds/RF%201')
    expect(sdkOf(client).spies.request.mock.calls[0]![1]).toBe('GET')
  })
})

describe('wechat notify', () => {
  it('verify 用对应序列号的公钥验签原文', () => {
    const { client, privateKeyPem } = makeTestClient()
    const handler = createNotifyHandler(client)
    const body = JSON.stringify({ id: 'evt-1', resource: {} })
    const headers = {
      timestamp: `${Formatter.timestamp()}`,
      nonce: Formatter.nonce(16),
      serial: 'PUB_KEY_ID_TEST_1',
      signature: ''
    }
    headers.signature = Rsa.sign(Formatter.response(headers.timestamp, headers.nonce, body), privateKeyPem)

    expect(handler.verify(headers, body)).toBe(true)
    expect(handler.verify({ ...headers, signature: 'broken' }, body)).toBe(false)
    expect(handler.verify({ ...headers, serial: 'UNKNOWN' }, body)).toBe(false)
  })

  it('decrypt 走真实 AES-256-GCM 解密', () => {
    const { client } = makeTestClient()
    const handler = createNotifyHandler(client)
    const transaction: WechatNotifyTransaction = {
      mchid: '1900000000',
      appid: 'wx1234567890',
      outTradeNo: 'ORDER-1',
      transactionId: '4200001',
      tradeState: 'SUCCESS',
      amount: { total: 29900, payerTotal: 29900 }
    }
    const ciphertext = Aes.AesGcm.encrypt(
      JSON.stringify(transaction),
      client.config.apiv3Key,
      'nonce1234',
      'transaction'
    )

    const payload = handler.decrypt({
      ciphertext,
      nonce: 'nonce1234',
      associatedData: 'transaction'
    })
    expect(payload.outTradeNo).toBe('ORDER-1')
    expect((payload as WechatNotifyTransaction).amount.total).toBe(29900)
  })

  it('validate 比对商户号、订单号与金额', () => {
    const { client } = makeTestClient()
    const handler = createNotifyHandler(client)
    const payload = {
      mchid: '1900000000',
      outTradeNo: 'ORDER-1',
      amount: { total: 29900 }
    } as WechatNotifyTransaction

    expect(handler.validate(payload, { outTradeNo: 'ORDER-1', total: 29900 }).valid).toBe(true)
    expect(handler.validate(payload, { outTradeNo: 'ORDER-2' }).valid).toBe(false)
    expect(handler.validate({ ...payload, mchid: 'other' } as WechatNotifyTransaction, { total: 29900 }).errors[0]).toContain('mchid')
    expect(handler.validate(payload, { total: 1 }).errors[0]).toContain('amount.total')
  })

  it('应答体符合微信支付约定', () => {
    const { client } = makeTestClient()
    const handler = createNotifyHandler(client)
    expect(handler.successResponse()).toEqual({ code: 'SUCCESS' })
    expect(handler.failResponse()).toEqual({ code: 'FAIL', message: '处理失败' })
  })
})

describe('wechat plugin lifecycle', () => {
  it('安装自建客户端并在卸载时销毁', () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const provide = vi.fn()
    const plugin = wechatPlugin({
      config: {
        ...BASE_OPTIONS,
        privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
        certs: { PUB_KEY_ID_TEST: publicKey.export({ type: 'spki', format: 'pem' }).toString() }
      }
    })
    const cleanup = plugin.install?.({ provide } as unknown as VobsContext)
    const client = provide.mock.calls[0]![1] as WechatClientType
    expect(provide).toHaveBeenCalledWith(WECHAT_KEY, client)
    expect(typeof cleanup).toBe('function')
    cleanup!()
    expect(() => client.sdk).toThrow('客户端已销毁')
  })

  it('外部传入的客户端在卸载时不被销毁', () => {
    const { client } = makeTestClient()
    const provide = vi.fn()
    const plugin = wechatPlugin({ client })
    const cleanup = plugin.install?.({ provide } as unknown as VobsContext)
    expect(provide).toHaveBeenCalledWith(WECHAT_KEY, client)
    expect(cleanup).toBeUndefined()
    expect(() => client.sdk).not.toThrow()
  })
})
