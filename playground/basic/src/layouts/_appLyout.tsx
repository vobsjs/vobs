import { KitLayout, KitSidebar, useKitLayout, type KitMenuItem } from '@vobs/kit'
import { useAuth } from '@vobs/auth'
import { useRoute, useRouter } from '@vobs/router'
import { Button, Icon, StatusBar, Switch, Tag, ToastHost } from '@vobs/ui'
import type { LayoutChildren } from '@vobs/layout'
import { useI18n } from '@vobs/i18n'
import { useNotification } from '@vobs/notification'
import { getDevTools } from '@vobs/devtools'
import { onDispose, state } from '@vobs/vobs'
import { playgroundThemeMode } from '../theme'

export interface AppLayoutProps {
  readonly children?: LayoutChildren
}

export function AppLayout(props: AppLayoutProps) {
  const route = useRoute()
  const router = useRouter()
  const i18n = useI18n()
  const activeKey = route.value.path === '/' ? '' : route.value.path.slice(1)
  const menuItems: readonly KitMenuItem[] = [
    {
      key: '',
      label: i18n.t('nav.overview'),
      icon: <Icon name="home" />
    },
    {
      key: 'users',
      label: i18n.t('nav.resourceTable'),
      icon: <Icon name="menu" />
    },
    {
      key: 'captcha',
      label: i18n.t('nav.captcha'),
      icon: <Icon name="check-circle" />
    },
    {
      key: 'components',
      label: i18n.t('nav.components'),
      icon: <Icon name="sparkles" />
    },
    {
      key: 'forms',
      label: i18n.t('nav.forms'),
      icon: <Icon name="edit" />
    },
    {
      key: 'data',
      label: i18n.t('nav.data'),
      icon: <Icon name="folder" />
    },
    {
      key: 'async',
      label: i18n.t('nav.async'),
      icon: <Icon name="zap" />
    },
    {
      key: 'runtime',
      label: i18n.t('nav.runtime'),
      icon: <Icon name="code" />
    },
    {
      key: 'ssr',
      label: i18n.t('nav.ssr'),
      icon: <Icon name="atom" />
    },
    {
      key: 'payment',
      label: i18n.t('nav.payment'),
      icon: <Icon name="zap" />
    },
    {
      key: 'errors',
      label: i18n.t('nav.errors'),
      icon: <Icon name="alert-triangle" />
    },
  ]

  const handleMenuSelect = (key: string) => {
    void router.push(key ? `/${key}` : '/')
  }

  return (
    <KitLayout
      class="demo-layout"
      logo={<span class="demo-logo">V</span>}
      headerActions={() => <HeaderActions />}
      userMenu={<UserMenu />}
      activeKey={activeKey}
      sidebarWidth={216}
      sidebar={() => (
        <PlaygroundSidebar
          items={menuItems}
          onSelect={handleMenuSelect}
        />
      )}
      footer={<PlaygroundStatusBar />}
    >
      {props.children}
      <ToastHost position="top-right" />
    </KitLayout>
  )
}

function HeaderActions() {
  const i18n = useI18n()
  const notification = useNotification()
  const localeLoading = state(false, 'playground.localeLoading')

  const handleLocaleToggle = (): void => {
    const next = i18n.locale.value === 'en-US' ? 'zh-CN' : 'en-US'
    localeLoading.value = true
    void i18n.loadLocale(next).then(() => {
      i18n.setLocale(next)
    }).catch(error => {
      notification.error(error instanceof Error ? error.message : String(error))
    }).finally(() => { localeLoading.value = false })
  }

  return (
    <div class="demo-header-controls">
      <div class="demo-header-control">
        <Switch
          checked={playgroundThemeMode.value === 'dark'}
          aria-label={i18n.t('common.darkTheme')}
          title={i18n.t('common.darkTheme')}
          onChange={event => { playgroundThemeMode.value = (event.target as HTMLInputElement).checked ? 'dark' : 'light' }}
        />
      </div>
      <Button size="sm" variant="ghost" loading={localeLoading.value} disabled={localeLoading.value} onClick={handleLocaleToggle}>
        {i18n.locale.value === 'en-US' ? '中文' : 'English'}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        iconOnly
        icon={<Icon name="bell" />}
        aria-label={i18n.t('dashboard.sendNotification')}
        title={i18n.t('dashboard.sendNotification')}
        onClick={() => notification.success(i18n.t('dashboard.notificationBody'), { title: 'ToastHost' })}
      />
    </div>
  )
}

function UserMenu() {
  const auth = useAuth()
  const router = useRouter()
  const i18n = useI18n()

  const handleSignOut = () => {
    auth.logout()
    void router.replace('/login')
  }

  const handleSignIn = () => {
    void router.push('/login')
  }

  return (
    <div class="demo-user-menu">
      <Tag tone="brand">{auth.session.value?.user.id ?? 'anonymous'}</Tag>
      {auth.session.value ? (
        <Button size="sm" variant="ghost" onClick={handleSignOut}>
          {i18n.t('common.signOut')}
        </Button>
      ) : (
        <Button size="sm" variant="ghost" onClick={handleSignIn}>
          {i18n.t('common.signIn')}
        </Button>
      )}
    </div>
  )
}

function PlaygroundStatusBar() {
  const i18n = useI18n()
  const errorCount = state(getDevTools()?.getErrors().length ?? 0, 'playground.errorCount')
  const devtools = getDevTools()
  if (devtools) {
    const updateErrorCount = () => { errorCount.value = devtools.getErrors().length }
    const unsubscribeError = devtools.subscribe('error', updateErrorCount)
    const unsubscribeCleared = devtools.subscribe('collection-cleared', updateErrorCount)
    onDispose(() => {
      unsubscribeError()
      unsubscribeCleared()
    })
  }

  return (
    <StatusBar
      class="demo-statusbar"
      left={[
        { icon: <Icon name="code" />, label: 'playground' },
        { dot: 'success', label: i18n.t('common.ready') },
        { icon: <Icon name="check-circle" />, label: () => `${errorCount.value} Errors` }
      ]}
      right={[
        { label: 'Vobs v1' },
        { icon: <Icon name="home" />, label: 'Local' }
      ]}
    />
  )
}

interface PlaygroundSidebarProps {
  readonly items: readonly KitMenuItem[]
  readonly onSelect: (key: string, item: KitMenuItem) => void
}

function PlaygroundSidebar(props: PlaygroundSidebarProps) {
  const layout = useKitLayout()
  const route = useRoute()

  return (
    <KitSidebar
      class="demo-sidebar"
      items={props.items}
      activeKey={route.value.path === '/' ? '' : route.value.path.slice(1)}
      collapsed={layout.sidebarCollapsed.value}
      mobileOpen={layout.mobileOpen.value}
      footer={
        <SidebarToggle />
      }
      onClose={() => layout.setMobileOpen(false)}
      onSelect={props.onSelect}
    />
  )
}

function SidebarToggle() {
  const layout = useKitLayout()

  return (
    <Button
      class="demo-sidebar-toggle"
      variant="ghost"
      iconOnly
      icon={<Icon name="chevron-left" />}
      aria-label="Toggle sidebar"
      title="Toggle sidebar"
      onClick={() => layout.toggleSidebar()}
    />
  )
}
