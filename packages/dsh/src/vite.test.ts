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

/** 模拟 rollup 的插件上下文：error 抛错、warn 收集。 */
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
  if (hook === undefined) throw new Error('插件没有 generateBundle')
  hook.call(context, options, bundle)
  return warnings
}

const chunkOf = (code = 'exports.default={apply(){}};'): FakeChunk => ({
  type: 'chunk',
  fileName: 'client.cjs',
  code
})

/* ------------------------------------------------------------ 外壳包装 */

describe('wrapAsModuleLoaderFactory', () => {
  const wrapped = wrapAsModuleLoaderFactory('"use strict";\nconsole.log(1)\n//# sourceMappingURL=client.cjs.map\n', 'my-plugin')

  it('产出 DSH 客户端模块协议的一次 factory 注册', () => {
    expect(wrapped.match(/__ModuleLoader__\.load\(/gu)?.length).toBe(1)
    expect(wrapped).toContain('window.__ModuleLoader__.load({id:"my-plugin",factory:function(require){')
  })

  it('提供 module / exports 垫片，让 CJS 产物原样运行', () => {
    expect(wrapped).toContain('var module={exports:{}};var exports=module.exports;')
  })

  it('优先返回 default 导出', () => {
    expect(wrapped).toContain('out.__esModule')
    expect(wrapped).toContain('Object.prototype.hasOwnProperty.call(out,"default")')
  })

  it('注入平台 React 引导', () => {
    expect(wrapped).toContain('globalThis["__VOBS_DSH_REACT__"]=require("react")')
  })

  it('可以关掉 React 引导', () => {
    const off = wrapAsModuleLoaderFactory('exports.default={}', 'p', { react: false })
    expect(off).not.toContain('__VOBS_DSH_REACT__')
  })

  it('剥掉前导 use strict 与 sourceMappingURL，且不留下重复的 use strict', () => {
    expect((wrapped.match(/"use strict";/gu) ?? []).length).toBe(1)
    expect(wrapped).not.toContain('sourceMappingURL')
  })
})

/* ------------------------------------------------------------ 构建门禁 */

describe('dshBundle', () => {
  it('单 chunk 时包装成 client.js', () => {
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

  it('拒绝多 chunk（产物必须自包含）', () => {
    const plugin = dshBundle({ id: 'p' })
    const bundle: FakeBundle = { 'a.js': chunkOf(), 'b.js': chunkOf() }
    expect(() => generate(plugin as PluginLike, { format: 'cjs' }, bundle)).toThrow(/自包含/u)
  })

  it('拒绝独立 asset', () => {
    const plugin = dshBundle({ id: 'p' })
    const bundle: FakeBundle = { 'client.cjs': chunkOf(), 'style.css': { type: 'asset', fileName: 'style.css' } }
    expect(() => generate(plugin as PluginLike, { format: 'cjs' }, bundle)).toThrow(/独立资源/u)
  })

  it('拒绝非 cjs 输出格式', () => {
    const plugin = dshBundle({ id: 'p' })
    const bundle: FakeBundle = { 'client.js': chunkOf() }
    expect(() => generate(plugin as PluginLike, { format: 'es' }, bundle)).toThrow(/CJS/u)
  })

  it('丢弃会失效的 sourcemap 并给出警告', () => {
    const plugin = dshBundle({ id: 'p' })
    const bundle: FakeBundle = { 'client.cjs': chunkOf(), 'client.cjs.map': { type: 'asset', fileName: 'client.cjs.map' } }
    const warnings = generate(plugin as PluginLike, { format: 'cjs' }, bundle)
    expect(bundle['client.cjs.map']).toBeUndefined()
    expect(warnings.join('\n')).toMatch(/sourcemap/u)
  })

  it('没有 id 也没有包名时报错', () => {
    const plugin = dshBundle()
    const bundle: FakeBundle = { 'client.cjs': chunkOf() }
    expect(() => generate(plugin as PluginLike, { format: 'cjs' }, bundle)).toThrow(/模块 id/u)
  })

  it('config 钩子把平台模块并入 external 判定，同时保留使用方的 external', () => {
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

  it('config 钩子在给了 entry 时补上 cjs 单文件 lib 配置', () => {
    const plugin = dshBundle({ entry: 'src/client/index.tsx' }) as PluginLike
    const config: Record<string, unknown> = {}
    plugin.config?.(config)

    const lib = (config.build as { lib: { entry: string; formats: string[] } }).lib
    expect(lib.entry).toBe('src/client/index.tsx')
    expect(lib.formats).toEqual(['cjs'])
  })

  it('config 钩子不覆盖使用方已有的 lib 配置', () => {
    const plugin = dshBundle({ entry: 'src/client/index.tsx' }) as PluginLike
    const config: Record<string, unknown> = { build: { lib: { entry: 'other.ts', formats: ['es'] } } }
    plugin.config?.(config)
    expect((config.build as { lib: { entry: string } }).lib.entry).toBe('other.ts')
  })

  it('从 exports["./client"] 反推产物目录，并据此重命名', () => {
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

    // vite 的真实顺序：config → configResolved → generateBundle
    const { context } = createPluginContext()
    ;(plugin.configResolved as (this: unknown, c: { root: string }) => void).call(context, { root: dir })

    const bundle: FakeBundle = { 'some-other-name.cjs': { ...chunkOf(), fileName: 'some-other-name.cjs' } }
    generate(plugin, { format: 'cjs' }, bundle)
    expect(bundle['client.js']).toBeDefined()
    expect(bundle['some-other-name.cjs']).toBeUndefined()
  })

  it('outDir 与清单不一致时给出警告', () => {
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

  /* -------------------------------------------------- 自包含性（chunk 元数据） */

  it('残留未打包的裸 import 时构建失败', () => {
    const plugin = dshBundle() as PluginLike
    const bundle: FakeBundle = {
      'client.cjs': { ...chunkOf(), imports: ['@vobs/vobs'] }
    }
    expect(() => generate(plugin, { format: 'cjs' }, bundle)).toThrow(/不是自包含/u)
  })

  it('动态 import 残留同样失败', () => {
    const plugin = dshBundle() as PluginLike
    const bundle: FakeBundle = {
      'client.cjs': { ...chunkOf(), dynamicImports: ['@vobs/dsh'] }
    }
    expect(() => generate(plugin, { format: 'cjs' }, bundle)).toThrow(/不是自包含/u)
  })

  it('平台模块（react）保持 external 不算残留', () => {
    const plugin = dshBundle({ id: 'probe' }) as PluginLike
    const bundle: FakeBundle = {
      'client.cjs': { ...chunkOf(), imports: ['react'] }
    }
    expect(() => generate(plugin, { format: 'cjs' }, bundle)).not.toThrow()
  })

  /*
   * 这条是回归：门禁一度用正则在产物**文本**上找 `from '@vobs/...'`，于是把
   * 「作为内容展示的示例代码」也算成未打包依赖 —— 开发台面板展示了 vobs 的 import
   * 写法，构建直接失败。改成读 chunk 元数据后，同样的文本不会再误报。
   */
  it('产物文本里出现 @vobs import 示例不误报（只看元数据）', () => {
    const plugin = dshBundle({ id: 'probe' }) as PluginLike
    const code = 'exports.default={apply(){}};const doc="import { state } from \'@vobs/vobs\'";'
    const bundle: FakeBundle = { 'client.cjs': { ...chunkOf(code), imports: [] } }
    expect(() => generate(plugin, { format: 'cjs' }, bundle)).not.toThrow()
  })
})
