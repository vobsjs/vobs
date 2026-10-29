import { describe, expect, it } from 'vitest'
import { bindText, createElement, createText, insertBefore } from '@vobs/dom'
import { createResourceClient, resource, resetDefaultResourceClient } from '@vobs/resource'
import { renderToStringAsync } from './render'

/*
 * The functional `resource()` API uses `@vobs/resource`'s **module-level** client — a
 * process-wide cache. On the server every request shares that same module instance, so
 * entries left by the previous render round get reused verbatim by the next one:
 * empirically, probe `.artifacts/probe-audit-ssr-2.test.mjs` H5/H6 rendered users "alice"
 * then "bob" back to back, and the second output and `dehydrate()` both held **alice**
 * with the fetcher called only once — i.e. the previous user's data went out with the
 * dehydrated snapshot to the next page.
 *
 * Fix: `renderToStringAsync` calls `resetDefaultResourceClient()` in each render's `finally`.
 * A caller-**supplied** `options.resourceClient` is left alone (its lifecycle belongs to the
 * caller).
 */
describe('SSR does not leak the module-level resource cache across requests', () => {
  /** Each render returns its own user based on "which request this is", matching the shape of real requests. */
  const userRender = (seen: string[]) => () => {
    const model = resource({
      key: ['current-user'],
      fetcher: async () => {
        const value = seen.length === 0 ? 'alice' : 'bob'
        seen.push(value)
        return value
      }
    })
    const span = createElement('span')
    const text = createText('')
    insertBefore(span, text, null)
    bindText(text, () => model.data.value ?? 'loading')
    return span
  }

  it('two renders each get their own data (using module-level resource())', async () => {
    resetDefaultResourceClient()
    const seen: string[] = []

    const first = await renderToStringAsync(userRender(seen))
    const second = await renderToStringAsync(userRender(seen))

    expect(first.html).toContain('alice')
    // Before the fix this was alice (reusing the previous round's cache) and the fetcher ran once
    expect(second.html).toContain('bob')
    expect(seen).toEqual(['alice', 'bob'])
  })

  it('every render fetches for real (no module-level cache residue into the next round)', async () => {
    resetDefaultResourceClient()
    const fetches: string[] = []
    const render = () => {
      const span = createElement('span')
      const text = createText('')
      insertBefore(span, text, null)
      const model = resource({
        key: ['counter'],
        fetcher: async () => {
          fetches.push(`fetch-${fetches.length + 1}`)
          return fetches[fetches.length - 1]
        }
      })
      bindText(text, () => model.data.value ?? 'loading')
      return span
    }

    const first = await renderToStringAsync(render)
    const second = await renderToStringAsync(render)

    // Before the fix: the second round fetched nothing and its HTML was character-identical
    // to the first (stale-1)
    expect(first.html).toContain('fetch-1')
    expect(second.html).toContain('fetch-2')
    expect(fetches).toEqual(['fetch-1', 'fetch-2'])
  })

  it('a throwing render leaves no dirty cache for the next request', async () => {
    resetDefaultResourceClient()
    const broken = () => {
      resource({ key: ['current-user'], fetcher: async () => 'alice' })
      throw new Error('boom')
    }

    await expect(renderToStringAsync(broken as never)).rejects.toThrow('boom')

    const seenAfter: string[] = []
    const after = await renderToStringAsync(userRender(seenAfter))
    // Without the finally reset, this would reuse the previous round's 'alice' and the
    // fetcher would never run
    expect(after.html).toContain('alice')
    expect(seenAfter).toEqual(['alice'])
  })

  it('a caller-supplied resourceClient is not reset (its lifecycle belongs to the caller)', async () => {
    const client = createResourceClient()
    let calls = 0
    const model = client.resource({
      key: ['own'],
      staleTime: 60_000,
      fetcher: async () => { calls += 1; return 'value' }
    })
    const render = () => {
      const span = createElement('span')
      const text = createText('')
      insertBefore(span, text, null)
      bindText(text, () => model.data.value ?? 'loading')
      return span
    }

    await renderToStringAsync(render, { resourceClient: client })
    await renderToStringAsync(render, { resourceClient: client })

    // None of the renders ever created an entry on the module-level client, so the
    // module-level reset is irrelevant to this client;
    // this also proves "the passed-in client is not cleared as a side effect by anyone".
    expect(client.get(['own'])?.data).toBe('value')
    client.clear()
  })
})
