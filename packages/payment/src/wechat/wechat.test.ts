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
 * Mock the Wechatpay class at the module boundary: its constructor returns a "magic chain Proxy",
 * so prototype injection is not feasible; chained methods and request all land on per-instance
 * spies with fake implementations. Rsa / Aes / Formatter stay real, so tests do real signing
 * and a real AES-GCM round trip.
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
  it('rejects construction when certs is missing or apiv3Key length is wrong', () => {
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

  it('jsapiPay returns launch signing params that can be verified', async () => {
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

  it('jsapiPay order request body includes openid, amount, and notify URL', async () => {
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

  it('nativePay maps code_url; h5Pay carries payer_client_ip', async () => {
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

  it('query requests by merchant order number and maps the response', async () => {
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

  it('throws WechatApiError with status and business code on API failure', async () => {
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

  it('toWechatApiError normalizes network-level errors', () => {
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

  it('refund submits and maps the refund order', async () => {
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

  it('queryRefund URL-encodes the path param', async () => {
    const { client } = makeTestClient()
    sdkOf(client).spies.request.mockResolvedValue({ data: { refund_id: 're 1', status: 'SUCCESS', amount: { refund: 1 } } })

    await createRefund(client).queryRefund({ outRefundNo: 'RF 1' })
    expect(sdkOf(client).spies.request.mock.calls[0]![0]).toBe('/v3/refund/domestic/refunds/RF%201')
    expect(sdkOf(client).spies.request.mock.calls[0]![1]).toBe('GET')
  })
})

describe('wechat notify', () => {
  it('verify checks the payload signature with the public key for the given serial', () => {
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

  it('decrypt performs a real AES-256-GCM decryption', () => {
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

  it('validate compares merchant ID, order number, and amount', () => {
    const { client } = makeTestClient()
    const handler = createNotifyHandler(client)
    const payload = {
      mchid: '1900000000',
      outTradeNo: 'ORDER-1',
      amount: { total: 29900 }
    } as WechatNotifyTransaction

    expect(handler.validate(payload, { outTradeNo: 'ORDER-1', total: 29900 }).valid).toBe(true)
    expect(handler.validate(payload, { outTradeNo: 'ORDER-2', total: 29900 }).valid).toBe(false)
    expect(handler.validate({ ...payload, mchid: 'other' } as WechatNotifyTransaction, { outTradeNo: 'ORDER-1', total: 29900 }).errors[0]).toContain('mchid')
    expect(handler.validate(payload, { outTradeNo: 'ORDER-1', total: 1 }).errors[0]).toContain('amount.total')
  })

  it('fails closed when expected is omitted (no longer treats "only mchid checked" as valid)', () => {
    const { client } = makeTestClient()
    const handler = createNotifyHandler(client)
    const payload = {
      mchid: '1900000000',
      outTradeNo: 'ATTACKER-ORDER',
      amount: { total: 1 }
    } as WechatNotifyTransaction

    // expected is now required at the type level, so demote the whole **call** to never to exercise the runtime path
    // (what we are testing is "what if a JS caller omits it" — types cannot stop JS callers)
    const omitted = handler.validate as never as (payload: unknown, expected?: unknown) => { valid: boolean; errors: string[] }
    // before the fix: validate(payload) => valid: true (neither order number nor amount was compared)
    const result = omitted(payload)
    expect(result.valid).toBe(false)
    expect(result.errors.some(error => error.includes('expected.outTradeNo'))).toBe(true)
    expect(result.errors.some(error => error.includes('expected.total'))).toBe(true)

    // providing only one field must still fail closed (previously "only total" would pass)
    const onlyTotal = omitted(payload, { total: 1 })
    expect(onlyTotal.valid).toBe(false)
    expect(onlyTotal.errors.some(error => error.includes('expected.outTradeNo'))).toBe(true)
  })

  it('response bodies follow the WeChat Pay convention', () => {
    const { client } = makeTestClient()
    const handler = createNotifyHandler(client)
    expect(handler.successResponse()).toEqual({ code: 'SUCCESS' })
    expect(handler.failResponse()).toEqual({ code: 'FAIL', message: 'Processing failed' })
  })
})

describe('wechat plugin lifecycle', () => {
  it('installs its own client and disposes it on uninstall', () => {
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
    expect(() => client.sdk).toThrow('client has been disposed')
  })

  it('does not dispose an externally provided client on uninstall', () => {
    const { client } = makeTestClient()
    const provide = vi.fn()
    const plugin = wechatPlugin({ client })
    const cleanup = plugin.install?.({ provide } as unknown as VobsContext)
    expect(provide).toHaveBeenCalledWith(WECHAT_KEY, client)
    expect(cleanup).toBeUndefined()
    expect(() => client.sdk).not.toThrow()
  })
})
