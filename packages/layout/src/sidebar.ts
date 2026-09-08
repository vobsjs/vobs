import { effect } from '@vobs/reactivity'
import {
  addEventListener,
  createComponent,
  createElement,
  createText,
  insertBefore,
  insertDynamic,
  setAttribute,
  type VobsNode
} from '@vobs/vobs'
import { KitMenu } from './menu'
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
import type { KitMenuItem, KitSidebarProps } from './types'

export function KitSidebar(props: KitSidebarProps = {}): VobsNode {
  const root = createElement('aside')
  const close = createElement('button')

  bindClassList(root, props, () => [
    'vobs-kit-sidebar',
    readProp(props, 'collapsed', false) ? 'is-collapsed' : undefined,
    readProp(props, 'mobileOpen', false) ? 'is-mobile-open' : undefined,
    readProp<KitSidebarProps['variant']>(props, 'variant', 'default') === 'centered' ? 'is-centered' : undefined
  ])
  bindCommonAttributes(root, props, [
    'items',
    'menu',
    'collapsed',
    'mobileOpen',
    'activeKey',
    'variant',
    'closeLabel',
    'footer',
    'onSelect',
    'onClose'
  ])
  bindUserStyle(root, props)
  setAttribute(close, 'type', 'button')
  setAttribute(close, 'class', 'vobs-kit-sidebar__close')
  effect(() => {
    setOptionalAttribute(close, 'aria-label', readProp(props, 'closeLabel', 'Close navigation'))
  })
  insertBefore(close, createCloseLabel(props), null)
  addEventListener(close, 'click', () => {
    const handler = readProp<unknown>(props, 'onClose', undefined)
    if (typeof handler === 'function') (handler as KitSidebarProps['onClose'])!()
  })
  insertBefore(root, close, null)

  insertDynamic(root, null, () => createDefaultMenu(props))
  if (hasProp(props, 'footer')) {
    const footer = createElement('div')
    setAttribute(footer, 'class', 'vobs-kit-sidebar__footer')
    mountSlot(footer, props, 'footer')
    insertBefore(root, footer, null)
  }
  if (hasProp(props, 'children')) mountSlot(root, props, 'children')
  return root
}

function createDefaultMenu(props: KitSidebarProps): VobsNode | null {
  const items = readProp<readonly KitMenuItem[] | undefined>(props, 'items', undefined)
    ?? readProp<readonly KitMenuItem[]>(props, 'menu', [])
  if (items.length === 0 && hasProp(props, 'children')) return null

  return createComponent(KitMenu, {
    get items() { return items },
    get collapsed() { return readProp(props, 'collapsed', false) },
    get activeKey() { return readProp<string | undefined>(props, 'activeKey', undefined) },
    get onSelect() { return readProp<KitSidebarProps['onSelect'] | undefined>(props, 'onSelect', undefined) }
  })
}

function createCloseLabel(props: KitSidebarProps): VobsNode {
  const text = createElement('span')
  const content = createText('')
  setAttribute(text, 'class', 'vobs-kit-sidebar__close-label')
  bindTextContent(content, () => readProp(props, 'closeLabel', 'Close navigation'))
  insertBefore(text, content, null)
  return text
}
