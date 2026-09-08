import { useAuth } from '@vobs/auth'
import { useI18n } from '@vobs/i18n'
import { useLogger } from '@vobs/logger'
import { useRouter } from '@vobs/router'
import { state } from '@vobs/vobs'
import { Alert, Button, Card, Icon, StatCard, StatCardGrid, Tag } from '@vobs/ui'
import { KitPage } from '@vobs/kit'

export function DashboardPage() {
  const router = useRouter()
  const auth = useAuth()
  const i18n = useI18n()
  const logger = useLogger()
  const lastAction = state('dashboard.lastAction', 'dashboard.lastAction')

  function go(path: string, label: string): void {
    lastAction.value = label
    logger.info('Playground navigation', { path })
    void router.push(path)
  }

  return (
    <KitPage
      class="demo-shell"
      title={i18n.t('dashboard.title')}
      description={i18n.t('dashboard.description')}
      actions={<Tag tone="success">{i18n.t('dashboard.systemsReady')}</Tag>}
    >
      <Alert
        tone="info"
        title={i18n.t('dashboard.integrationTitle')}
        description={i18n.t('dashboard.integrationDescription')}
        icon={<Icon name="info" />}
      />

      <StatCardGrid>
        <StatCard label={i18n.t('dashboard.officialPackages')} value="20+" delta={i18n.t('dashboard.growing')} deltaDirection="up" deltaIcon={<Icon name="arrow-up" />} />
        <StatCard label={i18n.t('dashboard.currentRoute')} value={router.currentRoute.value.path} delta={i18n.t('dashboard.browserHistory')} deltaCaption="routerPlugin" />
        <StatCard label={i18n.t('dashboard.signedInUser')} value={auth.session.value?.user.id ?? 'anonymous'} delta={i18n.t('dashboard.authenticated')} deltaDirection="up" />
        <StatCard label={i18n.t('dashboard.locale')} value={i18n.locale.value} delta={i18n.formatNumber(265)} deltaCaption={i18n.t('dashboard.sampleFormat')} />
      </StatCardGrid>

      <Card title={i18n.t('dashboard.startTitle')} description={i18n.t('dashboard.startDescription')}>
          <div class="demo-action-grid">
            <Button variant="brand" icon={<Icon name="menu" />} onClick={() => go('/users', i18n.t('dashboard.openedResource'))}>{i18n.t('dashboard.resourceTable')}</Button>
            <Button variant="secondary" icon={<Icon name="sparkles" />} onClick={() => go('/components', i18n.t('dashboard.openedComponents'))}>{i18n.t('dashboard.uiGallery')}</Button>
            <Button variant="secondary" icon={<Icon name="edit" />} onClick={() => go('/forms', i18n.t('dashboard.openedForms'))}>{i18n.t('dashboard.formsValidation')}</Button>
            <Button variant="secondary" icon={<Icon name="zap" />} onClick={() => go('/async', i18n.t('dashboard.openedAsync'))}>{i18n.t('dashboard.asyncWorkbench')}</Button>
            <Button variant="secondary" icon={<Icon name="code" />} onClick={() => go('/runtime', i18n.t('dashboard.openedRuntime'))}>{i18n.t('dashboard.runtimeTitle')}</Button>
            <Button variant="secondary" icon={<Icon name="atom" />} onClick={() => go('/ssr', i18n.t('dashboard.openedSSR'))}>{i18n.t('dashboard.ssrTitle')}</Button>
          </div>
      </Card>

      <div class="demo-activity">
        <Icon name="check-circle" />
        <span>{lastAction.value === 'dashboard.lastAction' ? i18n.t('common.ready') : lastAction.value}</span>
      </div>
    </KitPage>
  )
}
