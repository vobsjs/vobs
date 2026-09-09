# @vobs/payment

Payment integration SDK for the vobs framework: Alipay and WeChat payment adapters built on top of the official SDKs (alipay-sdk, wechatpay-axios-plugin), with vobs plugin registration support.

## Install

```bash
npm install @vobs/payment alipay-sdk wechatpay-axios-plugin
```

## Exports

- `@vobs/payment/alipay` / `@vobs/payment/wechat`: provider-scoped imports (recommended).
- `@vobs/payment` root: flat exports of provider-unique symbols (`AlipayClient`, `wechatPlugin`, `WechatApiError`, ...) plus `alipay` / `wechat` namespaces for the shared factories (`createRefund`, `createNotifyHandler`, ...) whose names collide across providers.

## Quick start

### Standalone usage (without vobs framework)

```ts
import { AlipayClient, createPagePay } from '@vobs/payment/alipay'

const client = new AlipayClient({
  appId: '202100...',
  privateKey: '-----BEGIN PRIVATE KEY-----\n...',
  alipayPublicKey: '-----BEGIN PUBLIC KEY-----\n...',
  notifyUrl: 'https://your-domain.com/alipay/notify',
  returnUrl: 'https://your-domain.com/order/123'
})

const pagePay = createPagePay(client)

const { formHtml } = await pagePay.pay({
  outTradeNo: 'ORDER2026090812345678',
  totalAmount: '99.00',
  subject: 'Premium Subscription'
})
```

### With vobs plugin

```ts
import { createVobs } from '@vobs/vobs'
import { alipayPlugin, useAlipay } from '@vobs/payment'

const app = createVobs({
  render: App,
  plugins: [
    alipayPlugin({
      config: {
        appId: '202100...',
        privateKey: '...',
        alipayPublicKey: '...',
        notifyUrl: 'https://your-domain.com/alipay/notify'
      }
    })
  ]
})

// In your component:
function CheckoutButton() {
  const alipay = useAlipay()
  const handlePay = async () => {
    const { formHtml } = await alipay.pay({
      outTradeNo: 'ORDER...',
      totalAmount: '99.00',
      subject: 'Premium Subscription'
    })
    // Render formHtml to redirect to Alipay
  }
  return <button onClick={handlePay}>Pay with Alipay</button>
}
```

## API

### Alipay

| Signature | Description |
| --- | --- |
| `AlipayClient(options)` | Wraps the official `AlipaySdk` instance with config validation and disposal. `client.sdk` exposes the underlying SDK. |
| `AlipayConfig` | Validated configuration: `appId`, `privateKey`, `alipayPublicKey`, `gateway`, `notifyUrl`, `returnUrl`, `keyType`, `timeout`. `AlipayConfig.forSandbox()` presets the sandbox gateway. |
| `createPagePay(client)` | Computer website payment (`alipay.trade.page.pay`). Returns the POST form HTML via `pageExecute()`. |
| `createQuery(client)` | Trade query (`alipay.trade.query`) with `isSuccessful()` helper. |
| `createRefund(client)` | Refund lifecycle: `refund()` (`alipay.trade.refund`), `queryRefund()` (`alipay.trade.fastpay.refund.query`), `close()` (`alipay.trade.close`). |
| `createNotifyHandler(client)` | Async notification helpers: `verify(params, raw?)` signature check, `validate(params, expected?)` business-field check, `successResponse()` / `failResponse()`. |
| `alipayPlugin(options)` | Vobs plugin that registers the Alipay client in the plugin context. Disposes only self-created clients on uninstall. |
| `useAlipay()` | Returns the Alipay client from the vobs plugin context. |

### Error handling

All gateway calls (`query`, `refund`, `queryRefund`, `close`) throw `AlipayApiError` when Alipay responds with a non-`10000` business code (e.g. `ACQ.TRADE_NOT_EXIST`):

```ts
import { AlipayApiError } from '@vobs/payment/alipay'

try {
  const result = await query.query({ outTradeNo: 'ORDER...' })
} catch (error) {
  if (error instanceof AlipayApiError) {
    error.code    // e.g. '40004'
    error.subCode // e.g. 'ACQ.TRADE_NOT_EXIST'
    error.subMsg  // human-readable reason
  }
}
```

For async notifications, signature verification only proves the notification came from Alipay — always validate it against your own order records:

```ts
const notify = createNotifyHandler(client)

if (!notify.verify(params, true) /* raw mode recommended */) {
  return notify.failResponse()
}

const check = notify.validate(params, {
  outTradeNo: 'ORDER...',   // from your order store
  totalAmount: '99.00'
})
if (!check.valid) {
  return notify.failResponse()
}

// Idempotent business handling is the caller's responsibility (dedupe by notifyId).
return notify.successResponse() // exactly "success"
```

### WeChat

| Signature | Description |
| --- | --- |
| `WechatClient(options)` | Wraps the official `wechatpay-axios-plugin` `Wechatpay` instance (`mchid`, `serial`, `privateKey`, `certs`, `appid`, `apiv3Key`, `notifyUrl`). `client.sdk` exposes the chained API. |
| `WechatConfig` | Validated configuration; `apiv3Key` must be a 32-byte string. |
| `createPayment(client)` | `jsapiPay()` (JSAPI / mini-program, returns signed `wx.requestPayment` params), `appPay()` (APP SDK params), `nativePay()` (returns `codeUrl` QR link), `h5Pay()` (returns `h5Url`, requires `payerClientIp`), `query()` by `outTradeNo` or `transactionId`. |
| `createRefund(client)` | `refund()` (`POST /v3/refund/domestic/refunds`), `queryRefund()` by `outRefundNo` or `refundId`. |
| `createNotifyHandler(client)` | `verify(headers, body)` (platform-cert / public-key signature check on the RAW body), `decrypt(resource)` (AES-256-GCM with `apiv3Key`), `validate(payload, expected)`, `successResponse()` / `failResponse()`. |
| `wechatPlugin(options)` / `useWechat()` | Vobs plugin registering the WeChat client; disposes only self-created clients. |

#### Error handling

Gateway failures throw `WechatApiError` with `status` (HTTP code) and `code` (e.g. `PARAM_ERROR`, `RESOURCE_NOT_EXISTS`):

```ts
import { WechatApiError } from '@vobs/payment'

try {
  const result = await payment.jsapiPay({ outTradeNo: 'ORDER...', description: '...', amount: { total: 9900 }, openid: '...' })
} catch (error) {
  if (error instanceof WechatApiError) {
    error.status // e.g. 400
    error.code   // e.g. 'PARAM_ERROR'
  }
}
```

Notifications require signature verification on the **raw** body plus merchant-side order matching:

```ts
import { createNotifyHandler } from '@vobs/payment/wechat'

const notify = createNotifyHandler(wechatClient)

if (!notify.verify(headers, rawBody)) {
  return notify.failResponse('签名校验失败')
}

const payload = notify.decrypt(resource)
const check = notify.validate(payload, { outTradeNo: 'ORDER...', total: 9900 })
if (!check.valid) {
  return notify.failResponse(check.errors.join('; '))
}

// Idempotent business handling is the caller's responsibility (dedupe by notification id).
return notify.successResponse() // {"code":"SUCCESS"}
```

Amounts in the WeChat v3 API are integers in **fen** (分).

## Types

AlipayClientOptions, AlipayKeyType, TradeStatus, AlipayPagePayConfig, AlipayPagePayParams, AlipayPagePayResult, AlipayQueryParams, AlipayQueryResult, AlipayRefundParams, AlipayRefundResult, AlipayRefundQueryParams, AlipayRefundQueryResult, AlipayCloseParams, AlipayCloseResult, AlipayNotifyParams, AlipayPluginOptions
