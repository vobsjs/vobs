import { onDispose, state } from '@vobs/vobs'
import { Field, createForm, rules } from '@vobs/forms'
import { Alert, Button, Card, Icon, Input, Tag } from '@vobs/ui'
import { KitPage } from '@vobs/kit'
import { useI18n } from '@vobs/i18n'
import { isAbortError, waitFor, type Scenario } from '../../utils/async'
import { ScenarioPicker } from '../../components/ScenarioPicker'
import { StatusTag } from '../../components/StatusTag'

export function FormsPage() {
  const i18n = useI18n()
  const form = createForm({ name: '', email: '', role: 'Contributor' }, {
    validateOn: 'blur',
    validators: {
      name: [rules.required, rules.minLength(2)],
      email: [rules.required, rules.email]
    }
  })
  const result = state(i18n.t('forms.fillAndSubmit'))
  const submitScenario = state<Scenario>('success')
  const submitState = state<'idle' | 'loading' | 'success' | 'error' | 'cancelled'>('idle')
  let submitController: AbortController | undefined

  onDispose(() => {
    submitController?.abort()
    form.dispose()
  })

  async function submitForm(): Promise<void> {
    submitController?.abort()
    const controller = new AbortController()
    submitController = controller
    submitState.value = 'loading'
    try {
      const response = await form.submit(async values => {
        await waitFor(controller.signal, submitScenario.value === 'slow' ? 5000 : 180, 'Submit cancelled')
        if (submitScenario.value === 'error') throw new Error(i18n.t('forms.submitFailed'))
        result.value = i18n.t('forms.submitted', { name: values.name, email: values.email })
        return values
      })
      if (!response.valid) {
        submitState.value = 'error'
        result.value = i18n.t('forms.validationIssues', { count: Object.keys(response.errors).length })
      } else {
        submitState.value = 'success'
      }
    } catch (error) {
      if (isAbortError(error)) {
        submitState.value = 'cancelled'
        result.value = i18n.t('forms.submitCancelled')
      } else {
        submitState.value = 'error'
        result.value = error instanceof Error ? error.message : String(error)
      }
    }
  }

  return (
    <KitPage
      class="demo-shell"
      title={i18n.t('forms.title')}
      description={i18n.t('forms.description')}
      actions={<Tag tone="brand">@vobs/forms</Tag>}
    >
      <div class="demo-form-layout">
        <Card title={i18n.t('forms.validatedTitle')} description={i18n.t('forms.validatedDescription')}>
          <form class="demo-form" onSubmit={event => { event.preventDefault(); void submitForm() }}>
            <Field form={form} name="name" label={i18n.t('forms.name')} component={Input} placeholder={i18n.t('forms.yourName')} />
            <Field form={form} name="email" label={i18n.t('forms.email')} component={Input} type="email" placeholder={i18n.t('forms.yourEmail')} />
            <Field form={form} name="role" label={i18n.t('forms.role')} component={Input} placeholder={i18n.t('forms.contributor')} />
            <div class="demo-button-row">
              <Button type="submit" variant="brand" icon={<Icon name="check" />} loading={form.submitting.value}>{i18n.t('forms.submit')}</Button>
              <Button type="button" variant="ghost" disabled={!form.submitting.value} onClick={() => { submitController?.abort() }}>{i18n.t('forms.cancelSubmit')}</Button>
              <Button type="button" variant="secondary" onClick={() => { form.reset(); result.value = i18n.t('forms.formReset') }}>{i18n.t('common.reset')}</Button>
            </div>
          </form>
        </Card>
        <Card title={i18n.t('forms.stateTitle')} description={i18n.t('forms.stateDescription')}>
          <pre class="demo-code">{JSON.stringify({ values: form.values, dirty: form.dirty.value, touched: [...form.touched.value], errors: form.errors.value }, null, 2)}</pre>
          <ScenarioPicker scenario={submitScenario} ariaLabel={i18n.t('forms.submitScenarios')} />
          <div class="demo-button-row">
            <StatusTag status={submitState} />
          </div>
          <Alert tone={form.hasErrors.value || submitState.value === 'error' ? 'warning' : 'success'} title={form.hasErrors.value || submitState.value === 'error' ? i18n.t('forms.needsAttention') : i18n.t('common.ready')} description={result.value} />
        </Card>
      </div>
    </KitPage>
  )
}
