// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createPreferences, definePreferences } from './index'

/*
 * 存档里的 `__proto__` 键不能污染 Object.prototype。
 *
 * `restore()` 原来用 `schema[name]` 判存在性 —— 它会沿原型链查到 `Object.prototype`，于是
 * `__proto__` 键让判断恒为真，最后 `signals['__proto__'].value = value` 就把值写到
 * **Object.prototype** 上（实测 `({}).value = {polluted:true}`，无 onError）。
 * 危害是连锁的：resource / ui/forms / combobox / storage 多处靠 `'value' in x` **认信号** ——
 * 污染后所有普通对象都会被误判成信号。
 *
 * 这里用公开 API 构造恶意存档：先 save() 一次拿到真实存储键，再把该键的内容换成带
 * `__proto__` 自有键的 JSON（必须用 JSON.parse，对象字面量里 `__proto__:` 设的是原型而不是自有键）。
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

describe('preferences 存档原型污染', () => {
  it('__proto__ 键不会写到 Object.prototype，正常键照旧恢复', () => {
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

    expect(({} as Record<string, unknown>).value, 'Object.prototype 被写脏了').toBeUndefined()
    expect(({} as Record<string, unknown>).polluted, '原型被塞进了字段').toBeUndefined()
    expect('value' in {}, '污染会让全仓的 "value" in x 信号识别误判').toBe(false)
    // 正常键仍然恢复（非回归）
    expect((preferences as unknown as { theme: { value: string } }).theme.value).toBe('dark')

    // 防御性清理：万一实现又退化，也不要污染后续测试
    delete (Object.prototype as Record<string, unknown>).value
    delete (Object.prototype as Record<string, unknown>).polluted
    preferences.dispose()
  })
})
