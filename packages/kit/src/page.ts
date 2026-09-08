import {
  createElement,
  createComponent,
  createText,
  insertBefore,
  insertDynamic,
  setAttribute,
  type VobsNode
} from '@vobs/vobs'
import { KitLayout } from '@vobs/layout'
import {
  bindClassList,
  bindCommonAttributes,
  bindTextContent,
  bindUserStyle,
  hasProp,
  mountSlot,
  readProp,
  resolveSlot
} from './utils'
import type { KitPageHeaderProps, KitPageProps } from './types'

export function KitPageHeader(props: KitPageHeaderProps = {}): VobsNode {
  const root = createElement('header')
  const main = createElement('div')
  const title = createElement('h1')
  const titleText = createText('')

  bindClassList(root, props, () => ['vobs-kit-page-header'])
  bindCommonAttributes(root, props, ['title', 'description', 'actions'])
  bindUserStyle(root, props)
  setAttribute(main, 'class', 'vobs-kit-page-header__main')
  setAttribute(title, 'class', 'vobs-kit-page-header__title')
  bindTextContent(titleText, () => readProp(props, 'title', ''))
  insertBefore(title, titleText, null)
  insertBefore(main, title, null)

  if (readProp<string | undefined>(props, 'description', undefined) !== undefined) {
    const description = createElement('p')
    const descriptionText = createText('')
    setAttribute(description, 'class', 'vobs-kit-page-header__description')
    bindTextContent(descriptionText, () => readProp(props, 'description', ''))
    insertBefore(description, descriptionText, null)
    insertBefore(main, description, null)
  }

  insertBefore(root, main, null)
  if (readProp(props, 'actions', undefined) !== undefined) {
    const actions = createElement('div')
    setAttribute(actions, 'class', 'vobs-kit-page-header__actions')
    mountSlot(actions, props, 'actions')
    insertBefore(root, actions, null)
  }
  if (hasProp(props, 'children')) mountSlot(root, props, 'children')
  return root
}

export function KitPage(props: KitPageProps = {}): VobsNode {
  const root = createElement('section')
  const header = createElement('div')
  const content = createElement('div')

  bindClassList(root, props, () => ['vobs-kit-page'])
  bindCommonAttributes(root, props, ['header', 'title', 'description', 'actions', 'toolbar'])
  bindUserStyle(root, props)

  setAttribute(header, 'class', 'vobs-kit-page__header')
  if (readProp(props, 'header', undefined) !== undefined) {
    mountSlot(header, props, 'header')
  } else if (hasProp(props, 'title') || hasProp(props, 'description') || hasProp(props, 'actions')) {
    insertBefore(header, createComponent(KitPageHeader, {
      get title() { return readProp(props, 'title', '') },
      get description() { return readProp(props, 'description', undefined) },
      get actions() { return readProp(props, 'actions', undefined) }
    }), null)
  }

  setAttribute(content, 'class', 'vobs-kit-page__content')
  if (hasProp(props, 'children')) mountSlot(content, props, 'children')
  insertBefore(root, header, null)
  insertDynamic(root, null, () => createPageToolbar(props))
  insertBefore(root, content, null)
  return root
}

function createPageToolbar(props: KitPageProps): VobsNode | null {
  const value = resolveSlot(readProp(props, 'toolbar', undefined))
  if (value === null) return null

  const toolbar = createElement('div')
  setAttribute(toolbar, 'class', 'vobs-kit-page__toolbar')
  insertBefore(toolbar, value, null)
  return toolbar
}

export { KitLayout }
