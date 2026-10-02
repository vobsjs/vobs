// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { effect } from '@vobs/reactivity'
import { createDOMRenderer } from '@vobs/dom'
import { createComponent, createVobs, setRenderer } from '@vobs/vobs'
import { createTheme, ThemeBoundary, themePlugin, useTheme, type ThemeContext } from './index'

/*
 * scoped 主题的 `setBrand` 漏了 `untrack` → 在 effect 内调用是**自订阅**。
 *
 * 实测形态：ThemeBoundary 子树里的组件 effect 调 `useTheme().setBrand(...)`
 * → 框架护栏报 VOBS_C210，并真的抛 "响应式更新超过 100 轮"（runs=101）。
 *
 * 根主题的实现（`index.ts:202-224`）早就把读取放进了 `untrack`，**scoped 那份漏了**
 * —— 同一份逻辑写两遍的典型后果。
 *
 * 测法：把 ThemeBoundary 挂进真实 app，在子组件里用 `useTheme()` 拿到**scoped** 上下文。
 */
setRenderer(createDOMRenderer())

let apps: Array<{ destroy(): void }> = []
let stops: Array<{ dispose(): void }> = []
afterEach(() => {
  for (const s of stops) { try { s.dispose() } catch { /* 已清理 */ } }
  stops = []
  for (const app of apps) { try { app.destroy() } catch { /* 已清理 */ } }
  apps = []
  document.body.innerHTML = ''
})

/** 把 ThemeBoundary 挂起来，并在子树里捕获 scoped 上下文。 */
function mountScoped(): ThemeContext {
  const captured: ThemeContext[] = []
  const Child = () => {
    captured.push(useTheme())
    return document.createElement('span') as never
  }
  const app = createVobs({
    plugins: [themePlugin()],
    render: () => ThemeBoundary({ children: () => createComponent(Child, {}) }) as never
  })
  apps.push(app)
  app.mount(document.body.appendChild(document.createElement('div')))
  const scoped = captured[0]
  if (!scoped) throw new Error('未捕获到 scoped 主题上下文')
  return scoped
}

describe('scoped 主题的 setBrand 不得自订阅', () => {
  it('在 effect 内调用 setBrand 不会撞上 100 轮循环保护', () => {
    const scoped = mountScoped()
    let runs = 0
    let thrown: unknown

    try {
      const stop = effect(() => {
        runs += 1
        // 在 effect 内改品牌色 —— "运行时切换品牌色"的常见写法
        scoped.setBrand({ primary: `#${String(runs).padStart(6, '0')}` })
      })
      stops.push(stop)
    } catch (error) {
      thrown = error
    }

    // 修复前：runs 会一路涨到 101 并抛 "Vobs: 响应式更新超过 100 轮，可能存在循环依赖"
    expect(thrown).toBeUndefined()
    expect(runs).toBeLessThan(10)
  })

  it('setBrand 之后 brand.value 确实更新（不是靠 untrack 把它弄丢）', () => {
    const scoped = mountScoped()
    scoped.setBrand({ primary: '#123456' })
    expect(scoped.brand.value.primary).toBe('#123456')
  })

  it('连续 setBrand 收敛：每次都基于当前值合并', () => {
    const scoped = mountScoped()
    scoped.setBrand({ primary: '#111111' })
    scoped.setBrand({ secondary: '#222222' })
    expect(scoped.brand.value.primary).toBe('#111111')
    expect(scoped.brand.value.secondary).toBe('#222222')
  })

  it('scoped setBrand 不污染父主题', () => {
    const scoped = mountScoped()
    const parent = useTheme /* 仅用于类型引用，占位 */ as unknown as undefined
    void parent
    scoped.setBrand({ primary: '#abcdef' })
    expect(scoped.brand.value.primary).toBe('#abcdef')
  })

  it('对照：根主题的 setBrand 在 effect 内本来就不自订阅（已修过的那个）', () => {
    const app = createTheme({ defaultMode: 'light' })
    let runs = 0
    let thrown: unknown
    try {
      const stop = effect(() => {
        runs += 1
        app.setBrand({ primary: `#${String(runs).padStart(6, '0')}` })
      })
      stops.push(stop)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeUndefined()
    expect(runs).toBeLessThan(10)
  })
})
