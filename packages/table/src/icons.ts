import { createComponent } from '@vobs/vobs'
import { Icon } from '@vobs/ui'
import type { DataTableIcons } from './types'

/** 内置默认图标；`icons` prop 中的同名项会逐个覆盖。 */
export function defaultIcons(): Required<DataTableIcons> {
  return {
    ascending: () => createComponent(Icon, { name: 'chevron-up' }),
    descending: () => createComponent(Icon, { name: 'chevron-down' }),
    unsorted: () => createComponent(Icon, { name: 'sort' }),
    previous: () => createComponent(Icon, { name: 'chevron-left' }),
    next: () => createComponent(Icon, { name: 'chevron-right' })
  }
}
