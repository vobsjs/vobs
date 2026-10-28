import { Formatter, Rsa } from 'wechatpay-axios-plugin'
import type { WechatClient } from './client'
import { unwrapV3 } from './response'
import type {
  WechatAppPayResult,
  WechatH5PayParams,
  WechatH5PayResult,
  WechatJsapiPayResult,
  WechatNativePayResult,
  WechatPayParams,
  WechatQueryParams,
  WechatQueryResult,
  WechatTradeState
} from './types'

/**
 * WeChat Pay order creation (APIv3)
 *
 * Covers four payment scenarios:
 * - jsapiPay: Official Account web page / Mini Program (wx.requestPayment)
 * - appPay: launch WeChat Pay from a native app
 * - nativePay: PC QR-code payment (returns the QR code URL)
 * - h5Pay: H5 payment in browsers outside WeChat (returns the cashier redirect URL)
 *
 * ⚠️ Treat the async notification or query() as the source of truth for payment results.
 */
export function createPayment(client: WechatClient) {
  return {
    /**
     * Official Account / Mini Program order (POST /v3/pay/transactions/jsapi)
     * @param params order params; openid is required
     * @returns signed params needed to invoke wx.requestPayment
     */
    async jsapiPay(params: WechatPayParams & { openid: string }): Promise<WechatJsapiPayResult> {
      const { data } = await postTransaction(client, 'jsapi', params)
      return buildInvokeParams(client, data.prepay_id ?? '')
    },

    /**
     * App order (POST /v3/pay/transactions/app)
     * @param params order params
     * @returns signed params to pass to the client SDK to launch WeChat Pay
     */
    async appPay(params: WechatPayParams): Promise<WechatAppPayResult> {
      const { data } = await postTransaction(client, 'app', params)
      return buildInvokeParams(client, data.prepay_id ?? '')
    },

    /**
     * Native QR-code order (POST /v3/pay/transactions/native)
     * @returns QR code URL (frontend renders the QR code; user scans to pay)
     */
    async nativePay(params: WechatPayParams): Promise<WechatNativePayResult> {
      const { data } = await postTransaction(client, 'native', params)
      if (!data.code_url) {
        throw new Error('WechatClient: order response is missing code_url')
      }
      return { codeUrl: data.code_url }
    },

    /**
     * H5 order (POST /v3/pay/transactions/h5)
     * @param params order params; payerClientIp is required
     * @returns cashier redirect URL (a 302 redirect launches WeChat Pay)
     */
    async h5Pay(params: WechatH5PayParams): Promise<WechatH5PayResult> {
      const body = buildTransactionBody(client, params)
      body.scene_info = {
        payer_client_ip: params.payerClientIp,
        ...(params.sceneInfo?.deviceType ? { device_type: params.sceneInfo.deviceType } : {})
      }
      const { data } = await unwrapV3(client.sdk.v3.pay.transactions.h5.post(body))
      return { h5Url: data.h5_url }
    },

    /**
     * Transaction query (GET /v3/pay/transactions/out-trade-no/{no} or .../id/{id})
     * @throws {WechatApiError} on failures such as order not found (RESOURCE_NOT_EXISTS)
     */
    async query(params: WechatQueryParams): Promise<WechatQueryResult> {
      const mchid = client.config.mchid
      const response = params.transactionId
        ? await unwrapV3(
            client.sdk.client.request(
              `/v3/pay/transactions/id/${encodeURIComponent(params.transactionId)}`,
              'GET',
              undefined,
              { params: { mchid } }
            )
          )
        : await unwrapV3(
            client.sdk.client.request(
              `/v3/pay/transactions/out-trade-no/${encodeURIComponent(params.outTradeNo ?? '')}`,
              'GET',
              undefined,
              { params: { mchid } }
            )
          )
      return mapTransaction((response as { data: Record<string, any> }).data)
    }
  }
}

type TransactionChain = 'jsapi' | 'app' | 'native'

async function postTransaction(
  client: WechatClient,
  chain: TransactionChain,
  params: WechatPayParams
): Promise<{ data: { prepay_id?: string; code_url?: string } }> {
  const body = buildTransactionBody(client, params)
  return unwrapV3(client.sdk.v3.pay.transactions[chain].post(body))
}

/** Build the order request body (camelCase -> snake_case, injects appid/mchid/notify_url) */
function buildTransactionBody(
  client: WechatClient,
  params: WechatPayParams
): Record<string, any> {
  const body: Record<string, any> = {
    appid: client.config.appid,
    mchid: client.config.mchid,
    description: params.description,
    out_trade_no: params.outTradeNo,
    time_expire: params.timeExpire,
    attach: params.attach,
    goods_tag: params.goodsTag,
    notify_url: client.config.notifyUrl,
    amount: {
      total: params.amount.total,
      currency: params.amount.currency ?? 'CNY'
    }
  }
  if (params.openid) {
    body.payer = { openid: params.openid }
  }
  // Strip undefined fields
  for (const key of Object.keys(body)) {
    if (body[key] === undefined) delete body[key]
  }
  return body
}

/**
 * Generate the signed params used to launch payment.
 * Sign message: appId\ntimeStamp\nnonceStr\nprepay_id=xxx\n (SHA256withRSA, merchant API private key)
 */
function buildInvokeParams(client: WechatClient, prepayId: string): WechatJsapiPayResult {
  if (!prepayId) {
    throw new Error('WechatClient: order response is missing prepay_id')
  }
  const appId = client.config.appid
  const timeStamp = `${Formatter.timestamp()}`
  const nonceStr = Formatter.nonce(32)
  const pkg = `prepay_id=${prepayId}`
  const message = `${appId}\n${timeStamp}\n${nonceStr}\n${pkg}\n`
  const paySign = Rsa.sign(message, client.config.options.privateKey)
  return { appId, timeStamp, nonceStr, package: pkg, signType: 'RSA', paySign }
}

/** snake_case response mapping */
function mapTransaction(data: Record<string, any>): WechatQueryResult {
  return {
    appid: data.appid,
    mchid: data.mchid,
    outTradeNo: data.out_trade_no,
    transactionId: data.transaction_id,
    tradeType: data.trade_type,
    tradeState: data.trade_state as WechatTradeState,
    tradeStateDesc: data.trade_state_desc,
    bankType: data.bank_type,
    attach: data.attach,
    successTime: data.success_time,
    total: data.amount?.total,
    payerTotal: data.amount?.payer_total
  }
}
