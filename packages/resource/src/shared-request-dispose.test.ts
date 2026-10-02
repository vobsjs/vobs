// @vitest-environment jsdom
/*
 * 共享请求：一个 handle 的 `dispose()` 不该打死**别人还在等**的同 key 请求。
 *
 * 审计报告说会（"dispose() 会 abort 掉别的 handle 在用的同一 key 请求"）。
 * 当前源码里 `dispose()` 与 `switchKey()` 都带 `subscribers.size === 0` 守卫，
 * 所以这条**很可能已经被后续修改顺带修掉**了 —— 这里实测结论，不靠读码下判断。
 *
 * 为什么这件事值得锁住：`entry.inFlight` 是**共享**的
 * （`execute` 开头 `if (entry.inFlight) return entry.inFlight`），
 * abort 会同时打死所有等在同一 key 上的调用方。一个组件卸载不该让另一个组件的请求失败，
 * 更不该把这次失败当成"数据加载失败"渲染成错误兜底。
 *
 * 与既有 `cancel-cache.test.ts` 的关系：那条测的是"**只剩一个**订阅者时 dispose 会取消，
 * 且取消不写 error"。这里补的是"**还有别的订阅者**时不该取消" —— 正是缺口所在。
 */
import { describe, expect, it, vi } from 'vitest'
import { createResourceClient } from './index'

interface Deferred<T> { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: unknown) => void }
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

describe('共享请求：dispose() 只在最后一个订阅者离开时才取消', () => {
  it('A 还在飞、B 也在同一 key 上：A.dispose() 不 abort，B 能拿到数据', async () => {
    const client = createResourceClient()
    const gate = deferred<string>()
    const signals: AbortSignal[] = []
    let calls = 0
    const fetcher = (signal: AbortSignal): Promise<string> => {
      calls++
      signals.push(signal)
      return gate.promise
    }

    const a = client.resource({ key: ['shared'], staleTime: 60_000, fetcher })
    const b = client.resource({ key: ['shared'], staleTime: 60_000, fetcher })
    // 两个 handle 指向同一个 entry；构造时各自发起一次（共享 inFlight，只有一次真实调用）
    await vi.waitFor(() => expect(calls).toBe(1))

    a.dispose()
    expect(
      signals[0]?.aborted,
      'A.dispose() abort 了只有 B 还在等的共享请求'
    ).toBe(false)

    gate.resolve('payload')
    await vi.waitFor(() => expect(b.data.value).toBe('payload'))
    expect(b.error.value).toBeNull()
    expect(calls).toBe(1)

    b.dispose()
    client.clear()
  })

  it('最后一个订阅者 dispose 时才 abort（取消语义没有被误伤）', async () => {
    const client = createResourceClient()
    const gate = deferred<string>()
    const signals: AbortSignal[] = []
    const fetcher = (signal: AbortSignal): Promise<string> => { signals.push(signal); return gate.promise }

    const a = client.resource({ key: ['shared2'], staleTime: 60_000, fetcher })
    const b = client.resource({ key: ['shared2'], staleTime: 60_000, fetcher })
    await vi.waitFor(() => expect(signals.length).toBe(1))

    a.dispose()
    expect(signals[0]?.aborted).toBe(false)
    b.dispose()
    // 订阅者清零 → 现在才该取消
    expect(signals[0]?.aborted).toBe(true)

    gate.reject(new Error('cancelled'))
    client.clear()
  })

  it('重复 dispose() 幂等，且不会因为第二次调用误 abort', async () => {
    const client = createResourceClient()
    const gate = deferred<string>()
    const signals: AbortSignal[] = []
    const fetcher = (signal: AbortSignal): Promise<string> => { signals.push(signal); return gate.promise }

    const a = client.resource({ key: ['shared3'], staleTime: 60_000, fetcher })
    const b = client.resource({ key: ['shared3'], staleTime: 60_000, fetcher })
    await vi.waitFor(() => expect(signals.length).toBe(1))

    a.dispose()
    a.dispose()
    expect(signals[0]?.aborted).toBe(false)

    gate.resolve('ok')
    await vi.waitFor(() => expect(b.data.value).toBe('ok'))
    b.dispose()
    client.clear()
  })

  it('A.dispose() 之后 B 仍能正常 refetch', async () => {
    const client = createResourceClient()
    let value = 'first'
    const fetcher = async (): Promise<string> => value

    const a = client.resource({ key: ['shared4'], staleTime: 0, fetcher })
    const b = client.resource({ key: ['shared4'], staleTime: 0, fetcher })
    await a.prefetch()

    a.dispose()
    value = 'second'
    b.invalidate()
    await expect(b.refetch()).resolves.toBe('second')
    expect(b.error.value).toBeNull()

    b.dispose()
    client.clear()
  })
})
