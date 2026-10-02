// @vitest-environment node

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { compile } from 'tailwindcss'

/*
 * 这是**级联前提的结构校验，不是视觉验证**。
 *
 * 机理（.artifacts/reports/tailwind.md blocker #2）：CSS 规范里**未分层的普通声明优先于
 * 任何分层声明**（优先于特异性），所以 `ui/src/styles/base.css` 里那条
 * `* { box-sizing: border-box; margin: 0; padding: 0; }` 如果不进层，就会压住本入口
 * `layer(utilities)` 的 `m-*` / `p-*`。修法有两半：① 入口显式声明层序、② reset 整体进 `base` 层。
 *
 * ⚠️ **本文件证明的是"规则落在哪个层里"（结构），不是"浏览器里 margin 真的是 4px"（视觉）**：
 * jsdom 不应用外部样式表、更不做层叠/层序计算；`tailwindcss` 的 `compile()` 也只做编译期分层。
 * 真实视觉效果必须用真实浏览器核验（见 blocker #2 报告）。
 *
 * 另一条实测结论（这半张施工图必须偏离原文，理由可咬）：
 * `@import "./theme.css" layer(base);` 会让 `compile()` **抛错**
 * "`@custom-variant` cannot be nested"（theme.css 里的 `@custom-variant dark (…)` 不能嵌套在
 * 任何 `@layer` 内）。而 theme.css 的产出也不会留在层外：`@custom-variant` 不产出任何 CSS，
 * `@theme inline` 不产出声明，`@theme`（非 inline）产出的变量被 Tailwind 放进 `@layer theme`（实测）。
 * 所以真正要守的是**性质**——"入口产物里不存在任何未分层的规则块"——而不是某个 import 的语法写法。
 * 下面第 3 条用编译产物断言这条性质：往 theme.css / styles.css 里直接补一条普通规则
 * （如 `* { margin: 0 }`）就会让用例变红（已实测）。
 */
const entriesDir = resolve(process.cwd(), 'packages/tailwind/src')
const requireFromTailwind = createRequire(resolve(process.cwd(), 'packages/tailwind/package.json'))
const LAYER_ORDER = '@layer theme, base, components, utilities;'

async function loadStylesheet(id: string, base: string): Promise<{ path: string; base: string; content: string }> {
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

/** 只留代码、剥掉注释 —— 本文件自己的说明里会引用 `@import` / `@layer` 字样，断言必须看代码。 */
function codeOnly(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** 花括号配平（先剥注释）；返回 0 表示这段 CSS 的块都闭合了。 */
function braceDepth(css: string): number {
  const stripped = codeOnly(css)
  let depth = 0
  for (const ch of stripped) {
    if (ch === '{') depth++
    else if (ch === '}') depth--
  }
  return depth
}

/** 剥掉所有 `@layer …;` 语句与 `@layer …{ … }` 块，返回剩下的"未分层"内容。 */
function stripLayersAndComments(css: string): string {
  const kept: string[] = []
  let i = 0
  while (i < css.length) {
    const open = css.indexOf('@layer', i)
    if (open === -1) {
      kept.push(css.slice(i))
      break
    }
    kept.push(css.slice(i, open))
    const semi = css.indexOf(';', open)
    const brace = css.indexOf('{', open)
    if (brace === -1 || (semi !== -1 && semi < brace)) {
      i = semi + 1 // `@layer a, b;` 语句
      continue
    }
    let depth = 0
    let j = brace
    for (; j < css.length; j++) {
      if (css[j] === '{') depth++
      else if (css[j] === '}' && --depth === 0) {
        j++
        break
      }
    }
    i = j // 整个 `@layer x { … }` 块被丢弃
  }
  return kept.join('').replace(/\/\*[\s\S]*?\*\//g, '').trim()
}

describe('@vobs/tailwind 层序（级联前提，非视觉验证）', () => {
  it('入口声明完整的层序 theme, base, components, utilities（base 必须低于 utilities）', () => {
    const source = codeOnly(readFileSync(resolve(entriesDir, 'styles.css'), 'utf8'))
    expect(source).toContain(LAYER_ORDER)
    // @layer 语句是唯一允许出现在 @import 之前的规则；反过来会让 @import 失效
    expect(source.indexOf(LAYER_ORDER)).toBeLessThan(source.indexOf('@import'))
    // utilities 是层序里的最后一项 = 优先级最高（这半条是 blocker #2 的根）
    expect(LAYER_ORDER.indexOf('base')).toBeLessThan(LAYER_ORDER.indexOf('utilities'))
  })

  it('ui/src/styles/base.css 整体位于 @layer base 内，且不含 @import', () => {
    const baseCss = codeOnly(readFileSync(resolve(process.cwd(), 'packages/ui/src/styles/base.css'), 'utf8'))
    const open = baseCss.indexOf('@layer base {')
    expect(open).toBeGreaterThan(-1)
    // CSS 禁止 @import 出现在 @layer 块内 —— 整份文件进层的前提就是"无 @import"
    expect(baseCss).not.toContain('@import')
    // reset 这条必须在层内：留在层外的 `* { margin: 0 }` 会压住 layer(utilities) 的 m-*/p-*
    expect(baseCss.slice(open)).toContain('* { box-sizing: border-box; margin: 0; padding: 0; }')
    // 从 `@layer base {` 到文件末尾括号配平 = 240 行全部在层内（不是只包了一段）
    expect(braceDepth(baseCss.slice(open))).toBe(0)
  })

  it('入口编译产物里没有未分层的规则块（theme.css 保持未分层的安全前提）', async () => {
    const output = await buildEntry('styles.css', ['flex', 'p-4', 'm-4', 'text-brand', 'dark:flex'])
    // 层序语句必须真的落进产物，而不是只写在源码注释里
    expect(output).toContain(LAYER_ORDER)
    // 实用类必须落在 utilities 层里（layer 块内）
    expect(output).toContain('@layer utilities {')
    expect(output).toContain('.m-4')
    // theme.css 的安全性来自"它不产出声明"：把已分层的块全剥掉后，产物应当什么都不剩
    expect(stripLayersAndComments(output)).toBe('')
  })
})
