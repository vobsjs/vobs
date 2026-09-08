import {
  createIcon,
  createSvgIconNode,
  type IconDefinition,
  type SvgIconDefinition,
  type VobsIconProps
} from '@vobs/icon-core'
import { hasProp, mountSlot, readProp } from './utils'
import type { VobsNode } from '@vobs/vobs'
import type { VuiCommonProps } from './types'

export type { IconDefinition } from '@vobs/icon-core'

export interface IconProps extends VuiCommonProps, VobsIconProps {
  readonly name?: string
  readonly icon?: IconDefinition
}

export function Icon(props: IconProps = {}): VobsNode {
  const root = createSvgIconNode(() => {
    const definition = resolveIcon(
      readProp<IconDefinition | string | undefined>(props, 'icon', undefined)
        ?? readProp<string | undefined>(props, 'name', undefined)
    )
    if (!definition) {
      if (hasProp(props, 'children')) return undefined
      throw new Error('Vobs UI: Icon requires a registered `name` or an `icon` definition')
    }
    return iconDefinitionToSvg(definition)
  }, props, {
    class: 'vui-icon icon',
    defaultSvgAttributes: {
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 2,
      'stroke-linecap': 'butt',
      'stroke-linejoin': 'miter'
    }
  }) as Element

  if (hasProp(props, 'children')) mountSlot(root, props, 'children')
  return root
}

function iconDefinitionToSvg(definition: IconDefinition): SvgIconDefinition {
  return {
    name: definition.name,
    body: definition.path,
    viewBox: definition.viewBox
  }
}

const VUI_ICON_PATHS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  check: '<polyline points="4 12 10 18 20 6"/>',
  x: '<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  minus: '<line x1="5" y1="12" x2="19" y2="12"/>',
  'chevron-right': '<polyline points="9 6 15 12 9 18"/>',
  'chevron-down': '<polyline points="6 9 12 15 18 9"/>',
  'chevron-up': '<polyline points="6 15 12 9 18 15"/>',
  'chevron-left': '<polyline points="15 6 9 12 15 18"/>',
  'arrow-left': '<line x1="20" y1="12" x2="4" y2="12"/><polyline points="10 6 4 12 10 18"/>',
  'arrow-right': '<line x1="4" y1="12" x2="20" y2="12"/><polyline points="14 6 20 12 14 18"/>',
  'arrow-up': '<line x1="12" y1="20" x2="12" y2="4"/><polyline points="6 10 12 4 18 10"/>',
  'arrow-down': '<line x1="12" y1="4" x2="12" y2="20"/><polyline points="6 14 12 20 18 14"/>',
  atom: '<circle cx="12" cy="12" r="2"/><ellipse cx="12" cy="12" rx="10" ry="4"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(120 12 12)"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  'arrow-expand': '<polyline points="14 4 20 4 20 10"/><line x1="14" y1="10" x2="20" y2="4"/><polyline points="10 20 4 20 4 14"/><line x1="10" y1="14" x2="4" y2="20"/>',
  'arrow-minimize': '<polyline points="20 4 14 10 20 10"/><line x1="14" y1="10" x2="14" y2="4"/><polyline points="4 20 10 14 4 14"/><line x1="10" y1="14" x2="10" y2="20"/>',
  'check-circle': '<circle cx="12" cy="12" r="9"/><polyline points="8 12 11 15 16 9"/>',
  'alert-circle': '<circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="13"/><line x1="12" y1="16" x2="12" y2="16.01"/>',
  'alert-triangle': '<path d="M12 3 22 20 2 20 Z"/><line x1="12" y1="10" x2="12" y2="15"/><line x1="12" y1="18" x2="12" y2="18.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16"/><line x1="12" y1="8" x2="12" y2="8.01"/>',
  home: '<polygon points="3 11 12 3 21 11 21 21 14 21 14 14 10 14 10 21 3 21 3 11"/>',
  user: '<path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/><circle cx="12" cy="8" r="4"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  menu: '<line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/>',
  'more-h': '<circle cx="5" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="19" cy="12" r="1.5" fill="currentColor"/>',
  calendar: '<rect x="3" y="5" width="18" height="16"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="16" y1="3" x2="16" y2="7"/>',
  filter: '<polygon points="3 4 21 4 14 12 14 20 10 18 10 12 3 4"/>',
  sort: '<path d="M8 20V4"/><polyline points="4 8 8 4 12 8"/><path d="M16 4v16"/><polyline points="12 16 16 20 20 16"/>',
  edit: '<path d="M4 20h4l10-10-4-4L4 16v4z"/><path d="M14 6l4 4"/>',
  trash: '<polyline points="4 6 20 6"/><path d="M6 6v14h12V6"/><path d="M9 6V4h6v2"/><line x1="10" y1="10" x2="10" y2="17"/><line x1="14" y1="10" x2="14" y2="17"/>',
  download: '<path d="M12 3v12"/><polyline points="7 10 12 15 17 10"/><line x1="3" y1="21" x2="21" y2="21"/>',
  upload: '<path d="M12 21V6"/><polyline points="7 11 12 6 17 11"/><line x1="3" y1="21" x2="21" y2="21"/>',
  pause: '<line x1="9" y1="5" x2="9" y2="19"/><line x1="15" y1="5" x2="15" y2="19"/>',
  play: '<polygon points="8 5 19 12 8 19 8 5"/>',
  refresh: '<polyline points="21 4 21 10 15 10"/><polyline points="3 20 3 14 9 14"/><path d="M20.5 9A9 9 0 0 0 5 5.5L3 7M3.5 15A9 9 0 0 0 19 18.5L21 17"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8z"/><path d="M10 21a2 2 0 0 0 4 0"/>',
  folder: '<path d="M3 6h6l2 3h10v10H3z"/>',
  code: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
  sparkles: '<path d="M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8L12 3z"/><path d="M19 14l1 2.2 2.2 1-2.2 1L19 20.4l-1-2.2-2.2-1 2.2-1L19 14z"/>',
  zap: '<polygon points="13 2 4 14 12 14 11 22 20 10 12 10 13 2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/><line x1="4.6" y1="4.6" x2="6.7" y2="6.7"/><line x1="17.3" y1="17.3" x2="19.4" y2="19.4"/><line x1="4.6" y1="19.4" x2="6.7" y2="17.3"/><line x1="17.3" y1="6.7" x2="19.4" y2="4.6"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>'
} as const

const iconRegistry = new Map<string, IconDefinition>(
  Object.entries(VUI_ICON_PATHS).map(([name, path]) => [name, { name, path }])
)

export { VUI_ICON_PATHS }
export { createIcon, registerIcon, resolveIcon }

function registerIcon(icon: IconDefinition): () => void {
  const previous = iconRegistry.get(icon.name)
  iconRegistry.set(icon.name, icon)
  return () => {
    if (previous) iconRegistry.set(icon.name, previous)
    else iconRegistry.delete(icon.name)
  }
}

function resolveIcon(icon: string | IconDefinition | undefined): IconDefinition | undefined {
  return typeof icon === 'string' ? iconRegistry.get(icon) : icon
}
