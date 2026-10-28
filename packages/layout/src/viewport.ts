import { getCurrentOwner, memo, onDispose, state } from '@vobs/reactivity'
import type { KitViewport } from './types'

export const DEFAULT_MOBILE_BREAKPOINT = 768

/**
 * The breakpoint can be a number or a getter.
 *
 * The getter form makes the `mobileBreakpoint` prop **reactive**: KitLayout
 * used to compute it once in the component body and hand the number over
 * (layout.ts:51-54), so changing it afterwards had no effect — verified: after
 * switching the breakpoint from 768 to 600 the `--mobile` class didn't go away
 * (component bodies run once; the computed number was dead).
 */
export function createKitViewport(breakpoint: number | (() => number) = DEFAULT_MOBILE_BREAKPOINT): KitViewport {
  const readBreakpoint = typeof breakpoint === 'function' ? breakpoint : (): number => breakpoint
  const width = state(readWidth(), 'layout.viewport.width')
  const height = state(readHeight(), 'layout.viewport.height')
  // The breakpoint is read inside a memo → when it changes, isMobile follows (validation lives here too; bad values still raise VOBS_KIT002)
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
    throw new Error('VOBS_KIT002: mobileBreakpoint must be a finite number greater than 0')
  }
  return Math.round(value)
}

function readWidth(): number {
  return typeof window === 'undefined' ? DEFAULT_MOBILE_BREAKPOINT + 256 : window.innerWidth
}

function readHeight(): number {
  return typeof window === 'undefined' ? 768 : window.innerHeight
}
