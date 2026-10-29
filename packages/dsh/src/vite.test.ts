import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { dshBundle, wrapAsModuleLoaderFactory } from './vite.js'

const tempDirs: string[] = []
afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop() as string, { recursive: true, force: true })
})

interface FakeChunk {
  type: 'chunk'
  fileName: string
  code: string
  map?: unknown
  imports?: readonly string[]
  dynamicImports?: readonly string[]
}

interface FakeAsset {
  type: 'asset'
  fileName: string
}

type FakeBundle = Record<string, FakeChunk | FakeAsset>

interface PluginLike {
  config?: (config: Record<string, unknown>) => void
  configResolved?: (config: { root: string }) => void
  generateBundle?: unknown
}

/** Simulates rollup's plugin context: error throws, warn collects. */
function createPluginContext(): { context: Record<string, unknown>; warnings: string[] } {
  const warnings: string[] = []
  return {
    warnings,
    context: {
      error(message: string): never {
        throw new Error(message)
      },
      warn(message: string): void {
        warnings.push(message)
      },
      meta: { rollupVersion: '4.0.0' }
    }
  }
}

type GenerateBundleHook = (this: unknown, options: { format: string }, bundle: FakeBundle) => void

function generate(plugin: PluginLike, options: { format: string }, bundle: FakeBundle): string[] {
  const { context, warnings } = createPluginContext()
  const hook = plugin.generateBundle as GenerateBundleHook | undefined
  if (hook === undefined) throw new Error('plugin has no generateBundle')
  hook.call(context, options, bundle)
  return warnings
}

const chunkOf = (code = 'exports.default={apply(){}};'): FakeChunk => ({
  type: 'chunk',
  fileName: 'client.cjs',
  code
})

/* ------------------------------------------------------------ Shell wrapping */

describe('wrapAsModuleLoaderFactory', () => {
  const wrapped = wrapAsModuleLoaderFactory('"use strict";\nconsole.log(1)\n//# sourceMappingURL=client.cjs.map\n', 'my-plugin')

  it('produces one factory registration of the DSH client module protocol', () => {
    expect(wrapped.match(/__ModuleLoader__\.load\(/gu)?.length).toBe(1)
    expect(wrapped).toContain('window.__ModuleLoader__.load({id:"my-plugin",factory:function(require){')
  })

  it('provides a module/exports shim so the CJS artifact runs as-is', () => {
    expect(wrapped).toContain('var module={exports:{}};var exports=module.exports;')
  })

  it('prefers the default export', () => {
    expect(wrapped).toContain('out.__esModule')
    expect(wrapped).toContain('Object.prototype.hasOwnProperty.call(out,"default")')
  })

  it('injects the platform React bootstrap', () => {
    expect(wrapped).toContain('globalThis["__VOBS_DSH_REACT__"]=require("react")')
  })

  it('can disable the React bootstrap', () => {
    const off = wrapAsModuleLoaderFactory('exports.default={}', 'p', { react: false })
    expect(off).not.toContain('__VOBS_DSH_REACT__')
  })

  it('strips the leading use strict and sourceMappingURL without leaving a duplicate use strict', () => {
    expect((wrapped.match(/"use strict";/gu) ?? []).length).toBe(1)
    expect(wrapped).not.toContain('sourceMappingURL')
  })
})

/* ------------------------------------------------------------ Build gates */

describe('dshBundle', () => {
  it('wraps a single chunk into client.js', () => {
    const plugin = dshBundle({ id: 'probe-plugin' })
    const bundle: FakeBundle = { 'client.cjs': chunkOf() }
    generate(plugin as PluginLike, { format: 'cjs' }, bundle)

    expect(bundle['client.cjs']).toBeUndefined()
    const emitted = bundle['client.js'] as FakeChunk
    expect(emitted).toBeDefined()
    expect(emitted.fileName).toBe('client.js')
    expect(emitted.code).toContain('__ModuleLoader__.load({id:"probe-plugin"')
    expect(emitted.map).toBeNull()
  })

  it('rejects multiple chunks (the artifact must be self-contained)', () => {
    const plugin = dshBundle({ id: 'p' })
    const bundle: FakeBundle = { 'a.js': chunkOf(), 'b.js': chunkOf() }
    expect(() => generate(plugin as PluginLike, { format: 'cjs' }, bundle)).toThrow(/self-contained/u)
  })

  it('rejects standalone assets', () => {
    const plugin = dshBundle({ id: 'p' })
    const bundle: FakeBundle = { 'client.cjs': chunkOf(), 'style.css': { type: 'asset', fileName: 'style.css' } }
    expect(() => generate(plugin as PluginLike, { format: 'cjs' }, bundle)).toThrow(/standalone assets/u)
  })

  it('rejects non-cjs output formats', () => {
    const plugin = dshBundle({ id: 'p' })
    const bundle: FakeBundle = { 'client.js': chunkOf() }
    expect(() => generate(plugin as PluginLike, { format: 'es' }, bundle)).toThrow(/CJS/u)
  })

  it('drops the invalid sourcemap and warns', () => {
    const plugin = dshBundle({ id: 'p' })
    const bundle: FakeBundle = { 'client.cjs': chunkOf(), 'client.cjs.map': { type: 'asset', fileName: 'client.cjs.map' } }
    const warnings = generate(plugin as PluginLike, { format: 'cjs' }, bundle)
    expect(bundle['client.cjs.map']).toBeUndefined()
    expect(warnings.join('\n')).toMatch(/sourcemap/u)
  })

  it('errors when there is neither id nor package name', () => {
    const plugin = dshBundle()
    const bundle: FakeBundle = { 'client.cjs': chunkOf() }
    expect(() => generate(plugin as PluginLike, { format: 'cjs' }, bundle)).toThrow(/browser module id/u)
  })

  it('config hook folds platform modules into the external predicate while keeping the consumer external', () => {
    const plugin = dshBundle() as PluginLike
    const config: Record<string, unknown> = {
      build: { rollupOptions: { external: ['node:fs'] } }
    }
    plugin.config?.(config)

    const build = config.build as { rollupOptions: { external: (s: string) => boolean } }
    expect(build.rollupOptions.external('react')).toBe(true)
    expect(build.rollupOptions.external('node:fs')).toBe(true)
    expect(build.rollupOptions.external('some-lib')).toBe(false)
  })

  it('config hook fills in cjs single-file lib config when an entry is given', () => {
    const plugin = dshBundle({ entry: 'src/client/index.tsx' }) as PluginLike
    const config: Record<string, unknown> = {}
    plugin.config?.(config)

    const lib = (config.build as { lib: { entry: string; formats: string[] } }).lib
    expect(lib.entry).toBe('src/client/index.tsx')
    expect(lib.formats).toEqual(['cjs'])
  })

  it('config hook does not override an existing lib config', () => {
    const plugin = dshBundle({ entry: 'src/client/index.tsx' }) as PluginLike
    const config: Record<string, unknown> = { build: { lib: { entry: 'other.ts', formats: ['es'] } } }
    plugin.config?.(config)
    expect((config.build as { lib: { entry: string } }).lib.entry).toBe('other.ts')
  })

  it('infers the output directory from exports["./client"] and renames accordingly', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vobs-dsh-bundle-'))
    tempDirs.push(dir)
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'probe', exports: { './client': './lib/client.js' } }),
      'utf8'
    )

    const plugin = dshBundle({ entry: 'src/client/index.tsx' }) as PluginLike
    const config: Record<string, unknown> = { root: dir }
    plugin.config?.(config)
    expect((config.build as { outDir: string }).outDir).toBe('lib')

    // vite's real order: config → configResolved → generateBundle
    const { context } = createPluginContext()
    ;(plugin.configResolved as (this: unknown, c: { root: string }) => void).call(context, { root: dir })

    const bundle: FakeBundle = { 'some-other-name.cjs': { ...chunkOf(), fileName: 'some-other-name.cjs' } }
    generate(plugin, { format: 'cjs' }, bundle)
    expect(bundle['client.js']).toBeDefined()
    expect(bundle['some-other-name.cjs']).toBeUndefined()
  })

  it('warns when outDir disagrees with the manifest', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vobs-dsh-bundle-'))
    tempDirs.push(dir)
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'probe', exports: { './client': './lib/client.js' } }),
      'utf8'
    )
    const plugin = dshBundle() as PluginLike
    const config: Record<string, unknown> = { root: dir, build: { outDir: 'dist' } }
    const { context, warnings } = createPluginContext()
    ;(plugin.config as (this: unknown, c: Record<string, unknown>) => void).call(context, config)
    expect(warnings.join('\n')).toContain('outDir')
  })

  /* -------------------------------------------------- Self-containment (chunk metadata) */

  it('fails the build when unbundled bare imports remain', () => {
    const plugin = dshBundle() as PluginLike
    const bundle: FakeBundle = {
      'client.cjs': { ...chunkOf(), imports: ['@vobs/vobs'] }
    }
    expect(() => generate(plugin, { format: 'cjs' }, bundle)).toThrow(/not self-contained/u)
  })

  it('fails the build when a dynamic import remains too', () => {
    const plugin = dshBundle() as PluginLike
    const bundle: FakeBundle = {
      'client.cjs': { ...chunkOf(), dynamicImports: ['@vobs/dsh'] }
    }
    expect(() => generate(plugin, { format: 'cjs' }, bundle)).toThrow(/not self-contained/u)
  })

  it('platform module (react) staying external does not count as a leftover', () => {
    const plugin = dshBundle({ id: 'probe' }) as PluginLike
    const bundle: FakeBundle = {
      'client.cjs': { ...chunkOf(), imports: ['react'] }
    }
    expect(() => generate(plugin, { format: 'cjs' }, bundle)).not.toThrow()
  })

  /*
   * Regression: the gate once used a regex over the artifact **text** to find `from '@vobs/...'`,
   * which counted "sample code displayed as content" as an unbundled dependency — the devkit
   * panel shows vobs import snippets, so the build failed outright. Reading chunk metadata
   * instead means the same text no longer false-positives.
   */
  it('does not false-positive on @vobs import samples in artifact text (metadata only)', () => {
    const plugin = dshBundle({ id: 'probe' }) as PluginLike
    const code = 'exports.default={apply(){}};const doc="import { state } from \'@vobs/vobs\'";'
    const bundle: FakeBundle = { 'client.cjs': { ...chunkOf(code), imports: [] } }
    expect(() => generate(plugin, { format: 'cjs' }, bundle)).not.toThrow()
  })
})
