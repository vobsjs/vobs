// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createResourceClient } from './index'

/*
 * 缓存键不能用"序列化后退化成同一个键"的值。
 *
 * `serialize` 对非数组/Date/RegExp 的对象按**自有可枚举键**拼串，于是 Map、Set、类实例、
 * 只有原型的对象（Object.create({...})）全都变成 `object:{}` —— 不同 key 命中同一条缓存：
 * 第二个 key 的 fetcher 一次都不会调用，却拿到别人的数据（比崩溃隐蔽得多）。
 *
 * 这个包本来就走严格路线（函数/symbol/循环引用直接抛），所以这里也改成抛错，
 * 把"拿错数据"变成一句能照着改的报错。
 */
class User {
  constructor(readonly id: number) {}
}

describe('resource 缓存键的可靠性', () => {
  it('Map / Set / 类实例 / 原型对象 一律抛错（原来静默串数据）', () => {
    const client = createResourceClient()
    const make = (key: readonly unknown[]) => client.resource({ key, fetcher: () => Promise.resolve(1) })

    expect(() => make([new Map([['a', 1]])])).toThrowError(/Map/)
    expect(() => make([new Set([1, 2])])).toThrowError(/Set/)
    expect(() => make([new User(7)])).toThrowError(/User/)
    expect(() => make([Object.create({ a: 1 }) as object])).toThrowError(/普通对象/)
    client.clear()
  })

  it('普通对象仍然按内容区分（没有把正常用法一起打死）', async () => {
    const client = createResourceClient()
    const a = client.resource({ key: [{ id: 1 }], fetcher: () => Promise.resolve('one') })
    const b = client.resource({ key: [{ id: 2 }], fetcher: () => Promise.resolve('two') })

    await a.prefetch()
    await b.prefetch()
    expect(a.data.value).toBe('one')
    expect(b.data.value).toBe('two')

    a.dispose(); b.dispose(); client.clear()
  })

  it('数组 / Date / RegExp / 基本类型 / null 原型对象都还能用', async () => {
    const client = createResourceClient()
    const nullProto = Object.create(null) as Record<string, unknown>
    nullProto.id = 3

    const item = client.resource({ key: ['a', 1, true, new Date(0), /x/i, nullProto], fetcher: () => Promise.resolve('ok') })
    await item.prefetch()
    expect(item.data.value).toBe('ok')
    item.dispose(); client.clear()
  })
})
