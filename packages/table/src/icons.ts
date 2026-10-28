import { createComponent } from '@vobs/vobs'
import { Icon } from '@vobs/ui'
import type { DataTableIcons } from './types'

/** Built-in default icons; same-named entries in the `icons` prop override them one by one. */
export function defaultIcons(): Required<DataTableIcons> {
  return {
    ascending: () => createComponent(Icon, { name: 'chevron-up' }),
    descending: () => createComponent(Icon, { name: 'chevron-down' }),
    unsorted: () => createComponent(Icon, { name: 'sort' }),
    previous: () => createComponent(Icon, { name: 'chevron-left' }),
    next: () => createComponent(Icon, { name: 'chevron-right' })
  }
}
