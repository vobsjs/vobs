import { onDispose, state } from '@vobs/vobs'
import { Field, createForm, rules } from '@vobs/forms'
import { Alert, Button, Card, Icon, Input, Tag } from '@vobs/ui'
import { KitPage } from '@vobs/kit'
import { useI18n } from '@vobs/i18n'

export function FormsPage() {
  const i18n = useI18n()
  const form = createForm({ name: '', email: '', role: 'Contributor' }, {
    validateOn: 'blur',
    validators: {
      name: [rules.required, rules.minLength(2)],
      email: [rules.required, rules.email]
    }
  })
  const result = state(i18n.t('forms.fillAndSubmit'), 'forms.submit.result')
  const submitScenario = state<'success' | 'error' | 'slow'>('success', 'forms.submit.scenario')
  const submitState = state<'idle' | 'loading' | 'success' | 'error' | 'cancelled'>('idle', 'forms.submit.status')
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
        await waitForSubmit(controller.signal, submitScenario.value)
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
            <Field form={form} name="name" label={i18n.t('forms.name')}>
              {field => <Input value={field.value.value as string} placeholder={i18n.t('forms.yourName')} onInput={event => field.set((event.target as HTMLInputElement).value)} onBlur={() => { void field.markTouched() }} />}
            </Field>
            <Field form={form} name="email" label={i18n.t('forms.email')}>
              {field => <Input type="email" value={field.value.value as string} placeholder={i18n.t('forms.yourEmail')} onInput={event => field.set((event.target as HTMLInputElement).value)} onBlur={() => { void field.markTouched() }} />}
            </Field>
            <Field form={form} name="role" label={i18n.t('forms.role')}>
              {field => <Input value={field.value.value as string} placeholder={i18n.t('forms.contributor')} onInput={event => field.set((event.target as HTMLInputElement).value)} />}
            </Field>
            <div class="demo-button-row">
              <Button type="submit" variant="brand" icon={<Icon name="check" />} loading={form.submitting.value}>{i18n.t('forms.submit')}</Button>
              <Button type="button" variant="ghost" disabled={!form.submitting.value} onClick={() => { submitController?.abort() }}>{i18n.t('forms.cancelSubmit')}</Button>
              <Button type="button" variant="secondary" onClick={() => { form.reset(); result.value = i18n.t('forms.formReset') }}>{i18n.t('common.reset')}</Button>
            </div>
          </form>
        </Card>
        <Card title={i18n.t('forms.stateTitle')} description={i18n.t('forms.stateDescription')}>
          <pre class="demo-code">{JSON.stringify({ values: form.values, dirty: form.dirty.value, touched: [...form.touched.value], errors: form.errors.value }, null, 2)}</pre>
          <div class="demo-button-row" aria-label={i18n.t('forms.submitScenarios')}>
            <Button size="sm" variant={submitScenario.value === 'success' ? 'brand' : 'ghost'} onClick={() => { submitScenario.value = 'success' }}>{i18n.t('async.successScenario')}</Button>
            <Button size="sm" variant={submitScenario.value === 'error' ? 'danger-subtle' : 'ghost'} onClick={() => { submitScenario.value = 'error' }}>{i18n.t('async.errorScenario')}</Button>
            <Button size="sm" variant={submitScenario.value === 'slow' ? 'secondary' : 'ghost'} onClick={() => { submitScenario.value = 'slow' }}>{i18n.t('async.slowScenario')}</Button>
            <Tag tone={submitState.value === 'error' ? 'danger' : submitState.value === 'success' ? 'success' : submitState.value === 'loading' ? 'warning' : 'neutral-strong'}>{i18n.t(`common.status.${submitState.value}`)}</Tag>
          </div>
          <Alert tone={form.hasErrors.value || submitState.value === 'error' ? 'warning' : 'success'} title={form.hasErrors.value || submitState.value === 'error' ? i18n.t('forms.needsAttention') : i18n.t('common.ready')} description={result.value} />
        </Card>
      </div>
    </KitPage>
  )
}

function waitForSubmit(signal: AbortSignal, scenario: 'success' | 'error' | 'slow'): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, scenario === 'slow' ? 5000 : 180)
    const abort = (): void => {
      clearTimeout(timer)
      reject(Object.assign(new Error('Submit cancelled'), { name: 'AbortError' }))
    }
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
  })
}

function isAbortError(value: unknown): boolean {
  return Boolean(value) && typeof value === 'object' && (value as { name?: unknown }).name === 'AbortError'
}
