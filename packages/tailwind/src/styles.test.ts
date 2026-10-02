// @vitest-environment node

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { compile } from 'tailwindcss'

/*
 * 这份测试原来只断言"源码字符串里含 `prefix(vobs)`" —— **假绿**：读起来像在验证前缀生效，
 * 而 Tailwind 会**静默忽略**写在 `utilities.css` 上的 `prefix()`（实测 `.flex` 照常生成）。
 * 样式表行为不能用字符串断言证明，所以这里接真实编译器（`tailwindcss` 是本包的声明依赖，
 * v4 暴露 `compile`）。相对说明符（`./theme.css`）按 Tailwind 给的 base 解析。
 */
const requireFromTailwind = createRequire(resolve(process.cwd(), 'packages/tailwind/package.json'))
const entriesDir = resolve(process.cwd(), 'packages/tailwind/src')

async function loadStylesheet(id: string, base: string): Promise<{ path: string; base: string; content: string }> {
  // 裸 `tailwindcss` 经 exports 映射到 index.css；createRequire 会解析成 JS 入口，得改写
  const path = id.startsWith('.')
    ? resolve(base, id)
    : requireFromTailwind.resolve(id === 'tailwindcss' ? 'tailwindcss/index.css' : id)
  return { path, base: dirname(path), content: readFileSync(path, 'utf8') }
}

async function buildEntry(entry: string, candidates: readonly string[]): Promise<string> {
  const compiler = await compile(readFileSync(resolve(entriesDir, entry), 'utf8'), {
    base: entriesDir,
    loadStylesheet
  })
  return compiler.build([...candidates])
}

function readEntry(entry: string): string {
  return readFileSync(resolve(entriesDir, entry), 'utf8')
}

describe('@vobs/tailwind CSS entries', () => {
  it('styles.css 生成无前缀实用类，且不引入 Tailwind Preflight', async () => {
    const output = await buildEntry('styles.css', ['flex', 'p-4'])
    expect(output).toContain('.flex')
    expect(output).toContain('.p-4')
    expect(output).not.toContain('.vobs\\:flex')

    const source = readEntry('styles.css')
    expect(source).toContain('tailwindcss/theme.css')
    expect(source).toContain('./theme.css')
    expect(source).not.toContain('tailwindcss/preflight.css')
  })

  it('styles-prefixed.css 真的产出带 vobs: 前缀的实用类（编译器验证）', async () => {
    const output = await buildEntry('styles-prefixed.css', ['flex', 'vobs:flex', 'vobs:p-4'])
    expect(output).toContain('.vobs\\:flex')
    expect(output).toContain('.vobs\\:p-4')
    // 前缀生效时，未加前缀的类名不该出现 —— 这正是"隔离第三方类名冲突"的含义
    expect(output).not.toContain('.flex {')
    expect(output).not.toContain('.p-4 {')
  })
})
