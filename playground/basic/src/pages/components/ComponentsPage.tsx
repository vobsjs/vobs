import { state } from '@vobs/vobs'
import { KitPage } from '@vobs/kit'
import {
  ActivityRail,
  Alert,
  Avatar,
  Button,
  ButtonGroup,
  Card,
  Checkbox,
  ChatComposer,
  Dialog,
  Drawer,
  EditorTabs,
  FileTree,
  Icon,
  Input,
  Radio,
  Select,
  Switch,
  Table,
  Tabs,
  Tag,
  Textarea
} from '@vobs/ui'
import { Transition } from '@vobs/transition'
import { useI18n } from '@vobs/i18n'

const sampleRows = [
  { name: 'Vobs runtime', state: 'Stable', owner: 'Core' },
  { name: 'Signal graph', state: 'Live', owner: 'Reactivity' },
  { name: 'DOM renderer', state: 'Ready', owner: 'Runtime' }
]

export function ComponentsPage() {
  const i18n = useI18n()
  const dialogOpen = state(false)
  const drawerOpen = state(false)
  const feedbackState = state<'success' | 'empty' | 'error'>('success')
  const overlayMessage = state(i18n.t('components.noOverlay'))
  const inputValue = state('Try editing this input')
  const textareaValue = state('A textarea with a real DOM binding.')
  const selectValue = state('signals')
  const rememberChoice = state(true)
  const choice = state('core')
  const featureEnabled = state(true)
  const tab = state('overview')
  const composerValue = state('')
  const activity = state('files')
  const selectedFile = state('runtime')
  const editorTabs = state([
    { id: 'runtime', label: 'runtime.ts', icon: <Icon name="code" />, closeable: true },
    { id: 'readme', label: 'README.md', closeable: true }
  ])

  return (
    <KitPage
      class="demo-shell"
      title={i18n.t('components.title')}
      description={i18n.t('components.description')}
      actions={<Tag tone="brand">{i18n.t('components.interactive')}</Tag>}
    >
      <div class="demo-section-grid">
        <Card title={i18n.t('components.actionsTitle')} description={i18n.t('components.actionsDescription')}>
          <div class="demo-control-stack">
            <ButtonGroup>
              <Button variant="brand" onClick={() => { feedbackState.value = 'success' }}>{i18n.t('components.primary')}</Button>
              <Button variant="secondary" onClick={() => { feedbackState.value = 'empty' }}>{i18n.t('components.emptyState')}</Button>
              <Button variant="danger" onClick={() => { feedbackState.value = 'error' }}>{i18n.t('components.danger')}</Button>
            </ButtonGroup>
            <div class="demo-chip-row"><Tag tone="success">{i18n.t('components.success')}</Tag><Tag tone="warning">{i18n.t('components.warning')}</Tag><Tag tone="danger">{i18n.t('components.error')}</Tag><Tag tone="count">3</Tag></div>
            <Transition show={feedbackState.value !== 'empty'} name="notice" duration={140}>
              <Alert tone={feedbackState.value === 'error' ? 'danger' : 'success'} title={feedbackState.value === 'error' ? i18n.t('components.failureState') : i18n.t('components.transitionTitle')} description={feedbackState.value === 'error' ? i18n.t('components.errorDescription') : i18n.t('components.transitionDescription')} icon={<Icon name={feedbackState.value === 'error' ? 'alert-triangle' : 'check-circle'} />} />
            </Transition>
            {feedbackState.value === 'empty' ? <span class="demo-empty">{i18n.t('components.emptyDescription')}</span> : null}
            <div class="demo-button-row">
              <Button onClick={() => { dialogOpen.value = true }}>{i18n.t('components.openDialog')}</Button>
              <Button variant="secondary" onClick={() => { drawerOpen.value = true }}>{i18n.t('components.openDrawer')}</Button>
            </div>
            <span class="demo-muted" aria-live="polite">{overlayMessage.value}</span>
          </div>
        </Card>

        <Card title={i18n.t('components.formTitle')} description={i18n.t('components.formDescription')}>
          <div class="demo-control-stack">
            <Input bind={inputValue} placeholder={i18n.t('components.input')} />
            <Textarea bind={textareaValue} rows={3} />
            <Select bind={selectValue}><option value="signals">{i18n.t('components.signals')}</option><option value="owners">{i18n.t('components.owners')}</option><option value="plugins">{i18n.t('components.plugins')}</option></Select>
            <div class="demo-choice-row"><Checkbox bind={rememberChoice}>{i18n.t('components.rememberChoice')}</Checkbox><Radio name="kind" value="core" checked={choice.value === 'core'} onChange={event => { choice.value = (event.target as HTMLInputElement).value }}>{i18n.t('components.core')}</Radio><Radio name="kind" value="extension" checked={choice.value === 'extension'} onChange={event => { choice.value = (event.target as HTMLInputElement).value }}>{i18n.t('components.extension')}</Radio></div>
            <div class="demo-inline-control"><span>{i18n.t('components.featureEnabled')}</span><Switch bind={featureEnabled} /></div>
            <span class="demo-muted">{selectValue.value} · {choice.value} · {featureEnabled.value ? i18n.t('components.enabled') : i18n.t('components.disabled')}</span>
          </div>
        </Card>
      </div>

      <Card title={i18n.t('components.tabsTitle')} description={i18n.t('components.tabsDescription')}>
        <Tabs
          items={[
            { id: 'overview', label: i18n.t('components.overview'), content: <p class="demo-muted">{i18n.t('components.tabsContent')}</p> },
            { id: 'table', label: i18n.t('components.table'), content: <Table columns={[{ id: 'name', label: i18n.t('components.package'), key: 'name' }, { id: 'state', label: i18n.t('components.state'), key: 'state' }, { id: 'owner', label: i18n.t('components.owner'), key: 'owner' }]} rows={sampleRows} /> },
            { id: 'empty', label: i18n.t('components.disabledTab'), disabled: true }
          ]}
          value={tab.value}
          onChange={value => { tab.value = value }}
        />
      </Card>

      <div class="demo-workbench">
        <Card title={i18n.t('components.workbenchTitle')} description={i18n.t('components.workbenchDescription')}>
          <div class="demo-workbench__body">
            <ActivityRail value={activity.value} items={[{ id: 'files', label: i18n.t('components.files'), icon: <Icon name="folder" /> }, { id: 'search', label: i18n.t('components.search'), icon: <Icon name="search" /> }, { divider: true }, { id: 'settings', label: i18n.t('components.settings'), icon: <Icon name="settings" /> }]} onChange={id => { activity.value = id }} />
            <FileTree
              value={selectedFile.value}
              items={[
                { id: 'src', label: 'src', kind: 'folder', expanded: true, children: [{ id: 'runtime', label: 'runtime.ts', kind: 'file' }, { id: 'reactivity', label: 'reactivity.ts', kind: 'file' }] },
                { id: 'readme', label: 'README.md', kind: 'file' }
              ]}
              onSelect={id => { selectedFile.value = id }}
            />
          </div>
          <EditorTabs tabs={editorTabs.value} value={selectedFile.value} onChange={id => { selectedFile.value = id }} onClose={id => {
            const next = editorTabs.value.filter(item => item.id !== id)
            editorTabs.value = next
            if (selectedFile.value === id) selectedFile.value = next[0]?.id ?? ''
          }} />
        </Card>
        <Card title={i18n.t('components.chatTitle')} description={i18n.t('components.chatDescription')}>
          <ChatComposer value={composerValue.value} model="Vobs Assistant" modelIcon={<Icon name="sparkles" />} modelChevron={<Icon name="chevron-down" />} sendIcon={<Icon name="arrow-right" />} onInput={event => { composerValue.value = (event.target as HTMLTextAreaElement).value }} onSend={value => { composerValue.value = value ? i18n.t('components.sent', { value }) : i18n.t('components.typeMessage') }} />
        </Card>
      </div>

      <Dialog open={dialogOpen.value} title={i18n.t('components.dialogTitle')} onClose={reason => { dialogOpen.value = false; overlayMessage.value = i18n.t('components.overlayClosed', { reason }) }}>
        <p>{i18n.t('components.dialogContent')}</p>
        <Button variant="brand" onClick={() => { dialogOpen.value = false }}>{i18n.t('components.closeDialog')}</Button>
      </Dialog>
      <Drawer open={drawerOpen.value} title={i18n.t('components.drawerTitle')} onClose={reason => { drawerOpen.value = false; overlayMessage.value = i18n.t('components.overlayClosed', { reason }) }} footer={<Button onClick={() => { drawerOpen.value = false; overlayMessage.value = i18n.t('components.overlayClosed', { reason: 'button' }) }}>{i18n.t('components.done')}</Button>}>
        <p>{i18n.t('components.drawerContent')}</p>
        <Avatar size="lg" accent>V</Avatar>
      </Drawer>
    </KitPage>
  )
}
