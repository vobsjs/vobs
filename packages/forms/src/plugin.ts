import { createInjectionKey, type VobsPlugin } from '@vobs/vobs'
import { createForm, type Form, type FormOptions } from './form'

export interface FormsClient {
  createForm<T extends object>(initialValues: T, options?: FormOptions<T>): Form<T>
}

export const FORMS_KEY = createInjectionKey<FormsClient>('vobs.forms')

export interface FormsPluginOptions {
  client?: FormsClient
}

export function formsPlugin(options: FormsPluginOptions = {}): VobsPlugin {
  return {
    name: '@vobs/forms',
    version: '0.1.0',
    install(context) {
      context.provide(FORMS_KEY, options.client ?? { createForm })
    }
  }
}
