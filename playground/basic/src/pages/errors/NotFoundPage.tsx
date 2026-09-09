import type { RouteLocation } from '@vobs/router'
import { useRouter } from '@vobs/router'
import { Button, Card, Icon } from '@vobs/ui'
import { useI18n } from '@vobs/i18n'

export function NotFoundPage(props: { readonly route: RouteLocation }) {
  const router = useRouter()
  const i18n = useI18n()
  return (
    <div class="demo-route-state demo-route-state--panel">
      <Card title={i18n.t('errors.pageNotFound')} description={i18n.t('errors.noRoute', { path: props.route.path })}>
        <Button variant="brand" icon={<Icon name="home" />} onClick={() => { void router.push('/') }}>{i18n.t('common.backOverview')}</Button>
      </Card>
    </div>
  )
}
