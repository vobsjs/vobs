// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { defaultDarkTheme, defaultLightTheme } from './index'

/*
 * 主题 token 的键 = 写出去的 CSS 变量名，必须与 CSS 消费方**同名**。
 *
 * 原来 JS 侧写 `colorScheme`（展平后是 `--vobs-colorScheme`），而全仓唯一的消费方
 * `packages/ui/src/styles/base.css` 里 `:root { color-scheme: var(--vobs-color-scheme, dark) }`
 * 读的是连字符拼法 —— 两种拼法从不交汇，那条规则**永远走 fallback**，
 * 原生控件 / 滚动条 / body 底色不跟主题。
 *
 * 这个测试把两侧绑在一起：JS 默认 token 提供的变量名，必须真的出现在 base.css 的引用里。
 */
const baseCss = readFileSync(resolve(process.cwd(), 'packages/ui/src/styles/base.css'), 'utf8')
const tokensCss = readFileSync(resolve(process.cwd(), 'packages/ui/src/styles/tokens.css'), 'utf8')

describe('theme 与 CSS 的变量名契约', () => {
  it('默认主题不再用驼峰拼法（那会与 CSS 消费方错开）', () => {
    expect(Object.keys(defaultLightTheme)).not.toContain('colorScheme')
    expect(Object.keys(defaultDarkTheme)).not.toContain('colorScheme')
    expect(Object.keys(defaultLightTheme)).toContain('--vobs-color-scheme')
    expect(defaultLightTheme['--vobs-color-scheme']).toBe('light')
    expect(defaultDarkTheme['--vobs-color-scheme']).toBe('dark')
  })

  it('CSS 侧确实消费这个变量名（两边不会再次漂移）', () => {
    expect(baseCss).toContain('var(--vobs-color-scheme')
    expect(tokensCss).toContain('--vobs-color-scheme:')
  })
})
