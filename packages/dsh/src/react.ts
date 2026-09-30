/**
 * React 绑定。
 *
 * DSH 的 slot 只接受 React 组件，而 vobs 要把自己的渲染树挂到宿主元素里，
 * 所以适配层必须拿到 React —— 但 **不能把 React 打进产物**：它是 DSH 平台模块表里
 * 的内置模块，只有 `require('react')` 才是同一份实例。
 *
 * 两条取用路径，按顺序：
 *   1. `useDshReact(react)` —— 手动注入，适合自建构建流程的人；
 *   2. `globalThis.__VOBS_DSH_REACT__` —— `dshBundle()` 构建时自动注入，
 *      在 factory 体首行写入 `require('react')` 的结果。
 *
 * 两条都拿不到就抛错，并在信息里给出两种修法。
 */

/** 本适配层实际用到的 React 表面，保持最小以免和真实 React 类型打架。 */
export interface DshReact {
  createElement(type: unknown, props?: unknown, ...children: unknown[]): unknown
  useRef<T>(initial: T | null): { current: T | null }
  useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void
}

/** `dshBundle()` 在 factory 里写入 React 的全局键。 */
export const DSH_REACT_GLOBAL = '__VOBS_DSH_REACT__'

let injected: DshReact | undefined

/** 手动注入 React 绑定（例如 `useDshReact(require('react'))`）。 */
export function useDshReact(react: DshReact): void {
  injected = react
}

/** 取出 React 绑定；`dshBundle()` 的自动注入与手动注入都走这里。 */
export function resolveDshReact(): DshReact {
  const fromGlobal = (globalThis as Record<string, unknown>)[DSH_REACT_GLOBAL] as DshReact | undefined
  const react = injected ?? fromGlobal
  if (!react) {
    throw new Error(
      '@vobs/dsh: 拿不到 DSH 平台提供的 React。\n' +
        '  用 dshBundle() 构建客户端产物（它会自动注入），或在入口模块调用 useDshReact(require("react"))。'
    )
  }
  return react
}

/** 仅供测试：清掉手动注入的绑定。 */
export function resetDshReact(): void {
  injected = undefined
}
