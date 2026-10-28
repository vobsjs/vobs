import { describe, expectTypeOf, it } from 'vitest'
import { createInjectionKey, inject, provide } from './index'
import { state, type Signal } from '@vobs/reactivity'

interface AuthContext {
  readonly loggedIn: Signal<boolean>
}

describe('Vobs public types', () => {
  it('state keeps its generic and infers from the initial value', () => {
    const count = state(0)
    expectTypeOf(count).toEqualTypeOf<Signal<number>>()
  })

  it('InjectionKey constrains inject and provide to the same type', () => {
    const key = createInjectionKey<AuthContext>('test.auth')
    const check = (): void => {
      const value: AuthContext | undefined = inject(key)
      if (value) value.loggedIn.value = true
      provide(key, { loggedIn: state(false) })
      // @ts-expect-error The value must match the InjectionKey payload.
      provide(key, state(false))
    }
    expectTypeOf(check).toBeFunction()
  })
})
