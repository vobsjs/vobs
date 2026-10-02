// @vitest-environment jsdom
/*
 * HMR 刷新时组件返回空值不能崩（1.8.0 修复漏掉的另一半）。
 *
 * ## 缺陷
 *
 * `createComponent` 有两条渲染路径：
 * - **首屏**（`const node = isRenderableNode(rendered) ? … : createComment('vobs:empty')`）
 *   —— 1.8.0 修好了空返回值
 * - **HMR 刷新**（`refreshInstance`，由 `hmr.ts` 调用）—— **没修**：
 *   `nodeOwners.set(next as object, owner)` 拿到 `null` 当 WeakMap 的 key →
 *   抛 `Invalid value used as weak map key`，与 9/30 发版黑屏同一个错误
 *
 * ## 实际后果（如实定级：**不是生产崩溃**）
 *
 * `hmr.ts` 把 `instance.refresh()` 包在 try/catch 里，异常被吞掉 —— 但那个 catch
 * 自己的注释写着后果：
 *   「静默吞掉会让开发者以为热更新成功了，而屏幕上是旧的 —— 最容易被当成
 *    「改了没生效」查半天」
 *
 * 即：**开发期改了代码、热更新刷新失败、屏幕停在旧版本**。
 *
 * ## 走的是真实 HMR 路径
 *
 * 用 `resolveComponent` 拿到 HMR 代理（编译器注入的代码用的就是它），
 * 挂载后 `updateHmrModule` 换上新版本 —— 这样 `module.instances` 里才**真的**有实例，
 * `refresh()` 才会被调用。
 *
 * ⚠️ 我第一版测试**没有走这条路**：直接 `createComponent` + `updateHmrModule`，
 * 实例从未注册到该 moduleId，于是 `module.instances` 是空的、`refresh` 根本没跑，
 * 测试全绿但**什么都没验**。咬合（退掉归一化）时它也没变红，才暴露出来。
 *
 * ## 顺带锁住类型层
 *
 * 下面的组件直接 `return cond ? … : null`，**没有类型断言、没有 cast**。
 * 1.8.3 之前会报 `Type 'null' is not assignable to type 'VobsNode'`。
 * 业界一致做法是全放行：React 的 `ReactNode`、Preact 的 `ComponentChild`、
 * Solid 的 `JSX.Element`、Vue 的 `VNodeChild` 都含 `null | undefined | boolean`。
 */
import { describe, expect, it, vi } from 'vitest'
import { scheduler, state } from '@vobs/reactivity'
import { createComponent, createDOMRenderer, createElement, createVobs, setRenderer } from '@vobs/vobs'
import type { VobsNode } from '@vobs/vobs'
import { resolveComponent, updateHmrModule } from './hmr'

setRenderer(createDOMRenderer())
const settle = (): void => { scheduler.flush() }

describe('组件返回空值：类型层（业界一致，直接写不报错）', () => {
  it('`return cond ? <div/> : null` 不需要 cast', () => {
    const open = state(true)
    function MaybeEmpty(): VobsNode | null {
      return open.value ? createElement('div') : null
    }
    expect(typeof MaybeEmpty).toBe('function')
  })

  it('早退式 `if (cond) return null` 同样不需要 cast', () => {
    const loading = state(false)
    function EarlyReturn() {
      if (loading.value) return null
      return createElement('div')
    }
    expect(typeof EarlyReturn).toBe('function')
  })
})

describe('组件返回空值：HMR 刷新路径不能崩', () => {
  const moduleId = '/src/tmp-hmr-return.tsx'

  it('新版本让组件返回 null → 刷新不抛错，且内容真的换成了空', () => {
    const host = document.createElement('main')
    document.body.appendChild(host)

    // ① 用 HMR 代理（编译器注入的代码走的就是 resolveComponent）
    const V1 = (): VobsNode => {
      const el = createElement('div')
      el.textContent = 'v1'
      return el
    }
    const proxied = resolveComponent(V1 as never, moduleId, 'V1')

    const app = createVobs({
      render: () => createComponent(proxied as never, {} as never) as VobsNode
    })
    app.mount(host)
    settle()
    expect(host.textContent, '首屏没渲染出来，后面的断言就没有意义').toBe('v1')

    // ② 换上新版本：返回 null（正是会触发那条未修复路径的形态）
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      expect(
        () => { updateHmrModule(moduleId, { V1: (): VobsNode | null => null }) },
        'HMR 刷新抛错了 —— 异常被 hmr.ts 吞掉，屏幕会停在旧版本'
      ).not.toThrow()
      settle()

      // ③ 证明刷新**真的执行了**（不是"没抛错因为什么都没跑"）
      expect(
        host.textContent,
        '刷新成空之后 DOM 里还是 v1 —— 说明 refresh 根本没被执行，这条测试没验到东西'
      ).toBe('')
      // 刷新失败会被 hmr.ts 记为错误；成功就不该有
      const logged = [...warning.mock.calls, ...error.mock.calls].map(call => String(call[0])).join('\n')
      expect(logged, `刷新留下了错误记录：${logged}`).not.toContain('weak map')
    } finally {
      warning.mockRestore(); error.mockRestore()
    }

    app.destroy(); host.remove()
  })
})
