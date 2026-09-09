import { createComponent, state } from '@vobs/vobs'
import { KitFilterBar, KitPage, KitPageActions, KitResourcePage } from '@vobs/kit'
import { ResourceBoundary } from '@vobs/resource'
import {
  createDefaultColumnSettings,
  KitDataTable,
  KitColumnSettings,
  normalizeColumnSettings,
  type DataTableColumn,
  type DataTableColumnSettings
} from '@vobs/table'
import { Button, Card, Icon, Tag } from '@vobs/ui'
import { useRouter } from '@vobs/router'
import {
  usersColumnSettingsPersistence,
  usersResource,
  usersSearch,
  usersStatus,
  resourceScenario,
  scenarioResource,
  serverPage,
  serverPageSize,
  serverUsersResource,
  type PlaygroundUser
} from '../../data/users'
import { PageSearchBar } from '../../components/PageSearchBar'
import { useI18n } from '@vobs/i18n'

export function ResourceTablePage() {
  const i18n = useI18n()
  const router = useRouter()
  const columns = [
    {
      id: 'name',
      label: i18n.t('resource.name'),
      key: 'name',
      sortable: true,
      filterable: true,
      filter: (user: PlaygroundUser, value: unknown) => `${user.name} ${user.role} ${user.status}`
        .toLocaleLowerCase().includes(String(value).toLocaleLowerCase())
    },
    { id: 'role', label: i18n.t('resource.role'), key: 'role', sortable: true, sortType: 'text', sortKey: 'role_name' },
    {
      id: 'status',
      label: i18n.t('resource.status'),
      key: 'status',
      render: (user: PlaygroundUser) => <Tag tone={user.status === 'Active' ? 'success' : 'warning'}>{user.status === 'Active' ? i18n.t('resource.active') : i18n.t('resource.invited')}</Tag>
    },
    {
      id: 'actions',
      label: i18n.t('resource.actions'),
      render: (user: PlaygroundUser) => (
        <Button size="sm" variant="ghost" icon={<Icon name="chevron-right" />} onClick={() => { void router.push({ path: `/users/${user.id}`, query: { from: 'table' } }) }}>
          {i18n.t('resource.viewDetail')}
        </Button>
      )
    }
  ] as const
  const columnSettings = state<DataTableColumnSettings>(normalizeColumnSettings(
    columns,
    usersColumnSettingsPersistence.load() ?? createDefaultColumnSettings(columns)
  ), 'resource.users.columnSettings')
  const currentPage = state(1)
  const currentPageSize = state(3)

  return (
    <>
      <KitResourcePage<PlaygroundUser>
      class="demo-shell"
      resource={usersResource}
      columns={columns}
      title={i18n.t('resource.title')}
      description={i18n.t('resource.description')}
      requiredPermission="users.read"
      toolbar={
        <KitFilterBar
          onSearch={() => { currentPage.value = 1 }}
          onReset={() => {
            usersSearch.value = ''
            usersStatus.value = ''
            currentPage.value = 1
          }}
          actions={
            <KitColumnSettings
              columns={columns}
              settings={columnSettings.value}
              persistence={usersColumnSettingsPersistence}
              onSettingsChange={settings => { columnSettings.value = settings }}
              trigger={<Button variant="secondary" icon={<Icon name="settings" />}>{i18n.t('resource.columns')}</Button>}
            />
          }
        >
            <PageSearchBar
              value={usersSearch}
              placeholder={i18n.t('resource.searchUsers')}
              ariaLabel={i18n.t('resource.searchUsers')}
              status={usersStatus}
              statusLabel={i18n.t('resource.filterStatus')}
              statusOptions={[
                { value: '', label: i18n.t('resource.allStatuses') },
                { value: 'Active', label: i18n.t('resource.active') },
                { value: 'Invited', label: i18n.t('resource.invited') }
              ]}
              onQueryChange={() => { currentPage.value = 1 }}
            />
        </KitFilterBar>
      }
      actions={
        <KitPageActions>
          <Button variant="brand" icon={<Icon name="refresh" />} onClick={() => { void usersResource.refetch() }}>{i18n.t('resource.refresh')}</Button>
        </KitPageActions>
      }
      tableProps={{
        rowKey: user => user.id,
        page: currentPage,
        pageSize: currentPageSize,
        pageSizeOptions: [3, 10, 25, 50, 100],
        paginationMode: 'all',
        sortingMode: 'client',
        get filters() {
          return {
            ...(usersSearch.value ? { name: usersSearch.value } : {}),
            ...(usersStatus.value ? { status: usersStatus.value } : {})
          }
        },
        virtual: true,
        virtualHeight: 220,
        get columnSettings() { return columnSettings.value }
      }}
      />
      <ResourceLab />
    </>
  )
}

function ResourceLab() {
  const i18n = useI18n()
  const scenarioColumns: readonly DataTableColumn<PlaygroundUser>[] = [
    { id: 'name', label: 'Name', key: 'name' },
    { id: 'role', label: 'Role', key: 'role' }
  ] as const
  const serverColumns = scenarioColumns
  const writeStatus = state(i18n.t('resource.noWrite'))
  const scenarioMessage = state(i18n.t('resource.scenarioReady'))

  const loadScenario = (next: typeof resourceScenario.value): void => {
    resourceScenario.value = next
    scenarioMessage.value = next === 'slow' ? i18n.t('resource.scenarioLoading') : i18n.t('resource.scenarioChanged', { scenario: i18n.t(`resource.${next}`) })
    void scenarioResource.refetch()
  }

  const cancelScenario = (): void => {
    resourceScenario.value = 'ready'
    scenarioMessage.value = i18n.t('resource.scenarioCancelled')
  }

  const runOptimisticWrite = (): void => {
    const current = usersResource.data.value ?? []
    const nextId = Math.max(...current.map(user => user.id), 0) + 100
    usersResource.mutate([...current, { id: nextId, name: `Optimistic User ${nextId}`, role: 'Contributor', status: 'Invited' }])
    writeStatus.value = i18n.t('resource.writeAdded')
  }

  const serverTable = () => createComponent(KitDataTable<PlaygroundUser>, {
    resource: serverUsersResource,
    columns: serverColumns,
    paginationMode: 'all',
    page: serverPage,
    pageSize: serverPageSize,
    pageSizeOptions: [2, 5]
  })

  return (
    <KitPage title={i18n.t('resource.scenarioTitle')} description={i18n.t('resource.scenarioDescription')}>
      <KitPageActions align="start">
        <Button size="sm" variant="secondary" onClick={() => loadScenario('ready')}>{i18n.t('resource.ready')}</Button>
        <Button size="sm" variant="secondary" onClick={() => loadScenario('empty')}>{i18n.t('resource.empty')}</Button>
        <Button size="sm" variant="danger-subtle" onClick={() => loadScenario('error')}>{i18n.t('resource.error')}</Button>
        <Button size="sm" variant="secondary" onClick={() => loadScenario('slow')}>{i18n.t('resource.slow')}</Button>
        <Button size="sm" variant="ghost" disabled={!scenarioResource.loading.value} onClick={cancelScenario}>{i18n.t('async.cancel')}</Button>
        <Button size="sm" variant="ghost" disabled={!scenarioResource.error.value} onClick={() => { scenarioMessage.value = i18n.t('resource.scenarioRetrying'); void scenarioResource.refetch() }}>{i18n.t('common.retry')}</Button>
        <Button size="sm" variant="ghost" onClick={runOptimisticWrite}>{i18n.t('resource.optimisticWrite')}</Button>
        <span aria-live="polite">{scenarioMessage.value} · {writeStatus.value}</span>
      </KitPageActions>
      <div class="demo-resource-lab__grid">
        <Card title="ResourceBoundary">
          <ResourceBoundary
            resource={scenarioResource}
            loading={() => <span aria-live="polite">{i18n.t('common.loading')}</span>}
            empty={() => <span class="demo-empty">{i18n.t('resource.noRows')}</span>}
            fallback={(error, retry) => <div class="demo-control-stack"><span class="demo-route-state--error">{error.message}</span><Button size="sm" variant="ghost" onClick={() => { void retry() }}>{i18n.t('common.retry')}</Button></div>}
            children={rows => <KitDataTable rows={rows} columns={scenarioColumns} />}
          />
        </Card>
        <Card title={i18n.t('resource.serverPagination')}>
          {serverTable()}
        </Card>
      </div>
    </KitPage>
  )
}
