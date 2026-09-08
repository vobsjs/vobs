import { getCurrentOwner, memo, onDispose, state } from '@vobs/reactivity'
import type { KitViewport } from './types'

export const DEFAULT_MOBILE_BREAKPOINT = 768

export function createKitViewport(breakpoint = DEFAULT_MOBILE_BREAKPOINT): KitViewport {
  const normalizedBreakpoint = normalizeBreakpoint(breakpoint)
  const width = state(readWidth(), 'layout.viewport.width')
  const height = state(readHeight(), 'layout.viewport.height')
  const isMobile = memo(() => width.value < normalizedBreakpoint)
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
