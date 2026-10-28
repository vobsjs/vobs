// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createPreferences, definePreferences } from './index'

/*
 * A `__proto__` key in the archive must not pollute Object.prototype.
 *
 * restore() used to check existence via `schema[name]` — which walks the prototype chain down to
 * `Object.prototype`, so a `__proto__` key made the check always truthy, and finally
 * `signals['__proto__'].value = value` wrote the value onto **Object.prototype**
 * (measured: `({}).value = {polluted:true}` with no onError).
 * The damage chains: resource / ui/forms / combobox / storage all **recognize signals** via
 * `'value' in x` — once polluted, every plain object gets misidentified as a signal.
 *
 * The malicious archive is constructed with the public API: save() once to get the real storage
 * key, then replace that key's contents with JSON carrying a `__proto__` own key (must use
 * JSON.parse — in an object literal, `__proto__:` sets the prototype, not an own key).
 */
const schema = definePreferences({
  theme: { type: 'string', default: 'light' },
  pageSize: { type: 'number', default: 20 }
})

function makeStorage() {
  const raw = new Map<string, string>()
  const storage = {
    getItem: (key: string) => raw.get(key) ?? null,
    setItem: (key: string, value: string) => { raw.set(key, value) },
    removeItem: (key: string) => { raw.delete(key) }
  }
  return { raw, storage }
}

describe('preferences archive prototype pollution', () => {
  it('a __proto__ key is not written onto Object.prototype and normal keys still restore', () => {
    const { raw, storage } = makeStorage()
    const preferences = createPreferences({ preferences: schema, storage: storage as never, autoSave: false })
    preferences.set('pageSize', 50)
    preferences.save()
    const key = [...raw.keys()][0]!

    raw.set(key, JSON.stringify({
      version: 1,
      values: JSON.parse('{"__proto__":{"polluted":true},"theme":"dark"}')
    }))
    preferences.restore()

    expect(({} as Record<string, unknown>).value, 'Object.prototype was dirtied').toBeUndefined()
    expect(({} as Record<string, unknown>).polluted, 'the prototype was stuffed with fields').toBeUndefined()
    expect('value' in {}, 'pollution would break the repo-wide "value" in x signal detection').toBe(false)
    // Normal keys still restore (non-regression)
    expect((preferences as unknown as { theme: { value: string } }).theme.value).toBe('dark')

    // Defensive cleanup: if the implementation regresses, don't pollute subsequent tests
    delete (Object.prototype as Record<string, unknown>).value
    delete (Object.prototype as Record<string, unknown>).polluted
    preferences.dispose()
  })
})
