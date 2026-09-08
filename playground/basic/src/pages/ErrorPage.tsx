import { useRouter } from '@vobs/router'
import { Button, Card, Icon } from '@vobs/ui'
import { useI18n } from '@vobs/i18n'

export function ErrorPage(props: { readonly error: Error; readonly retry: () => void }) {
  const router = useRouter()
  const i18n = useI18n()
  return (
    <div class="demo-route-state demo-route-state--panel">
      <Card title={i18n.t('errors.routeFailed')} description={props.error.message}>
        <div class="demo-button-row">
          <Button variant="brand" icon={<Icon name="refresh" />} onClick={props.retry}>{i18n.t('common.retry')}</Button>
          <Button variant="ghost" icon={<Icon name="home" />} onClick={() => { void router.push('/') }}>{i18n.t('common.backOverview')}</Button>
        </div>
      </Card>
    </div>
  )
}
