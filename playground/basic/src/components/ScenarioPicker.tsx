import { type Signal } from '@vobs/vobs'
import { Button } from '@vobs/ui'
import { useI18n } from '@vobs/i18n'
import type { Scenario } from '../utils/async'

interface ScenarioPickerProps {
  readonly scenario: Signal<Scenario>
  readonly ariaLabel?: string
}

const OPTIONS: readonly { value: Scenario; variant: 'brand' | 'secondary' | 'danger-subtle' }[] = [
  { value: 'success', variant: 'brand' },
  { value: 'error', variant: 'danger-subtle' },
  { value: 'slow', variant: 'secondary' }
]

export function ScenarioPicker(props: ScenarioPickerProps) {
  const i18n = useI18n()
  return (
    <div class="demo-button-row" aria-label={props.ariaLabel}>
      {OPTIONS.map(option => (
        <Button
          size="sm"
          variant={props.scenario.value === option.value ? option.variant : 'ghost'}
          onClick={() => { props.scenario.set(option.value) }}
        >
          {i18n.t(`async.${option.value}Scenario`)}
        </Button>
      ))}
    </div>
  )
}
