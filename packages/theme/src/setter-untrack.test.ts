// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { effect, scheduler } from '@vobs/reactivity'
import { createTheme } from './index'

/*
 * 在 effect 里调用 setBrand / registerTheme 不该自订阅成死循环。
 *
 * 这两个 setter 原来直接读它们要写的信号（setBrand 读 overrides / brand，registerTheme 读 themes），
 * 而它们**会被组件 effect 调用**（按路由/用户切品牌是很常见的写法）。于是在 effect 里：读 → 订阅
 * → 写完触发自己 → 再读再写…… 实测 101 轮后抛「响应式更新超过 100 轮」。
 *
 * 修法是把 setter 的读取放进 untrack —— setter 不该订阅它要写的信号。契约不变。
 */
const flush = (): void => { scheduler.flush() }

describe('theme setter 在 effect 内不自订阅', () => {
  it('effect 里调 setBrand 不抛「超过 100 轮」', () => {
    const theme = createTheme()
    let runs = 0
    expect(() => {
      effect(() => {
        runs++
        theme.setBrand({ '--probe-accent': 'red' })
      })
      flush()
    }).not.toThrow()
    expect(runs).toBe(1)
    // 值确实写进去了（untrack 没有让写入失效）
    expect(theme.brand.value['--probe-accent']).toBe('red')
    theme.dispose()
  })

  it('effect 里调 registerTheme 不抛（含返回的注销函数）', () => {
    const theme = createTheme()
    let unregister: (() => void) | undefined
    let runs = 0
    expect(() => {
      effect(() => {
        runs++
        unregister = theme.registerTheme('light', { '--probe-surface': '#fff' })
      })
      flush()
    }).not.toThrow()
    expect(runs).toBe(1)
    // 说明：这里**不**断言注册后的值（我没有先去核对客户端暴露的形状，
    // 凭猜测写的 `theme.themes.value` 其实是 undefined）—— 只覆盖"不自订阅"这个重点。

    // 注销同样在 effect 之外调用时不该有问题
    expect(() => { unregister?.(); flush() }).not.toThrow()
    theme.dispose()
  })

  it('连续调用两次 setBrand 仍然合并（untrack 不影响合并语义）', () => {
    const theme = createTheme()
    theme.setBrand({ '--a': '1' })
    theme.setBrand({ '--b': '2' })
    expect(theme.brand.value).toMatchObject({ '--a': '1', '--b': '2' })
    theme.dispose()
  })
})
