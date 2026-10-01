// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { state } from '@vobs/vobs'
import { createResourceClient } from './index'

/*
 * 取消不是失败 —— 不该把 AbortError 留在**共享缓存**里。
 *
 * 原来 `resource.ts` 的 error 分支在 revision 未变时无条件写 error（只有 onError 那行用
 * aborted 挡住了）。后果会跨页面：一次 refetch 中途被取消/dispose，缓存里就留下
 * `{ data, error: AbortError }`；同 key 的新页面因为 isFresh（staleTime 未到）**零请求**就拿到
 * 这条错误，而 boundary 先判 error → 直接渲染错误兜底。
 *
 * 仓库既有的取消用例（resource.test.ts 的"响应式 key 切换时取消旧请求"）只断言旧信号被
 * abort，**没有断言被取消条目的 error** —— 这个缺口正是 bug 藏身之处。
 */
describe('resource 取消与共享缓存', () => {
  it('被取消的请求不写 error，同 key 的新页面不会零请求拿到 AbortError', async () => {
    const client = createResourceClient()
    let calls = 0
    const makeFetcher = () => (signal: AbortSignal) => {
      calls++
      if (calls === 1) return Promise.resolve('v1')
      return new Promise<string>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('cancelled')))
      })
    }

    const first = client.resource({ key: ['k'], staleTime: 60_000, fetcher: makeFetcher() })
    await first.prefetch()
    expect(first.data.value).toBe('v1')

    const refetching = first.refetch()          // 第二次请求，挂住
    await vi.waitFor(() => expect(calls).toBe(2))
    first.dispose()                             // 取消在飞的那次
    await refetching.catch(() => undefined)

    // 同 key 的"新页面"
    const callsBefore = calls
    const second = client.resource({ key: ['k'], staleTime: 60_000, fetcher: makeFetcher() })
    await second.prefetch()

    expect(second.error.value, '被取消的请求把 AbortError 写进了共享缓存').toBeNull()
    expect(calls).toBe(callsBefore)             // 仍然新鲜 → 没有多余请求
    expect(second.data.value).toBe('v1')

    second.dispose()
    client.clear()
  })

  it('真正的失败仍然写 error（取消的例外没有波及正常错误路径）', async () => {
    const client = createResourceClient()
    const item = client.resource({ key: ['boom'], fetcher: () => Promise.reject(new Error('网络炸了')) })
    await item.prefetch().catch(() => undefined)
    expect(item.error.value?.message).toBe('网络炸了')
    item.dispose()
    client.clear()
  })

  it('reactive key 切换取消旧请求的既有语义不变', async () => {
    const key = state<readonly unknown[]>(['first'])
    const signals = new Map<string, AbortSignal>()
    const client = createResourceClient()
    const item = client.resource({
      key,
      fetcher: currentSignal => new Promise<string>(() => { signals.set(String(key.value[0]), currentSignal) })
    })
    await vi.waitFor(() => expect(signals.get('first')).toBeDefined())
    key.value = ['second']
    await vi.waitFor(() => expect(signals.get('second')).toBeDefined())
    expect(signals.get('first')?.aborted).toBe(true)
    item.dispose()
    client.clear()
    key.dispose()
  })
})
