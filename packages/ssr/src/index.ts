import { createVobs, type VobsApp, type VobsConfig, type VobsPlugin } from '@vobs/vobs'
import { createHydrationRenderer } from './hydration'
import {
  parseState,
  type SSRState,
  type SSRStateOptions
} from './render'

export { createSSRRenderer, escapeHTML, escapeAttribute } from './renderer'
export { createHydrationRenderer } from './hydration'
export type { SSRComment, SSRElement, SSRNode, SSRRenderer, SSRText } from './renderer'
export type { HydrationRenderer } from './hydration'

export {
  renderToString,
  renderToStringAsync,
  createState,
  serializeState,
  parseState
} from './render'
export type {
  AsyncSSRResult,
  SSRDebugSnapshot,
  SSRState,
  I18nSSRState,
  ThemeSSRState,
  I18nSSRContext,
  ThemeSSRContext,
  DictSSRContext,
  SSRStateOptions,
  AsyncSSROptions
} from './render'

export {
  prerenderRoutes,
  renderPage,
  serializeHeadTags,
  applyHead,
  createHeadSync
} from './prerender'
export type {
  HeadTag,
  PrerenderPage,
  PrerenderOptions,
  PrerenderResult,
  PrerenderTemplateParts
} from './prerender'

export function hydrate(
  render: VobsConfig['render'],
  target: string | Element,
  options: SSRStateOptions & { plugins?: VobsPlugin[]; state?: SSRState | string } = {}
): VobsApp<Node> {
  const container = typeof target === 'string' ? document.querySelector(target) : target
  if (!container) throw new Error(`hydrate: 目标不存在: ${target}`)

  const restored = options.state ? parseState(options.state) : undefined
  if (restored?.resources && options.resourceClient) options.resourceClient.hydrate(restored.resources)
  if (restored?.dict && options.dict) options.dict.hydrate(restored.dict)
  if (restored?.i18n && options.i18n) options.i18n.hydrate(restored.i18n)
  if (restored?.theme && options.theme) options.theme.hydrate(restored.theme)

  const hydration = createHydrationRenderer(container)
  const app = createVobs({
    render,
    renderer: hydration.renderer,
    plugins: options.plugins
  })
  app.hydrate(container)
  return app
}
