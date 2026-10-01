import { getCurrentOwner, memo, onDispose, state } from '@vobs/reactivity'
import type { KitViewport } from './types'

export const DEFAULT_MOBILE_BREAKPOINT = 768

/**
 * 断点可以是数字，也可以是 getter。
 *
 * getter 形式是为了让 `mobileBreakpoint` 这个 prop **响应式**：原来 KitLayout 在组件体里算一次
 * 就把数字交进来了（layout.ts:51-54），于是事后改它毫无作用 —— 实测把断点从 768 改成 600，
 * `--mobile` 类不消失（组件体只执行一次，算出来的数是死的）。
 */
export function createKitViewport(breakpoint: number | (() => number) = DEFAULT_MOBILE_BREAKPOINT): KitViewport {
  const readBreakpoint = typeof breakpoint === 'function' ? breakpoint : (): number => breakpoint
  const width = state(readWidth(), 'layout.viewport.width')
  const height = state(readHeight(), 'layout.viewport.height')
  // 断点读在 memo 里 → 它变了 isMobile 跟着变（校验也在这里做，坏值仍然是 VOBS_KIT002）
  const isMobile = memo(() => width.value < normalizeBreakpoint(readBreakpoint()))
  let disposed = false

  const onResize = (): void => {
    if (disposed) return
    width.value = readWidth()
    height.value = readHeight()
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('resize', onResize)
  }

  const viewport: KitViewport = {
    width,
    height,
    isMobile,
    dispose(): void {
      if (disposed) return
      disposed = true
      if (typeof window !== 'undefined') window.removeEventListener('resize', onResize)
      isMobile.dispose()
      width.dispose()
      height.dispose()
    }
  }

  if (getCurrentOwner()) onDispose(viewport.dispose)
  return viewport
}

export function normalizeBreakpoint(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('VOBS_KIT002: mobileBreakpoint 必须是大于 0 的有限数字')
  }
  return Math.round(value)
}

function readWidth(): number {
  return typeof window === 'undefined' ? DEFAULT_MOBILE_BREAKPOINT + 256 : window.innerWidth
}

function readHeight(): number {
  return typeof window === 'undefined' ? 768 : window.innerHeight
}
