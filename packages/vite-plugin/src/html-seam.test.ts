// @vitest-environment node

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { vobsPlugin } from './index'

/*
 * `resolveId` 与 `load` 之间只隔 6 行代码，却各用一套路径表示：
 * `resolveId` 返回 `path.resolve(...)` 的**原始**串（Windows 上是反斜杠），
 * 而 Vite 传给 `load` 的是**正斜杠** id；`load` 拿 `htmlModules.has(id)` 精确匹配，
 * 于是永远不命中 → 返回 null → 裸 HTML 落到 `vite:import-analysis` 被当 JS 解析并报
 * `Failed to parse source for import analysis because the content contains invalid JS syntax`。
 *
 * 整个 HTML 组件功能因此**在 Windows 上完全失效**，而原测试里唯一触及这条接缝的用例
 * （index.test.ts:235-243）只断言了 `resolveId` 的返回值 truthy、
 * **从不把它喂回 `load`** —— 所以这条断链从未被测出。
 *
 * 这里补的正是那个缺失的动作：把 resolveId 的结果原样交给 load。
 */
const tempDir = mkdtempSync(path.join(tmpdir(), 'vobs-html-seam-'))
afterAll(() => { rmSync(tempDir, { recursive: true, force: true }) })

const HTML = '<!doctype html><main>seam</main>\n'

function pluginHooks() {
  const plugin = vobsPlugin({ hmr: false })
  const { resolveId, load } = plugin
  if (typeof resolveId !== 'function' || typeof load !== 'function') {
    throw new Error('Vobs Vite Plugin: 缺少 HTML 模块钩子')
  }
  return { resolveId, load }
}

describe('HTML 组件的 resolveId → load 接缝', () => {
  it('resolveId 的结果必须是 POSIX 形态（Vite 的 id 约定）', () => {
    const { resolveId } = pluginHooks()
    const importer = path.join(tempDir, 'Page.tsx')
    const resolved = resolveId.call({} as never, './content.html', importer, { attributes: {}, isEntry: false } as never)
    expect(typeof resolved).toBe('string')
    expect(resolved as string).not.toContain('\\')
    expect(resolved as string).toContain('/')
  })

  it('把 resolveId 的结果原样喂给 load，必须拿到编译后的组件', async () => {
    const { resolveId, load } = pluginHooks()
    const htmlFile = path.join(tempDir, 'content.html')
    writeFileSync(htmlFile, HTML, 'utf8')

    const resolved = resolveId.call({} as never, './content.html', path.join(tempDir, 'Page.tsx'), { attributes: {}, isEntry: false } as never) as string
    const code = await load.call({} as never, resolved, { attributes: {}, isEntry: false } as never)
    // 修复前：Windows 上 resolved 是反斜杠串 → load 返回 null → 这里拿到 null
    expect(code).toBeTypeOf('string')
    expect(code as string).toContain('createElement("main")')
  })

  it('load 也认得反斜杠形态 id（对调用方形态的防御）', async () => {
    const { resolveId, load } = pluginHooks()
    // 必须**先经 resolveId 登记**，否则它本来就不该被认领（那是另一个用例）
    const importer = path.join(tempDir, 'Backslash.tsx')
    const resolved = resolveId.call({} as never, './content.html', importer, { attributes: {}, isEntry: false } as never) as string
    const backslashed = resolved.replace(/\//gu, '\\')

    // 有些调用方/平台组合会传反斜杠形态；两个形态都应命中，不该一边命中一边静默 null
    const viaBackslash = await load.call({} as never, backslashed, { attributes: {}, isEntry: false } as never)
    expect(viaBackslash).toBeTypeOf('string')
    expect(viaBackslash as string).toContain('createElement("main")')
  })

  it('未被导入的 HTML 不给加载器（真值断言之外还要 null 一边）', async () => {
    const { load } = pluginHooks()
    const stray = path.join(tempDir, 'stray.html')
    writeFileSync(stray, HTML, 'utf8')
    expect(await load.call({} as never, stray, { attributes: {}, isEntry: false } as never)).toBeNull()
  })
})
