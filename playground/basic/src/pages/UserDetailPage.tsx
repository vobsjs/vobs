import { useRoute, useRouter } from '@vobs/router'
import { Alert, Button, Card, Icon, Tag } from '@vobs/ui'
import { KitPage } from '@vobs/kit'
import { useI18n } from '@vobs/i18n'
import { findUserById, playgroundUsers } from '../data/users'

export function UserDetailPage() {
  const route = useRoute()
  const router = useRouter()
  const i18n = useI18n()

  function currentId(): number {
    return Number(route.value.params.id)
  }

  function navigateWith(target: { query?: Record<string, unknown>; hash?: string }): void {
    void router.push({ path: `/users/${currentId()}`, ...target })
  }

  function stepUser(delta: number): void {
    const index = playgroundUsers.findIndex(user => user.id === currentId())
    if (index < 0) return
    const next = playgroundUsers[(index + delta + playgroundUsers.length) % playgroundUsers.length]!
    void router.push(`/users/${next.id}`)
  }

  return (
    <KitPage class="demo-shell" title={i18n.t('user.title')} description={i18n.t('user.description')} actions={<Tag tone="brand">@vobs/router</Tag>}>
      {findUserById(route.value.params.id) ? (
        <div class="demo-section-grid">
          <Card title={i18n.t('user.profileTitle')} description={i18n.t('user.profileDescription')}>
            <div class="demo-control-stack">
              <Tag tone="brand">{i18n.t('resource.name')}: {findUserById(route.value.params.id)?.name ?? '-'}</Tag>
              <Tag>{i18n.t('resource.role')}: {findUserById(route.value.params.id)?.role ?? '-'}</Tag>
              <Tag tone={findUserById(route.value.params.id)?.status === 'Active' ? 'success' : 'warning'}>{findUserById(route.value.params.id)?.status ?? '-'}</Tag>
              <div class="demo-button-row">
                <Button variant="ghost" icon={<Icon name="chevron-left" />} onClick={() => { stepUser(-1) }}>{i18n.t('user.previous')}</Button>
                <Button variant="ghost" onClick={() => { stepUser(1) }}>{i18n.t('user.next')}<Icon name="chevron-right" /></Button>
              </div>
            </div>
          </Card>
          <Card title={i18n.t('user.routeInfoTitle')} description={i18n.t('user.routeInfoDescription')}>
            <div class="demo-control-stack">
              <span class="demo-muted">{i18n.t('user.path')}: <code>{route.value.path}</code></span>
              <span class="demo-muted">{i18n.t('user.fullPath')}: <code>{route.value.fullPath}</code></span>
              <span class="demo-muted">{i18n.t('user.paramId')}: <code>{route.value.params.id}</code></span>
              <span class="demo-muted">{i18n.t('user.query')}: <code>{JSON.stringify(route.value.query)}</code></span>
              <span class="demo-muted">{i18n.t('user.hash')}: <code>{route.value.hash || '-'}</code></span>
            </div>
          </Card>
          <Card title={i18n.t('user.navTitle')} description={i18n.t('user.navDescription')}>
            <div class="demo-control-stack">
              <div class="demo-button-row">
                <Button variant="secondary" onClick={() => { navigateWith({ query: { from: 'detail', tab: 'roles' } }) }}>{i18n.t('user.pushQuery')}</Button>
                <Button variant="secondary" onClick={() => { navigateWith({ hash: 'profile' }) }}>{i18n.t('user.pushHash')}</Button>
                <Button variant="secondary" onClick={() => { navigateWith({ query: {}, hash: '' }) }}>{i18n.t('user.pushClear')}</Button>
              </div>
              <div class="demo-button-row">
                <Button variant="ghost" onClick={() => { router.back() }}>{i18n.t('user.back')}</Button>
                <Button variant="ghost" onClick={() => { void router.push('/users') }}>{i18n.t('user.toList')}</Button>
              </div>
            </div>
          </Card>
        </div>
      ) : (
        <Alert tone="danger" title={i18n.t('user.notFoundTitle')} description={i18n.t('user.notFoundDescription', { id: String(route.value.params.id) })} icon={<Icon name="alert-triangle" />} />
      )}
    </KitPage>
  )
}
