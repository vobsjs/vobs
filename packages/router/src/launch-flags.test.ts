// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'

/*
 * 启动开关（hasLaunchFlag / readLaunchQuery）——Finora 死穴「URL 开关参数」的标准件。
 *
 * 语义：模块加载时捕获一次（SPA 内跳转改写 URL 不影响已捕获值）；
 * history 形态（/?cloud）与 hash 形态（/#/path?cloud）都识别。
 * 模块级捕获 = 测试用 vi.resetModules + 动态 import 重求值。
 */
const freshImport = async (): Promise<typeof import('./index')> => {
  vi.resetModules()
  return await import('./index')
}

describe('启动开关（hasLaunchFlag / readLaunchQuery）', () => {
  it('history 形态：search 里的开关被捕获', async () => {
    window.history.replaceState(null, '', '/?cloud&shell=cockpit')
    const { hasLaunchFlag, readLaunchQuery } = await freshImport()
    expect(hasLaunchFlag('cloud')).toBe(true)
    expect(readLaunchQuery('shell')).toBe('cockpit')
    expect(hasLaunchFlag('nonexistent')).toBe(false)
    expect(readLaunchQuery('nonexistent')).toBeNull()
  })

  it('hash 形态：#/path?cloud 同样识别', async () => {
    window.history.replaceState(null, '', '/#/workbench?cloud')
    const { hasLaunchFlag, readLaunchQuery } = await freshImport()
    expect(hasLaunchFlag('cloud')).toBe(true)
    expect(readLaunchQuery('cloud')).toBe('')
  })

  it('search 与 hash 段同时存在时都可读', async () => {
    window.history.replaceState(null, '', '/?cloud#/path?shell=cockpit')
    const { hasLaunchFlag, readLaunchQuery } = await freshImport()
    expect(hasLaunchFlag('cloud')).toBe(true)
    expect(readLaunchQuery('shell')).toBe('cockpit')
  })

  it('捕获一次语义：SPA 内跳转改写 URL 后开关不漂移', async () => {
    window.history.replaceState(null, '', '/?cloud')
    const { hasLaunchFlag } = await freshImport()
    expect(hasLaunchFlag('cloud')).toBe(true)

    // 路由跳转（pushState 改 URL、丢掉 query）——已捕获的开关不受影响
    window.history.replaceState(null, '', '/accounts')
    expect(hasLaunchFlag('cloud')).toBe(true)
  })

  it('无开关时全部返回否定', async () => {
    window.history.replaceState(null, '', '/plain')
    const { hasLaunchFlag, readLaunchQuery } = await freshImport()
    expect(hasLaunchFlag('cloud')).toBe(false)
    expect(readLaunchQuery('cloud')).toBeNull()
  })
})
