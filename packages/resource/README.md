# @vobs/resource

Signal-backed async data for vobs: keyed request caching, stale-while-revalidate, revision-guarded mutations, and SSR dehydration.

## Install

```bash
npm install @vobs/resource
```

## Quick start

```ts
import { createResourceClient } from '@vobs/resource'

const client = createResourceClient({ staleTime: 30_000, retry: 2 })

const users = client.resource({
  key: ['users', { page: 1 }],
  fetcher: signal => fetch('/api/users?page=1', { signal }).then(res => res.json()),
  strategy: 'stale-while-revalidate'
})

users.loading.value // true while the first request is in flight
users.data.value    // T | null once settled
users.error.value   // Error | null on failure

await users.refetch()
client.invalidate(['users', { page: 1 }])
```

Resources created with the same serialized key share one cache entry and one in-flight request. Results carry a revision: a response that settles after `mutate` or `optimistic` is discarded, so late data never overwrites newer local writes. With `stale-while-revalidate`, cached data is returned immediately while a fresh request runs in the background; `cache-first` re-fetches only after `staleTime` expires.

## API

| Signature | Description |
| --- | --- |
| `createResourceClient(options?: ResourceClientOptions): ResourceClient` | Create a client; options set default `staleTime`, `retry`, `retryDelay`, and `onError`. |
| `resource(fetcher or options): Resource` | Create a resource on the module-level default client. |
| `resetDefaultResourceClient(): void` | Clear the module-level default client's cache. **Server-side rendering must call this between requests** — see below. |
| `client.resource(options): Resource` | Pass `key` to enable caching (also accepts a signal or function key for reactive re-fetch); `cache: false` opts out. |
| `resource.data / error / loading` | Signals for current value, error, and request state. |
| `resource.refetch() / prefetch() / invalidate()` | Force a request, start one opportunistically, or expire the cache. |
| `resource.execute()` | Runs the fetcher now and returns the result; revision-guarded like every settle path. |
| `resource.mutate(next)` | Write through the shared cache immediately. |
| `resource.optimistic(next, action)` | Apply `next`, then roll back and set `error` if `action` rejects. |
| `resource.dispose()` | Detach; aborts the request when it is the last subscriber. |
| `client.invalidate(key) / client.get(key)` | Expire or read a cached snapshot by key. |
| `client.prefetchAll() / dehydrate() / hydrate(snapshot) / clear()` | Await in-flight work, serialize for SSR, restore, and reset. |
| `stableSerialize(value): string` | Deterministic serialization used for cache keys. |
| `serializeResourceState(snapshot): string` | JSON-stringify dehydrated state with HTML-safe escaping. |
| `resourcePlugin(options?) / resourceRouterPlugin(options?)` | Provide the client as `RESOURCE_KEY`; run `route.meta.prefetch` handlers before navigation. |
| `insertResourceBoundary(parent, anchor, options) / ResourceBoundary(props)` | Branch on loading, empty, error, and data of a resource. |

## Server-side rendering: the module client is process-wide

`resource()` (the function form) stores everything in a **module-level** client that is shared by
every request handled by the process. That is fine in the browser and wrong on the server: without a
reset, request #2 reads request #1's cached data with zero fetches and ships it in its own dehydrated
snapshot.

```ts
import { resetDefaultResourceClient } from '@vobs/resource'

await renderToStringAsync(render)          // does this for you: resets in `finally`
resetDefaultResourceClient()               // do it yourself if you drive rendering manually
```

`renderToStringAsync` already calls it after every render (including when the render throws).
Only the **module-level** client is reset — a client you create with `createResourceClient()` and pass
as `options.resourceClient` belongs to you and is never touched.

## Types

Resource, ResourceKey, ResourceKeySource, ResourceFetcher, ResourceOptions, ResourceCacheStrategy, RetryDelay, ResourceSnapshot, ResourceClient, ResourceClientOptions, ResourceDehydratedEntry, ResourceDehydratedState, ResourceBoundaryChild, ResourceBoundaryFallback, ResourceBoundaryOptions, ResourceBoundaryProps, ResourceBoundaryView, ResourcePluginOptions, ResourceRoutePrefetch, ResourceRoutePrefetchContext, ResourceRouterPluginOptions
