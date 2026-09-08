# @vobs/payment

Payment integration SDK for the vobs framework: Alipay and WeChat payment adapters built on top of the official Alipay SDK, with vobs plugin registration support.

## Install

```bash
npm install @vobs/payment alipay-sdk
```

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
import { createVobs } from '@vobs/dom'
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
| `AlipayClient(config)` | Creates an Alipay client with the given app credentials and configuration. |
| `AlipayConfig` | Configuration object: `appId`, `privateKey`, `alipayPublicKey`, `notifyUrl`, `returnUrl`, `sandbox`. |
| `createPagePay(client)` | Creates a computer website payment handler (`alipay.trade.page.pay`). |
| `createTradeQuery(client)` | Creates a trade query handler (`alipay.trade.query`). |
| `createTradeRefund(client)` | Creates a refund handler (`alipay.trade.refund`). |
| `createRefundQuery(client)` | Creates a refund query handler (`alipay.trade.fastpay.refund.query`). |
| `createTradeClose(client)` | Creates a trade close handler (`alipay.trade.close`). |
| `verifyNotify(params, alipayPublicKey)` | Verifies the async notification signature. |
| `alipayPlugin(options)` | Vobs plugin that registers the Alipay client in the plugin context. |
| `useAlipay()` | Returns the Alipay client from the vobs plugin context. |

### WeChat

| Signature | Description |
| --- | --- |
| *(Planned)* | WeChat Pay integration will follow the same pattern. |

## Types

AlipayConfig, AlipayClientOptions, PagePayParams, PagePayResult, TradeQueryParams, TradeQueryResult, TradeRefundParams, TradeRefundResult, RefundQueryParams, RefundQueryResult, TradeCloseParams, TradeCloseResult, NotifyParams, PluginOptions, AlipayContext