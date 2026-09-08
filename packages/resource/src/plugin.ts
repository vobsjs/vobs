import { createInjectionKey, type VobsPlugin } from '@vobs/vobs'
import { ROUTER_KEY, type RouteLocation, type Router } from '@vobs/router'
import { createResourceClient, type ResourceClient, type ResourceClientOptions } from './resource'

export const RESOURCE_KEY = createInjectionKey<ResourceClient>('vobs.resource')

export interface ResourcePluginOptions extends ResourceClientOptions {
  client?: ResourceClient
}

export interface ResourceRoutePrefetchContext {
  readonly route: RouteLocation
  readonly client: ResourceClient
}

export type ResourceRoutePrefetch = (
  context: ResourceRoutePrefetchContext
) => unknown | PromiseLike<unknown>

export interface ResourceRouterPluginOptions {
  readonly router?: Router
  readonly client?: ResourceClient
}

export function resourcePlugin(options: ResourcePluginOptions = {}): VobsPlugin {
  return {
    name: '@vobs/resource',
    version: '0.1.0',
    install(context) {
      const client = options.client ?? createResourceClient(options)
      context.provide(RESOURCE_KEY, client)
      return () => {
        if (!options.client) client.clear()
      }
    }
  }
}

export function resourceRouterPlugin(options: ResourceRouterPluginOptions = {}): VobsPlugin {
  return {
    name: '@vobs/resource-router',
    version: '0.1.0',
    install(context) {
      const router = options.router ?? context.inject(ROUTER_KEY)
      const client = options.client ?? context.inject(RESOURCE_KEY)
      if (!router) throw new Error('Vobs Resource Router: 找不到 Router，请安装 routerPlugin 或传入 router')
      if (!client) throw new Error('Vobs Resource Router: 找不到 ResourceClient，请安装 resourcePlugin 或传入 client')

      return router.beforeEach(async to => {
        const prefetch = readPrefetch(to)
        await Promise.all(prefetch.map((task, index) => router.devtools.trackDataRequest(
          'loader',
          `${to.fullPath}#prefetch-${index + 1}`,
          () => task({ route: to, client }),
          { route: to.fullPath, trigger: 'resource' }
        )))
      })
    }
  }
}

function readPrefetch(route: RouteLocation): readonly ResourceRoutePrefetch[] {
  const value = route.meta.prefetch
  if (value === undefined) return []
  if (typeof value === 'function') return [value as ResourceRoutePrefetch]
  if (!Array.isArray(value) || value.some(task => typeof task !== 'function')) {
    throw new Error('Vobs Resource Router: route.meta.prefetch 必须是函数或函数数组')
  }
  return value as ResourceRoutePrefetch[]
}
