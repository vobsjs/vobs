import { state } from '@vobs/vobs'
import { Alert, Button, Card, Icon, Input, Tag } from '@vobs/ui'
import { KitPage } from '@vobs/kit'
import { useI18n } from '@vobs/i18n'

export function PaymentConfigPage() {
  const i18n = useI18n()
  const appId = state('')
  const privateKey = state('')
  const alipayPublicKey = state('')
  const notifyUrl = state('')
  const returnUrl = state('')
  const configSaved = state(false)

  function saveConfig(): void {
    configSaved.value = true
  }

  return (
    <KitPage
      class="demo-shell"
      title={i18n.t('payment.config.title')}
      description={i18n.t('payment.config.description')}
      actions={<Tag tone="brand">@vobs/payment/alipay</Tag>}
    >
      <Alert
        tone="warning"
        title={i18n.t('payment.config.securityTitle')}
        description={i18n.t('payment.config.securityDescription')}
      />

      <div class="demo-form-layout">
        <Card title={i18n.t('payment.config.configTitle')} description={i18n.t('payment.config.configDescription')}>
          <form class="demo-form" onSubmit={event => { event.preventDefault(); saveConfig() }}>
            <label class="demo-field">
              <span>App ID</span>
              <Input bind={appId} placeholder="202100..." />
            </label>
            <label class="demo-field">
              <span>{i18n.t('payment.config.privateKey')}</span>
              <Input type="password" bind={privateKey} placeholder="MII..." />
            </label>
            <label class="demo-field">
              <span>{i18n.t('payment.config.alipayPublicKey')}</span>
              <Input bind={alipayPublicKey} placeholder="MII..." />
            </label>
            <label class="demo-field">
              <span>{i18n.t('payment.config.notifyUrl')}</span>
              <Input bind={notifyUrl} placeholder="https://example.com/notify" />
            </label>
            <label class="demo-field">
              <span>{i18n.t('payment.config.returnUrl')}</span>
              <Input bind={returnUrl} placeholder="https://example.com/return" />
            </label>
            <div class="demo-button-row">
              <Button type="submit" variant="brand" icon={<Icon name="check" />}>{i18n.t('common.save')}</Button>
              <Button type="button" variant="ghost" onClick={() => { appId.value = ''; privateKey.value = ''; alipayPublicKey.value = ''; notifyUrl.value = ''; returnUrl.value = ''; configSaved.value = false }}>
                {i18n.t('common.reset')}
              </Button>
            </div>
          </form>
        </Card>

        <Card title={i18n.t('payment.config.integrationTitle')} description={i18n.t('payment.config.integrationDescription')}>
          <pre class="demo-code">{`import { AlipayClient, createPagePay } from '@vobs/payment/alipay'

// 独立使用
const client = new AlipayClient({
  appId: '202100...',
  privateKey: 'MII...',
  alipayPublicKey: 'MII...',
  notifyUrl: 'https://example.com/notify',
  returnUrl: 'https://example.com/return'
})

const pagePay = createPagePay(client)

// 发起电脑网站支付
const { formHtml } = await pagePay.pay({
  outTradeNo: 'ORDER' + Date.now(),
  totalAmount: '99.99',
  subject: '商品名称'
})

// 渲染 formHtml 到页面并自动提交`}</pre>
          {configSaved.value && (
            <Alert
              tone="success"
              title={i18n.t('payment.config.savedTitle')}
              description={i18n.t('payment.config.savedDescription')}
            />
          )}
        </Card>
      </div>
    </KitPage>
  )
}
