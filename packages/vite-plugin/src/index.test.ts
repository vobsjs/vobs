import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import { compileHtmlComponent } from './html-component'
import { vobsPlugin } from './index'
import { workspaceAliases } from '../../../scripts/vite-workspace.mjs'

describe('vobsPlugin', () => {
  it('passes compiler plugin config through to TSX transforms', () => {
    const plugin = vobsPlugin({
      compiler: {
        plugins: [{
          name: 'replace-message',
          transform: {
            node(node, context) {
              if (ts.isIdentifier(node) && node.text === 'message') {
                return context.factory.createIdentifier('title')
              }
              return node
            }
          }
        }]
      }
    })
    const transform = plugin.transform
    if (typeof transform !== 'function') throw new Error('Vobs Vite plugin: missing transform hook')

    const result = transform.call({} as ThisParameterType<typeof transform>,
      `export function App() { return <span>{message}</span> }`,
      'src/App.tsx'
    )

    expect(result).toMatchObject({ code: expect.stringContaining('() => title') })
  })

  it('returns a source map and injects a toggleable HMR acceptor', () => {
    const plugin = vobsPlugin()
    const transform = plugin.transform
    if (typeof transform !== 'function') throw new Error('Vobs Vite plugin: missing transform hook')

    const result = transform.call({} as ThisParameterType<typeof transform>,
      `export function App() { return <span>hello</span> }`,
      'src/App.tsx'
    ) as { code: string; map: { sources: string[] } }

    expect(result.map.sources).toEqual(['src/App.tsx'])
    expect(result.code).toContain('import.meta.hot.accept')
    expect(result.code).toContain('updateHmrModule')
  })

  it('HMR injection can be disabled', () => {
    const plugin = vobsPlugin({ hmr: false })
    const transform = plugin.transform
    if (typeof transform !== 'function') throw new Error('Vobs Vite plugin: missing transform hook')

    const result = transform.call({} as ThisParameterType<typeof transform>,
      `export function App() { return <span>hello</span> }`,
      'src/App.tsx'
    ) as { code: string }

    expect(result.code).not.toContain('import.meta.hot.accept')
  })

  it('production builds do not inject HMR code by default', () => {
    const plugin = vobsPlugin()
    const configResolved = plugin.configResolved as ((config: unknown) => void) | undefined
    configResolved?.({ command: 'build' })
    const transform = plugin.transform
    if (typeof transform !== 'function') throw new Error('Vobs Vite plugin: missing transform hook')
    const result = transform.call({} as ThisParameterType<typeof transform>,
      `export const App = () => <main>hello</main>`, 'src/App.tsx') as { code: string }
    expect(result.code).not.toContain('import.meta.hot.accept')
  })

  it('production builds strip component source locations by default; dev builds keep them', () => {
    const compile = (plugin: ReturnType<typeof vobsPlugin>, source: string) => {
      const transform = plugin.transform
      if (typeof transform !== 'function') throw new Error('Vobs Vite plugin: missing transform hook')
      return transform.call({} as ThisParameterType<typeof transform>,
        source, 'src/App.tsx') as { code: string }
    }

    const production = vobsPlugin({ hmr: false })
    ;(production.configResolved as (config: unknown) => void)?.({ command: 'build' })
    const productionCode = compile(production, `export function App() { return <Panel /> }`).code
    expect(productionCode).toContain('createComponent')
    expect(productionCode).not.toContain('file:')

    const development = compile(vobsPlugin(), `export function App() { return <Panel /> }`).code
    expect(development).toContain('file: "src/App.tsx"')
  })

  it('explicit compiler.sourceLocation wins over the production default', () => {
    const plugin = vobsPlugin({ hmr: false, compiler: { sourceLocation: true } })
    const configResolved = plugin.configResolved as ((config: unknown) => void) | undefined
    configResolved?.({ command: 'build' })
    const transform = plugin.transform
    if (typeof transform !== 'function') throw new Error('Vobs Vite plugin: missing transform hook')
    const result = transform.call({} as ThisParameterType<typeof transform>,
      `export function App() { return <Panel /> }`, 'src/App.tsx') as { code: string }
    expect(result.code).toContain('file: "src/App.tsx"')
  })

  it('transforms legal TSX modules without export function', () => {
    const plugin = vobsPlugin({ hmr: false })
    const transform = plugin.transform
    if (typeof transform !== 'function') throw new Error('Vobs Vite plugin: missing transform hook')

    const result = transform.call({} as ThisParameterType<typeof transform>,
      `export const App = () => <main>hello</main>`,
      'src/App.tsx'
    ) as { code: string }

    // Fully static JSX is hoisted to a template clone
    expect(result.code).toContain('createTemplate("<main>hello</main>")')
  })

  it('transforms default arrow exports and TSX modules with a query', () => {
    const plugin = vobsPlugin({ hmr: false })
    const transform = plugin.transform
    if (typeof transform !== 'function') throw new Error('Vobs Vite plugin: missing transform hook')

    const result = transform.call({} as ThisParameterType<typeof transform>,
      `export default () => <main>hello</main>`,
      'src/App.tsx?direct'
    ) as { code: string }

    // Fully static JSX is hoisted to a template clone
    expect(result.code).toContain('createTemplate("<main>hello</main>")')
  })

  it('collects static translation keys via the extractI18n callback', () => {
    const keys: string[] = []
    const plugin = vobsPlugin({ hmr: false, extractI18n: key => keys.push(key) })
    const transform = plugin.transform
    if (typeof transform !== 'function') throw new Error('Vobs Vite Plugin: missing transform hook')

    transform.call({} as ThisParameterType<typeof transform>,
      `export const Page = () => <main>{t('page.title')} {i18n.t('common.ok')}</main>`,
      'src/Page.tsx'
    )

    expect(keys).toEqual(['page.title', 'common.ok'])
  })

  it('injects HMR freshness and an acceptor into .ts state modules (dev default on)', () => {
    const plugin = vobsPlugin()
    const transform = plugin.transform
    if (typeof transform !== 'function') throw new Error('Vobs Vite Plugin: missing transform hook')

    const result = transform.call({} as ThisParameterType<typeof transform>,
      `import { state } from '@vobs/reactivity'\nexport const count = state(0)\n`,
      'src/stores/counter.ts'
    ) as { code: string }

    expect(result.code).toContain('hmrStateRef("src/stores/counter.ts#count"')
    expect(result.code).toContain('import.meta.hot.accept')
  })

  it('ordinary .ts modules and .d.ts are not compiled', () => {
    const plugin = vobsPlugin()
    const transform = plugin.transform
    if (typeof transform !== 'function') throw new Error('Vobs Vite Plugin: missing transform hook')

    expect(transform.call({} as ThisParameterType<typeof transform>, `export const value = 1`, 'src/utils/math.ts')).toBeNull()
    expect(transform.call({} as ThisParameterType<typeof transform>, `export declare const x: number`, 'src/types.d.ts')).toBeNull()
  })

  it('hmrState: false disables .ts state module handling', () => {
    const plugin = vobsPlugin({ hmrState: false })
    const transform = plugin.transform
    if (typeof transform !== 'function') throw new Error('Vobs Vite Plugin: missing transform hook')

    const result = transform.call({} as ThisParameterType<typeof transform>,
      `import { state } from '@vobs/reactivity'\nexport const count = state(0)\n`,
      'src/stores/counter.ts'
    )
    expect(result).toBeNull()
  })

  it('production builds do not inject HMR into .ts state modules', () => {
    const plugin = vobsPlugin()
    ;(plugin.configResolved as (config: unknown) => void)?.({ command: 'build' })
    const transform = plugin.transform
    if (typeof transform !== 'function') throw new Error('Vobs Vite Plugin: missing transform hook')

    const result = transform.call({} as ThisParameterType<typeof transform>,
      `import { state } from '@vobs/reactivity'\nexport const count = state(0)\n`,
      'src/stores/counter.ts'
    )
    expect(result).toBeNull()
  })

  it('compiles HTML modules into Vobs components without innerHTML', () => {
    const result = compileHtmlComponent('<article class="copy"><h1>Hello</h1><p>Safe</p></article>', {
      filename: 'src/content.html'
    })

    expect(result).toContain("createElement(\"article\")")
    expect(result).toContain("setAttribute(element, \"class\", \"copy\")")
    expect(result).toContain('createText(\"Hello\")')
    expect(result).not.toContain('innerHTML')
  })

  it('wires restricted Vobs directives to reactive props and events', () => {
    const result = compileHtmlComponent(`
      <button data-vobs-on-click="onSave" data-vobs-prop-disabled="disabled">
        <span data-vobs-text="label"></span>
        <span data-vobs-slot="actions"></span>
      </button>
    `)

    expect(result).toContain('addEventListener(element, "click"')
    expect(result).toContain('bindProperty(element, "disabled"')
    expect(result).toContain('bindText(text')
    expect(result).toContain('insertDynamic(element, null')
    expect(result).toContain('props["onSave"]')
    expect(result).toContain('bindProperty(element, "disabled"')
  })

  it('rejects scripts, event attributes, and dangerous URLs', () => {
    expect(() => compileHtmlComponent('<script>alert(1)</script>')).toThrow('<script> is not allowed')
    expect(() => compileHtmlComponent('<button onclick="alert(1)">run</button>')).toThrow('dangerous attribute not allowed')
    expect(() => compileHtmlComponent('<a href="javascript:alert(1)">run</a>')).toThrow('dangerous URL attribute not allowed')
    expect(() => compileHtmlComponent('<button data-vobs-on-click="on-click">run</button>')).toThrow('valid props name')
    expect(() => compileHtmlComponent('<div data-vobs-bind-style="styleValue"></div>')).toThrow('dynamic style binding is not allowed')
    expect(() => compileHtmlComponent('<div data-vobs-prop-innerHTML="content"></div>')).toThrow('dynamic property binding is not allowed')
  })

  it('ignores comments and doctype declarations', () => {
    const result = compileHtmlComponent('<!doctype html><!-- note --><main>content</main>')
    expect(result).toContain('createElement(\"main\")')
    expect(result).not.toContain('tagName')
  })

  it('hands only imported HTML files to the component loader', async () => {
    const plugin = vobsPlugin({ hmr: false })
    const resolveId = plugin.resolveId
    const load = plugin.load
    if (typeof resolveId !== 'function' || typeof load !== 'function') throw new Error('Vobs Vite Plugin: missing HTML module hooks')

    expect(resolveId.call({} as ThisParameterType<typeof resolveId>, './content.html', 'src/Page.tsx', { attributes: {}, isEntry: false })).toBeTruthy()
    expect(resolveId.call({} as ThisParameterType<typeof resolveId>, './index.html', undefined, { attributes: {}, isEntry: false })).toBeNull()
  })
})

describe('vobsPlugin development guardrails', () => {
  const GUARDRAILS_ID = '\0virtual:vobs-dev-guardrails'

  const asDev = (plugin: ReturnType<typeof vobsPlugin>): void => {
    ;(plugin.configResolved as (config: unknown) => void | undefined)?.({ command: 'serve' })
  }
  const asBuild = (plugin: ReturnType<typeof vobsPlugin>): void => {
    ;(plugin.configResolved as (config: unknown) => void | undefined)?.({ command: 'build' })
  }

  it('injects the guardrail script into index.html in dev, adding a tag without replacing the HTML', () => {
    const plugin = vobsPlugin()
    asDev(plugin)
    const tags = plugin.transformIndexHtml

    expect(typeof tags === 'function' || (tags !== null && typeof tags === 'object')).toBe(true)
    const hook = (typeof tags === 'object' && tags !== null && 'handler' in tags ? tags.handler : tags) as
      | ((html: string, ctx: unknown) => unknown)
      | undefined
    const result = hook?.('<!doctype html><html><head></head><body></body></html>', {}) as
      | { tag: string; attrs: Record<string, string>; injectTo: string }[]
      | undefined

    expect(Array.isArray(result)).toBe(true)
    expect(result?.[0]?.tag).toBe('script')
    expect(result?.[0]?.attrs.src).toContain('virtual:vobs-dev-guardrails')
    // Returning an html field would replace the entire HTML — it must be a tag array
    expect(result).not.toHaveProperty('html')
  })

  it('does not inject or produce the guardrail module in build', async () => {
    const plugin = vobsPlugin()
    asBuild(plugin)
    const load = plugin.load
    if (typeof load !== 'function') throw new Error('missing load hook')

    expect(await load.call({} as ThisParameterType<typeof load>, GUARDRAILS_ID)).toBeNull()
  })

  it('devGuardrails: false turns it off entirely', async () => {
    const plugin = vobsPlugin({ devGuardrails: false })
    asDev(plugin)
    const load = plugin.load
    if (typeof load !== 'function') throw new Error('missing load hook')

    expect(plugin.transformIndexHtml).toBeDefined()
    expect(await load.call({} as ThisParameterType<typeof load>, GUARDRAILS_ID)).toBeNull()
  })

  it('the guardrail module uses a dynamic import, so a missing @vobs/vobs does not blank the page', async () => {
    const plugin = vobsPlugin()
    asDev(plugin)
    const load = plugin.load
    if (typeof load !== 'function') throw new Error('missing load hook')

    const code = await load.call({} as ThisParameterType<typeof load>, GUARDRAILS_ID) as string
    expect(code).toContain("import('@vobs/vobs/dev')")
    expect(code).not.toMatch(/^import\s/mu)
    // No top-level await: TLA needs both browser and build target support, neither of which is needed here
    expect(code).not.toMatch(/^\s*await\s/mu)
    expect(code).toContain('/__vobs/violation')
    expect(code).toContain('installDevGuardrails')
    // Reports the framework's unified diagnostic fields
    expect(code).toContain('error.fix')
    expect(code).toContain('error.location')
  })

  it('the virtual module id is claimed by resolveId', () => {
    const plugin = vobsPlugin()
    const resolveId = plugin.resolveId
    if (typeof resolveId !== 'function') throw new Error('missing resolveId hook')
    expect(resolveId.call({} as ThisParameterType<typeof resolveId>, GUARDRAILS_ID, undefined, { attributes: {}, isEntry: false }))
      .toBe(GUARDRAILS_ID)
  })

  /*
   * This test is not about coverage; it locks in a real pitfall: the playground alias
   * table does "exact match, or pattern + '/' prefix match", so writing only
   * `@vobs/vobs` for `@vobs/vobs/dev` gets joined into `index.ts/dev` — the dev
   * environment then fails outright with "Failed to resolve import", and only when the
   * page actually loads that module.
   */
  it('every @vobs subpath imported by the guardrail module is an explicit key in the workspace alias table', async () => {
    const plugin = vobsPlugin()
    asDev(plugin)
    const load = plugin.load
    if (typeof load !== 'function') throw new Error('missing load hook')

    const code = await load.call({} as ThisParameterType<typeof load>, GUARDRAILS_ID) as string
    const specifiers = [...code.matchAll(/['"](@vobs\/[^'"]+)['"]/gu)].map(match => match[1])
    expect(specifiers.length).toBeGreaterThan(0)

    const aliases = workspaceAliases()
    const unaliased = specifiers.filter(specifier => !(specifier in aliases))
    expect(unaliased).toEqual([])
  })
})
