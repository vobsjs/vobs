import { onDispose, state } from '@vobs/vobs'
import { Alert, Button, Card, createDOMPortalAdapter, Dialog, Icon, Input, Tag } from '@vobs/ui'
import { KitPage } from '@vobs/kit'
import { useRouter } from '@vobs/router'
import { useI18n } from '@vobs/i18n'

interface Product {
  id: string
  name: string
  price: string
  description: string
  image: string
}

const products: Product[] = [
  {
    id: 'prod_001',
    name: 'Vobs Framework License - Basic',
    price: '299.00',
    description: 'For individual developers and small teams; includes the core framework and all official extension packages.',
    image: '📦'
  },
  {
    id: 'prod_002',
    name: 'Vobs Framework License - Pro',
    price: '999.00',
    description: 'For mid-sized teams; includes everything in Basic plus advanced extension packages and enterprise-grade support.',
    image: '🚀'
  },
  {
    id: 'prod_003',
    name: 'Vobs Framework License - Enterprise',
    price: '4999.00',
    description: 'For large enterprises; full-feature license plus dedicated technical support and customized development services.',
    image: '🏢'
  }
]

export function PaymentPage() {
  const router = useRouter()
  const i18n = useI18n()
  const selectedProduct = state<Product | null>(null, 'selectedProduct')
  const paying = state(false, 'paying')
  const paymentLog = state<string[]>(['>>> Waiting to start payment...'], 'paymentLog')
  const dialogOpen = state(false, 'dialogOpen')
  const portal = createDOMPortalAdapter()
  const configAppId = state('', 'configAppId')
  const configPrivateKey = state('', 'configPrivateKey')
  const configAlipayPublicKey = state('', 'configAlipayPublicKey')
  const configNotifyUrl = state('', 'configNotifyUrl')
  const configReturnUrl = state('', 'configReturnUrl')

  onDispose(() => {
    selectedProduct.value = null
    paying.value = false
  })

  function addLog(msg: string): void {
    paymentLog.value = [...paymentLog.value, `>>> ${msg}`]
  }

  function selectProduct(product: Product): void {
    selectedProduct.value = product
    paymentLog.value = ['>>> Product selected, waiting to start payment...']
  }

  async function handlePay(): Promise<void> {
    if (!selectedProduct.value) return
    const product = selectedProduct.value
    paying.value = true
    addLog(`Starting payment: ${product.name} (¥${product.price})`)
    addLog('Calling AlipayClient.pagePay()...')
    addLog('Generated order no.: ' + `ORDER${Date.now()}`)
    addLog('Calling alipay.trade.page.pay API...')
    addLog('Received Alipay HTML form...')

    // Simulated payment delay
    await new Promise(resolve => setTimeout(resolve, 1500))

    addLog('Payment form generated, redirecting to the Alipay checkout...')
    paying.value = false

    // Navigate to the result page
    void router.push({
      path: '/payment/result',
      state: {
        outTradeNo: `ORDER${Date.now()}`,
        totalAmount: product.price,
        subject: product.name,
        tradeStatus: 'TRADE_SUCCESS',
        gmtPayment: new Date().toLocaleString('zh-CN')
      }
    })
  }

  return (
    <KitPage
      class="demo-shell"
      title={i18n.t('payment.pay.title')}
      description={i18n.t('payment.pay.description')}
      actions={<Tag tone="brand">@vobs/payment/alipay</Tag>}
    >
      <Alert
        tone="info"
        title={i18n.t('payment.pay.demoDescription')}
        icon={<Icon name="info" />}
      />

      <div class="demo-form-layout">
        <Card title={i18n.t('payment.pay.productTitle')} description={i18n.t('payment.pay.productDescription')} style="position: relative">
          <Button
            variant="ghost"
            icon={<Icon name="settings" />}
            style="position: absolute; top: var(--spacer-16); right: var(--spacer-16)"
            onClick={() => { dialogOpen.value = true }}
          />
          <div class="demo-product-grid">
            {products.map(product => (
              <div
                class={`demo-product-card ${selectedProduct.value?.id === product.id ? 'demo-product-card--selected' : ''}`}
                onClick={() => selectProduct(product)}
              >
                <div class="demo-product-icon">{product.image}</div>
                <div class="demo-product-name">{product.name}</div>
                <div class="demo-product-price">¥{product.price}</div>
                <div class="demo-product-desc">{product.description}</div>
                {selectedProduct.value?.id === product.id && (
                  <div class="demo-product-check">
                    <Icon name="check-circle" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>

        <Card
          title={i18n.t('payment.pay.orderTitle')}
          description={selectedProduct.value
            ? i18n.t('payment.pay.orderSelected', { name: selectedProduct.value.name, price: selectedProduct.value.price })
            : i18n.t('payment.pay.orderEmpty')}
        >
          {selectedProduct.value && (
            <div class="demo-button-row">
              <Button
                variant="brand"
                icon={<Icon name="check-circle" />}
                loading={paying.value}
                disabled={paying.value}
                onClick={handlePay}
              >
                {i18n.t('payment.pay.payWithAlipay')}
              </Button>
              <Button
                variant="ghost"
                disabled={paying.value}
                onClick={() => { selectedProduct.value = null; paymentLog.value = ['>>> Waiting to start payment...'] }}
              >
                {i18n.t('common.reset')}
              </Button>
            </div>
          )}

          <pre class="demo-code demo-log">{paymentLog.value.join('\n')}</pre>
        </Card>
      </div>

      <Dialog
        open={dialogOpen.value}
        title={i18n.t('payment.config.title')}
        size="md"
        portal={portal}
        portalTarget={document.body}
        onClose={() => { dialogOpen.value = false }}
      >
        <form class="demo-form" onSubmit={event => { event.preventDefault(); dialogOpen.value = false }}>
          <label class="demo-field">
            <span>App ID</span>
            <Input bind={configAppId} placeholder="202100..." />
          </label>
          <label class="demo-field">
            <span>{i18n.t('payment.config.privateKey')}</span>
            <Input type="password" bind={configPrivateKey} placeholder="MII..." />
          </label>
          <label class="demo-field">
            <span>{i18n.t('payment.config.alipayPublicKey')}</span>
            <Input bind={configAlipayPublicKey} placeholder="MII..." />
          </label>
          <label class="demo-field">
            <span>{i18n.t('payment.config.notifyUrl')}</span>
            <Input bind={configNotifyUrl} placeholder="https://example.com/notify" />
          </label>
          <label class="demo-field">
            <span>{i18n.t('payment.config.returnUrl')}</span>
            <Input bind={configReturnUrl} placeholder="https://example.com/return" />
          </label>
          <div class="demo-button-row" style="margin-top: var(--spacer-16)">
            <Button type="submit" variant="brand" icon={<Icon name="check" />}>{i18n.t('common.save')}</Button>
            <Button type="button" variant="ghost" onClick={() => { dialogOpen.value = false }}>Cancel</Button>
          </div>
        </form>
      </Dialog>
    </KitPage>
  )
}
