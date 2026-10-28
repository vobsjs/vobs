// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createResourceClient } from './index'

/*
 * Cache keys must not accept values that "degrade into the same key after serialization".
 *
 * `serialize` builds the string for objects other than arrays/Date/RegExp from **own enumerable
 * keys**, so Map, Set, class instances, and prototype-only objects (Object.create({...})) all turn
 * into `object:{}` — different keys hit the same cache entry: the second key's fetcher is never
 * called, yet the caller receives someone else's data (far more insidious than a crash).
 *
 * This package already takes the strict route (functions/symbols/circular references throw
 * directly), so this was changed to throw too, turning "getting the wrong data" into an
 * actionable error message.
 */
class User {
  constructor(readonly id: number) {}
}

describe('resource cache key reliability', () => {
  it('Map / Set / class instances / prototype objects always throw (previously silently cross-contaminated data)', () => {
    const client = createResourceClient()
    const make = (key: readonly unknown[]) => client.resource({ key, fetcher: () => Promise.resolve(1) })

    expect(() => make([new Map([['a', 1]])])).toThrowError(/Map/)
    expect(() => make([new Set([1, 2])])).toThrowError(/Set/)
    expect(() => make([new User(7)])).toThrowError(/User/)
    expect(() => make([Object.create({ a: 1 }) as object])).toThrowError(/plain objects/)
    client.clear()
  })

  it('plain objects are still distinguished by content (normal usage was not broken along the way)', async () => {
    const client = createResourceClient()
    const a = client.resource({ key: [{ id: 1 }], fetcher: () => Promise.resolve('one') })
    const b = client.resource({ key: [{ id: 2 }], fetcher: () => Promise.resolve('two') })

    await a.prefetch()
    await b.prefetch()
    expect(a.data.value).toBe('one')
    expect(b.data.value).toBe('two')

    a.dispose(); b.dispose(); client.clear()
  })

  it('arrays / Date / RegExp / primitives / null-prototype objects still work', async () => {
    const client = createResourceClient()
    const nullProto = Object.create(null) as Record<string, unknown>
    nullProto.id = 3

    const item = client.resource({ key: ['a', 1, true, new Date(0), /x/i, nullProto], fetcher: () => Promise.resolve('ok') })
    await item.prefetch()
    expect(item.data.value).toBe('ok')
    item.dispose(); client.clear()
  })
})
