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
 * 微信支付下单（APIv3）
 *
 * 覆盖四种收款场景：
 * - jsapiPay：公众号网页 / 小程序（wx.requestPayment）
 * - appPay：APP 拉起微信支付
 * - nativePay：PC 扫码支付（返回二维码链接）
 * - h5Pay：微信外浏览器 H5 支付（返回收银台跳转链接）
 *
 * ⚠️ 支付结果以异步通知或 query() 为准。
 */
export function createPayment(client: WechatClient) {
  return {
    /**
     * 公众号 / 小程序支付下单（POST /v3/pay/transactions/jsapi）
     * @param params 下单参数，openid 必填
     * @returns 调起 wx.requestPayment 所需的签名参数
     */
    async jsapiPay(params: WechatPayParams & { openid: string }): Promise<WechatJsapiPayResult> {
      const { data } = await postTransaction(client, 'jsapi', params)
      return buildInvokeParams(client, data.prepay_id ?? '')
    },

    /**
     * APP 支付下单（POST /v3/pay/transactions/app）
     * @param params 下单参数
     * @returns 传给客户端 SDK 调起微信支付的签名参数
     */
    async appPay(params: WechatPayParams): Promise<WechatAppPayResult> {
      const { data } = await postTransaction(client, 'app', params)
      return buildInvokeParams(client, data.prepay_id ?? '')
    },

    /**
     * Native 扫码支付下单（POST /v3/pay/transactions/native）
     * @returns 二维码链接（前端渲染二维码，用户扫码支付）
     */
    async nativePay(params: WechatPayParams): Promise<WechatNativePayResult> {
      const { data } = await postTransaction(client, 'native', params)
      if (!data.code_url) {
        throw new Error('WechatClient: 下单响应缺少 code_url')
      }
      return { codeUrl: data.code_url }
    },

    /**
     * H5 支付下单（POST /v3/pay/transactions/h5）
     * @param params 下单参数，payerClientIp 必填
     * @returns 收银台跳转链接（302 重定向即可拉起微信支付）
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
     * 交易查询（GET /v3/pay/transactions/out-trade-no/{no} 或 .../id/{id}）
     * @throws {WechatApiError} 订单不存在等失败（RESOURCE_NOT_EXISTS）
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

/** 构造下单请求体（camelCase -> snake_case，注入 appid/mchid/notify_url） */
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
  // 移除 undefined 字段
  for (const key of Object.keys(body)) {
    if (body[key] === undefined) delete body[key]
  }
  return body
}

/**
 * 生成拉起支付的签名参数。
 * 签名串：appid\ntimeStamp\nnonceStr\nprepay_id=xxx\n（SHA256withRSA，商户 API 私钥）
 */
function buildInvokeParams(client: WechatClient, prepayId: string): WechatJsapiPayResult {
  if (!prepayId) {
    throw new Error('WechatClient: 下单响应缺少 prepay_id')
  }
  const appId = client.config.appid
  const timeStamp = `${Formatter.timestamp()}`
  const nonceStr = Formatter.nonce(32)
  const pkg = `prepay_id=${prepayId}`
  const message = `${appId}\n${timeStamp}\n${nonceStr}\n${pkg}\n`
  const paySign = Rsa.sign(message, client.config.options.privateKey)
  return { appId, timeStamp, nonceStr, package: pkg, signType: 'RSA', paySign }
}

/** snake_case 响应映射 */
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
