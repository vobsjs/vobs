import {
  addEventListener,
  createElement,
  createFragment,
  createText,
  insertBefore,
  insertDynamic,
  setAttribute,
  type VobsNode
} from '@vobs/vobs'
import {
  bindClassList,
  bindCommonAttributes,
  bindTextContent,
  bindUserStyle,
  hasProp,
  mountSlot,
  readProp,
  setOptionalAttribute
} from './utils'
import type { VuiChildren, VuiCommonProps } from './types'

export interface WorkbenchTitlebarProps extends VuiCommonProps {
  readonly mode?: string
  readonly modeIcon?: VuiChildren
  readonly project?: string
  readonly projectIcon?: VuiChildren
  readonly projectChevron?: VuiChildren
  readonly actions?: VuiChildren
  readonly windowControls?: boolean
  readonly onWindowClose?: (event: MouseEvent) => void
  readonly onWindowMinimize?: (event: MouseEvent) => void
  readonly onWindowMaximize?: (event: MouseEvent) => void
  readonly onProjectClick?: (event: MouseEvent) => void
}

export function WorkbenchTitlebar(props: WorkbenchTitlebarProps = {}): VobsNode {
  const root = createElement('header')
  const left = createElement('div')
  const right = createElement('div')
  bindClassList(root, props, () => ['vui-wbtitlebar'])
  bindCommonAttributes(root, props, [
    'mode',
    'modeIcon',
    'project',
    'projectIcon',
    'projectChevron',
    'actions',
    'windowControls',
    'onWindowClose',
    'onWindowMinimize',
    'onWindowMaximize',
    'onProjectClick'
  ])
  bindUserStyle(root, props)
  setAttribute(left, 'class', 'vui-wbtitlebar__left')
  setAttribute(right, 'class', 'vui-wbtitlebar__right')
  insertDynamic(left, null, () => createTitlebarLeft(props))
  if (hasProp(props, 'actions')) mountSlot(right, props, 'actions')
  if (hasProp(props, 'children')) mountSlot(right, props, 'children')
  insertBefore(root, left, null)
  insertBefore(root, right, null)
  return root
}

function createTitlebarLeft(props: WorkbenchTitlebarProps): VobsNode {
  return createFragment((parent, anchor) => {
    if (readProp(props, 'windowControls', true)) {
      const lights = createElement('div')
      setAttribute(lights, 'class', 'vui-wbtitlebar__lights')
      insertBefore(lights, createWindowLight('close', props, 'onWindowClose'), null)
      insertBefore(lights, createWindowLight('min', props, 'onWindowMinimize'), null)
      insertBefore(lights, createWindowLight('max', props, 'onWindowMaximize'), null)
      insertBefore(parent, lights, anchor)
    }

    if (hasProp(props, 'mode')) {
      const mode = createElement('span')
      setAttribute(mode, 'class', 'vui-wbtitlebar__mode-chip')
      if (hasProp(props, 'modeIcon')) {
        const icon = createElement('span')
        setAttribute(icon, 'class', 'vui-wbtitlebar__mode-icon')
        mountSlot(icon, props, 'modeIcon')
        insertBefore(mode, icon, null)
      }
      const text = createText('')
      bindTextContent(text, () => readProp(props, 'mode', ''))
      insertBefore(mode, text, null)
      insertBefore(parent, mode, anchor)
    }

    if (hasProp(props, 'project')) insertBefore(parent, createProjectSelector(props), anchor)
  })
}

function createWindowLight(
  kind: 'close' | 'min' | 'max',
  props: WorkbenchTitlebarProps,
  handlerName: 'onWindowClose' | 'onWindowMinimize' | 'onWindowMaximize'
): VobsNode {
  const light = createElement('button')
  setAttribute(light, 'class', `vui-wbtitlebar__light vui-wbtitlebar__light--${kind}`)
  setAttribute(light, 'type', 'button')
  setAttribute(light, 'aria-label', kind === 'close' ? 'Close window' : kind === 'min' ? 'Minimize window' : 'Maximize window')
  addEventListener(light, 'click', event => {
    const handler = readProp<unknown>(props, handlerName, undefined)
    if (typeof handler === 'function') (handler as WorkbenchTitlebarProps[typeof handlerName])!(event as MouseEvent)
  })
  return light
}

function createProjectSelector(props: WorkbenchTitlebarProps): VobsNode {
  const button = createElement('button')
  setAttribute(button, 'class', 'vui-wbtitlebar__project-selector')
  setAttribute(button, 'type', 'button')
  setOptionalAttribute(button, 'aria-label', readProp(props, 'project', 'Project'))
  if (hasProp(props, 'projectIcon')) {
    const icon = createElement('span')
    setAttribute(icon, 'class', 'vui-wbtitlebar__project-icon')
    mountSlot(icon, props, 'projectIcon')
    insertBefore(button, icon, null)
  }
  const project = createText('')
  bindTextContent(project, () => readProp(props, 'project', ''))
  insertBefore(button, project, null)
  if (hasProp(props, 'projectChevron')) {
    const chevron = createElement('span')
    setAttribute(chevron, 'class', 'vui-wbtitlebar__project-chevron')
    mountSlot(chevron, props, 'projectChevron')
    insertBefore(button, chevron, null)
  }
  addEventListener(button, 'click', event => {
    const handler = readProp<unknown>(props, 'onProjectClick', undefined)
    if (typeof handler === 'function') (handler as WorkbenchTitlebarProps['onProjectClick'])!(event as MouseEvent)
  })
  return button
}
