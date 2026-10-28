import { createComponent, createElement, createFragment, insertBefore, insertDynamic, setAttribute, state, type VobsNode } from '@vobs/vobs'
import { getCurrentOwner, setOwnerDebugName } from '@vobs/reactivity'
import { getDevTools } from '@vobs/devtools'
import { Button, Dialog, Icon } from '@vobs/ui'
import { DevToolsPanel, DevToolsToolbar, type DevToolsPanelProps } from './panel'

export interface DevToolsWidgetProps extends DevToolsPanelProps {
  readonly label?: string
}

/** Floating entry point for opening the DevTools panel without leaving the app. */
export function DevToolsWidget(props: DevToolsWidgetProps = {}): VobsNode {
  /*
   * Same as DevToolsPanel: devtools identifies "the devtools itself" solely by ancestor owner
   * names starting with `DevTools` (isInternalOwnerId). When the Widget is mounted standalone
   * (not via the panel), its own state/side effects would otherwise be recorded as app data.
   */
  const widgetOwner = getCurrentOwner()
  if (widgetOwner) setOwnerDebugName(widgetOwner, 'DevToolsWidget')

  const open = state(false, 'open')
  const maximized = state(false, 'maximized')
  const query = state('', 'query')
  const toolbarProps = {
    get api() { return props.api === undefined ? getDevTools() : props.api ?? null },
    query,
    get maximized() { return maximized.value },
    onToggleMaximize: () => { maximized.value = !maximized.value }
  }
  return createFragment((parent, anchor) => {
    const launcher = createElement('div')
    setAttribute(launcher, 'class', 'vobs-devtools-widget')
    insertBefore(launcher, createComponent(Button, {
      variant: 'brand',
      iconOnly: true,
      icon: createComponent(Icon, { name: 'code' }),
      'aria-label': props.label ?? 'Open DevTools',
      title: props.label ?? 'Open DevTools',
      onClick: () => { open.value = true }
    }), null)
    insertBefore(parent, launcher, anchor)

    insertDynamic(parent, anchor, () => open.value ? createComponent(Dialog, {
      get class() { return `vobs-devtools-widget__dialog${maximized.value ? ' is-maximized' : ''}` },
      open: true,
      title: 'Runtime DevTools',
      headerActions: () => createComponent(DevToolsToolbar, toolbarProps),
      size: 'lg',
      closeLabel: 'Close DevTools',
      onClose: () => { open.value = false; maximized.value = false },
      children: () => createComponent(DevToolsPanel, {
        api: props.api,
        router: props.router,
        http: props.http,
        query,
        toolbarPlacement: 'header'
      })
    }) : null)
  })
}
