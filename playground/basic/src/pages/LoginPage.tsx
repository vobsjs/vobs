import { useAuth } from '@vobs/auth'
import { useRoute, useRouter } from '@vobs/router'
import { state } from '@vobs/vobs'
import { Alert, Button, Card, Icon, Input, Tag } from '@vobs/ui'
import { KitPage } from '@vobs/kit'
import { useI18n } from '@vobs/i18n'

export function LoginPage() {
  const auth = useAuth()
  const i18n = useI18n()
  const route = useRoute()
  const router = useRouter()
  const username = state('playground', 'auth.login.username')
  const password = state('', 'auth.login.password')
  const submitting = state(false, 'auth.login.submitting')
  const error = state('', 'auth.login.error')

  async function submit(event: Event): Promise<void> {
    event.preventDefault()
    submitting.value = true
    error.value = ''
    try {
      await auth.login({ username: username.value, password: password.value })
      const redirect = typeof route.value.query.redirect === 'string' ? route.value.query.redirect : '/'
      await router.replace(redirect)
    } catch (reason) {
      error.value = reason instanceof Error ? reason.message : String(reason)
    } finally {
      submitting.value = false
    }
  }

  return (
    <KitPage class="demo-shell" title={i18n.t('auth.title')} description={i18n.t('auth.description')} actions={<Tag tone="brand">@vobs/auth</Tag>}>
      <Card title={i18n.t('auth.accountTitle')} description={i18n.t('auth.accountDescription')}>
        <form class="demo-form" onSubmit={submit}>
          <label class="demo-labeled-control">{i18n.t('auth.username')}<Input value={username.value} onInput={event => { username.value = (event.target as HTMLInputElement).value }} /></label>
          <label class="demo-labeled-control">{i18n.t('auth.password')}<Input type="password" value={password.value} onInput={event => { password.value = (event.target as HTMLInputElement).value }} /></label>
          {error.value ? <Alert tone="danger" title={i18n.t('auth.signInFailed')} description={error.value} icon={<Icon name="alert-circle" />} /> : null}
          <div class="demo-button-row"><Button type="submit" variant="brand" loading={submitting.value} icon={<Icon name="arrow-right" />}>{i18n.t('common.signIn')}</Button><Button type="button" variant="ghost" onClick={() => { void router.push('/') }}>{i18n.t('common.backHome')}</Button></div>
        </form>
      </Card>
    </KitPage>
  )
}
