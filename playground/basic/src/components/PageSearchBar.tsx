import type { Signal } from '@vobs/vobs'
import { Icon, Input, Select } from '@vobs/ui'

export interface PageSearchOption {
  readonly value: string
  readonly label: string
}

export interface PageSearchBarProps {
  readonly value: Signal<string>
  readonly placeholder?: string
  readonly ariaLabel?: string
  readonly status?: Signal<string>
  readonly statusOptions?: readonly PageSearchOption[]
  readonly statusLabel?: string
  readonly onQueryChange?: () => void
}

export function PageSearchBar(props: PageSearchBarProps) {
  return (
    <div class="page-search-bar">
      <Input
        type="search"
        value={props.value.value}
        placeholder={props.placeholder ?? 'Search'}
        aria-label={props.ariaLabel ?? props.placeholder ?? 'Search'}
        icon={<Icon name="search" />}
        onInput={event => {
          props.value.value = (event.target as HTMLInputElement).value
          props.onQueryChange?.()
        }}
      />
      {props.status && props.statusOptions ? (
        <Select
          value={props.status.value}
          aria-label={props.statusLabel ?? 'Filter by status'}
          onChange={event => {
            props.status!.value = (event.target as HTMLSelectElement).value
            props.onQueryChange?.()
          }}
        >
          {props.statusOptions.map(option => <option value={option.value}>{option.label}</option>)}
        </Select>
      ) : null}
    </div>
  )
}
