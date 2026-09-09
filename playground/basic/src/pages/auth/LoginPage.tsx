import { useAuth } from '@vobs/auth'
import { useJWTAuth } from '@vobs/jwt-auth'
import { useRoute, useRouter } from '@vobs/router'
import { onDispose, state } from '@vobs/vobs'
import { Alert, Button, Card, Icon, Input, Tag } from '@vobs/ui'
import { KitPage } from '@vobs/kit'
import { useI18n } from '@vobs/i18n'
import { callProtectedApi, fetchProtectedWithReplay, getTokenInfo, jwtAuth } from '../../plugins/jwt-auth'

export function LoginPage() {
  const auth = useAuth()
  const i18n = useI18n()
  const route = useRoute()
  const router = useRouter()
  const mode = state<'session' | 'jwt'>('session')
  const username = state('playground')
  const password = state('')
  const submitting = state(false)
  const error = state('')

  async function submit(event: Event): Promise<void> {
    event.preventDefault()
    submitting.value = true
    error.value = ''
    try {
      if (mode.value === 'jwt') {
        await jwtAuth.login({ username: username.value, password: password.value })
      } else {
        await auth.login({ username: username.value, password: password.value })
        const redirect = typeof route.value.query.redirect === 'string' ? route.value.query.redirect : '/'
        await router.replace(redirect)
      }
    } catch (reason) {
      error.value = reason instanceof Error ? reason.message : String(reason)
    } finally {
      submitting.value = false
    }
  }

  return (
    <KitPage class="demo-shell" title={i18n.t('auth.title')} description={i18n.t('auth.description')} actions={<Tag tone="brand">@vobs/auth</Tag>}>
      <Card title={i18n.t('auth.accountTitle')} description={i18n.t('auth.accountDescription')}>
        <div class="demo-button-row" aria-label={i18n.t('auth.modeLabel')}>
          <Button variant={mode.value === 'session' ? 'brand' : 'ghost'} icon={<Icon name="lock" />} onClick={() => { mode.value = 'session' }}>{i18n.t('auth.modeSession')}</Button>
          <Button variant={mode.value === 'jwt' ? 'brand' : 'ghost'} icon={<Icon name="key" />} onClick={() => { mode.value = 'jwt' }}>{i18n.t('auth.modeJwt')}</Button>
        </div>
        <form class="demo-form" onSubmit={submit}>
          <label class="demo-labeled-control">{i18n.t('auth.username')}<Input bind={username} /></label>
          <label class="demo-labeled-control">{i18n.t('auth.password')}<Input type="password" bind={password} /></label>
          {error.value ? <Alert tone="danger" title={i18n.t('auth.signInFailed')} description={error.value} icon={<Icon name="alert-circle" />} /> : null}
          <div class="demo-button-row">
            <Button type="submit" variant="brand" loading={submitting.value} icon={<Icon name="arrow-right" />}>{mode.value === 'jwt' ? i18n.t('auth.jwtSignIn') : i18n.t('common.signIn')}</Button>
            <Button type="button" variant="ghost" onClick={() => { void router.push('/') }}>{i18n.t('common.backHome')}</Button>
          </div>
        </form>
        {mode.value === 'jwt' ? <JwtConsole /> : null}
      </Card>
    </KitPage>
  )
}

function JwtConsole() {
  const jwt = useJWTAuth()
  const i18n = useI18n()
  const nowSeconds = state(Math.floor(Date.now() / 1000))
  const apiResult = state('')
  const apiError = state('')
  const calling = state(false)
  const timer = setInterval(() => { nowSeconds.value = Math.floor(Date.now() / 1000) }, 1000)
  onDispose(() => { clearInterval(timer) })

  async function runCall(kind: 'raw' | 'replay'): Promise<void> {
    calling.value = true
    apiError.value = ''
    apiResult.value = ''
    try {
      apiResult.value = kind === 'replay'
        ? await fetchProtectedWithReplay()
        : await callProtectedApi(jwt.getAccessToken())
    } catch (reason) {
      apiError.value = reason instanceof Error ? reason.message : String(reason)
    } finally {
      calling.value = false
    }
  }

  const info = getTokenInfo(jwt.accessToken.value)
  const remaining = info ? info.payload.exp - nowSeconds.value : 0

  return (
    <Card title={i18n.t('auth.jwtConsoleTitle')} description={i18n.t('auth.jwtConsoleDescription')}>
      <div class="demo-control-stack">
        <Tag tone={info ? (remaining > 0 ? 'success' : 'danger') : 'neutral-strong'}>
          {info
            ? (remaining > 0 ? i18n.t('auth.jwtRemaining', { value: remaining }) : i18n.t('auth.jwtExpired'))
            : i18n.t('auth.jwtNoToken')}
        </Tag>
        {info ? (
          <div class="demo-control-stack">
            <span class="demo-muted">{i18n.t('auth.jwtSub')}: <code>{info.payload.sub}</code></span>
            <span class="demo-muted">{i18n.t('auth.jwtExp')}: <code>{new Date(info.payload.exp * 1000).toLocaleTimeString()}</code></span>
            <span class="demo-muted">{i18n.t('auth.jwtToken')}: <code>{info.token.slice(0, 40)}...</code></span>
          </div>
        ) : null}
        <div class="demo-button-row">
          <Button size="sm" variant="secondary" disabled={!info} loading={calling.value} onClick={() => { void runCall('raw') }}>{i18n.t('auth.jwtCallRaw')}</Button>
          <Button size="sm" variant="brand" disabled={!info} loading={calling.value} onClick={() => { void runCall('replay') }}>{i18n.t('auth.jwtCallReplay')}</Button>
          <Button size="sm" variant="ghost" disabled={!info} onClick={() => { void jwt.refreshToken().catch(() => { /* onAuthFailure 已清理会话 */ }) }}>{i18n.t('auth.jwtRefresh')}</Button>
          <Button size="sm" variant="ghost" disabled={!info} onClick={() => { void jwt.logout() }}>{i18n.t('common.signOut')}</Button>
        </div>
        {apiResult.value ? <Alert tone="success" title={i18n.t('auth.jwtCallOk')} description={apiResult.value} icon={<Icon name="check-circle" />} /> : null}
        {apiError.value ? <Alert tone="danger" title={i18n.t('auth.jwtCallFailed')} description={apiError.value} icon={<Icon name="alert-triangle" />} /> : null}
        <span class="demo-muted">{i18n.t('auth.jwtHint')}</span>
      </div>
    </Card>
  )
}
