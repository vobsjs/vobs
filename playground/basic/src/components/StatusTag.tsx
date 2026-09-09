import { type ReadableSignal } from '@vobs/vobs'
import { Tag } from '@vobs/ui'
import { useI18n } from '@vobs/i18n'

interface StatusTagProps<T extends string> {
  readonly status: ReadableSignal<T>
}

const TONES: readonly { value: string; tone: 'danger' | 'success' | 'warning' }[] = [
  { value: 'error', tone: 'danger' },
  { value: 'success', tone: 'success' },
  { value: 'loading', tone: 'warning' }
]

export function StatusTag<T extends string>(props: StatusTagProps<T>) {
  const i18n = useI18n()
  const tone = TONES.find(item => item.value === props.status.value)?.tone ?? 'neutral-strong'
  return <Tag tone={tone}>{i18n.t(`common.status.${props.status.value}`)}</Tag>
}
