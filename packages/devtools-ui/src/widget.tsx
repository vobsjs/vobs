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
   * 同 DevToolsPanel：devtools 只靠"祖先 owner 名字以 `DevTools` 开头"来判断"这是调试台自己"
   * （isInternalOwnerId）。单独挂载 Widget（不经面板）时它自己的 state/副作用原本会被当成应用数据记录。
   */
  const widgetOwner = getCurrentOwner()
  if (widgetOwner) setOwnerDebugName(widgetOwner, 'DevToolsWidget')

  const open = state(false)
  const maximized = state(false)
  const query = state('')
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
