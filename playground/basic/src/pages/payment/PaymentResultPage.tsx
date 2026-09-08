import { Alert, Button, Card, Icon, Tag } from '@vobs/ui'
import { KitPage } from '@vobs/kit'
import { useRouter, useRoute } from '@vobs/router'
import { useI18n } from '@vobs/i18n'

export function PaymentResultPage() {
  const router = useRouter()
  const route = useRoute()
  const i18n = useI18n()

  const state = route.value.state as Record<string, string> | undefined
  const outTradeNo = state?.outTradeNo ?? 'N/A'
  const totalAmount = state?.totalAmount ?? '0.00'
  const subject = state?.subject ?? 'N/A'
  const tradeStatus = state?.tradeStatus ?? 'TRADE_CLOSED'
  const gmtPayment = state?.gmtPayment ?? 'N/A'
  const isSuccess = tradeStatus === 'TRADE_SUCCESS' || tradeStatus === 'TRADE_FINISHED'

  return (
    <KitPage
      class="demo-shell"
      title={i18n.t('payment.result.title')}
      description={i18n.t('payment.result.description')}
      actions={<Tag tone="brand">@vobs/payment/alipay</Tag>}
    >
      <Alert
        tone={isSuccess ? 'success' : 'warning'}
        title={isSuccess ? i18n.t('payment.result.successTitle') : i18n.t('payment.result.failTitle')}
        description={isSuccess ? i18n.t('payment.result.successDescription') : i18n.t('payment.result.failDescription')}
        icon={<Icon name={isSuccess ? 'check-circle' : 'alert-triangle'} />}
      />

      <div class="demo-form-layout">
        <Card title={i18n.t('payment.result.orderTitle')} description={i18n.t('payment.result.orderDescription')}>
          <div class="demo-result-detail">
            <div class="demo-result-row">
              <span class="demo-result-label">{i18n.t('payment.result.outTradeNo')}</span>
              <span class="demo-result-value">{outTradeNo}</span>
            </div>
            <div class="demo-result-row">
              <span class="demo-result-label">{i18n.t('payment.result.subject')}</span>
              <span class="demo-result-value">{subject}</span>
            </div>
            <div class="demo-result-row">
              <span class="demo-result-label">{i18n.t('payment.result.totalAmount')}</span>
              <span class="demo-result-value demo-result-amount">¥{totalAmount}</span>
            </div>
            <div class="demo-result-row">
              <span class="demo-result-label">{i18n.t('payment.result.tradeStatus')}</span>
              <span class="demo-result-value">
                <Tag tone={isSuccess ? 'success' : 'danger'}>{tradeStatus}</Tag>
              </span>
            </div>
            <div class="demo-result-row">
              <span class="demo-result-label">{i18n.t('payment.result.gmtPayment')}</span>
              <span class="demo-result-value">{gmtPayment}</span>
            </div>
          </div>
        </Card>

        <Card title={i18n.t('payment.result.notifyTitle')} description={i18n.t('payment.result.notifyDescription')}>
          {isSuccess ? (
            <>
              <Alert
                tone="success"
                title={i18n.t('payment.result.notifyReceived')}
                description={i18n.t('payment.result.notifyVerified')}
              />
              <pre class="demo-code">{`// 异步通知处理
import { createNotifyHandler } from '@vobs/payment/alipay'

const handler = createNotifyHandler(client)

// 1. 验签
const valid = handler.verify(notifyParams)
if (!valid) {
  return handler.failResponse()
}

// 2. 校验业务字段
const result = handler.validate(notifyParams)
if (!result.valid) {
  return handler.failResponse()
}

// 3. 处理业务逻辑（幂等）
await processOrder(notifyParams.outTradeNo)

// 4. 返回 success
return handler.successResponse()`}</pre>
            </>
          ) : (
            <Alert
              tone="warning"
              title={i18n.t('payment.result.notifyMissed')}
              description={i18n.t('payment.result.notifyQuery')}
            />
          )}
        </Card>

        <div class="demo-button-row">
          <Button variant="brand" icon={<Icon name="arrow-right" />} onClick={() => void router.push('/payment')}>
            {i18n.t('payment.result.backToShop')}
          </Button>
          <Button variant="secondary" icon={<Icon name="settings" />} onClick={() => void router.push('/payment/config')}>
            {i18n.t('payment.config.title')}
          </Button>
        </div>
      </div>
    </KitPage>
  )
}