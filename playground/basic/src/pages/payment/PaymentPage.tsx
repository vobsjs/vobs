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
    name: 'Vobs 框架授权 - 基础版',
    price: '299.00',
    description: '适用于个人开发者和小型团队，包含核心框架及所有官方扩展包。',
    image: '📦'
  },
  {
    id: 'prod_002',
    name: 'Vobs 框架授权 - 专业版',
    price: '999.00',
    description: '适用于中型团队，包含基础版全部功能 + 高级扩展包和企业级支持。',
    image: '🚀'
  },
  {
    id: 'prod_003',
    name: 'Vobs 框架授权 - 企业版',
    price: '4999.00',
    description: '适用于大型企业，全功能授权 + 专属技术支持 + 定制化开发服务。',
    image: '🏢'
  }
]

export function PaymentPage() {
  const router = useRouter()
  const i18n = useI18n()
  const selectedProduct = state<Product | null>(null)
  const paying = state(false)
  const paymentLog = state<string[]>(['>>> 等待发起支付...'])
  const dialogOpen = state(false)
  const portal = createDOMPortalAdapter()
  const configAppId = state('')
  const configPrivateKey = state('')
  const configAlipayPublicKey = state('')
  const configNotifyUrl = state('')
  const configReturnUrl = state('')

  onDispose(() => {
    selectedProduct.value = null
    paying.value = false
  })

  function addLog(msg: string): void {
    paymentLog.value = [...paymentLog.value, `>>> ${msg}`]
  }

  function selectProduct(product: Product): void {
    selectedProduct.value = product
    paymentLog.value = ['>>> 已选择商品，等待发起支付...']
  }

  async function handlePay(): Promise<void> {
    if (!selectedProduct.value) return
    const product = selectedProduct.value
    paying.value = true
    addLog(`发起支付: ${product.name} (¥${product.price})`)
    addLog('调用 AlipayClient.pagePay()...')
    addLog('生成订单号: ' + `ORDER${Date.now()}`)
    addLog('调用 alipay.trade.page.pay API...')
    addLog('收到支付宝 HTML 表单...')

    // 模拟支付延迟
    await new Promise(resolve => setTimeout(resolve, 1500))

    addLog('支付表单已生成，跳转至支付宝收银台...')
    paying.value = false

    // 跳转到结果页
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
                onClick={() => { selectedProduct.value = null; paymentLog.value = ['>>> 等待发起支付...'] }}
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
            <Button type="button" variant="ghost" onClick={() => { dialogOpen.value = false }}>取消</Button>
          </div>
        </form>
      </Dialog>
    </KitPage>
  )
}
