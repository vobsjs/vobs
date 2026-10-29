import { createVobs, type VobsNode } from '@vobs/vobs'
import { resolveDshReact } from './react.js'

/** React inline style object. */
export interface DshHostStyle {
  [key: string]: string | number
}

/** Panel appearance and positioning options. */
export interface DshSurfaceOptions {
  /** Stylesheet injected into the shadow root. Styles are isolated both ways: DSH's global CSS cannot get in, and these rules cannot leak out. */
  styles?: string
  /** Inline style of the host element; determines where the panel sits on the page. */
  hostStyle?: DshHostStyle
  /** Scheme resolution; by default reads the color-scheme written by DSH's theme, falling back to prefers-color-scheme. */
  scheme?: () => 'light' | 'dark'
}

/** Default overlay host style: pinned to the bottom-right corner, above everything else. */
export const DEFAULT_OVERLAY_HOST_STYLE: DshHostStyle = {
  position: 'fixed',
  right: '18px',
  bottom: '18px',
  zIndex: 2147483000,
  pointerEvents: 'auto',
  contain: 'layout style'
}

/** Default full-page host style for the main area: fills the parent container. */
export const DEFAULT_PANEL_HOST_STYLE: DshHostStyle = {
  display: 'block',
  width: '100%',
  height: '100%',
  minWidth: 0,
  minHeight: 0
}

/** Default host style for the sidebar entry icon. */
export const DEFAULT_ICON_HOST_STYLE: DshHostStyle = {
  display: 'block',
  width: '100%',
  height: '100%'
}

/**
 * Current color scheme. DSH's theme service writes `color-scheme` on the root element;
 * if that is unavailable we fall back to `prefers-color-scheme`. Both are standard APIs,
 * with no dependency on DSH internals.
 */
export function resolveScheme(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'light'
  const declared = (getComputedStyle(document.documentElement).colorScheme ?? '').toLowerCase()
  if (declared.includes('dark')) return 'dark'
  if (declared.includes('light')) return 'light'
  const prefersDark = typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
  return prefersDark ? 'dark' : 'light'
}

/** Class name of the vobs panel root; scheme variables are defined on it by the consumer's stylesheet. */
export const DSH_ROOT_CLASS = 'vobs-dsh-root'

/** React component produced by createVobsSlotHost. */
export type DshSlotHostComponent = () => unknown

/**
 * Wraps a vobs render function into a React component that DSH slots accept.
 *
 * The host component itself only does three things: occupy a DOM element, open a shadow
 * root on it, and mount the vobs app inside. All business logic lives in vobs; the React
 * side is forever just this empty shell.
 *
 * @param render - vobs render function (returns a VobsNode), as in `createVobs({ render })`
 * @param options - styles, host positioning and scheme resolution
 * @returns A component ready to hand to `slots.register`
 */
export function createVobsSlotHost(render: () => VobsNode, options: DshSurfaceOptions = {}): DshSlotHostComponent {
  const hostStyle = options.hostStyle ?? DEFAULT_OVERLAY_HOST_STYLE
  const readScheme = options.scheme ?? resolveScheme
  const styles = options.styles

  return function VobsSlotHost(): unknown {
    const React = resolveDshReact()
    const holder = React.useRef<HTMLElement | null>(null)

    React.useEffect(() => {
      const host = holder.current
      if (!host) return undefined

      const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' })

      if (styles) {
        const style = document.createElement('style')
        style.textContent = styles
        shadow.appendChild(style)
      }

      // The panel root sits next to <style>: vobs's mount clears its own container, and must not clear the styles with it.
      const root = document.createElement('div')
      root.className = DSH_ROOT_CLASS
      root.dataset.scheme = readScheme()
      /*
       * The mount container must fill the host so percentage heights keep propagating.
       *
       * Without these two lines, the parent of a `height: 100%` element is an auto-height div,
       * so the percent height degenerates to auto — the panel's internal `overflow: auto`
       * scroll container never activates, and long content just gets clipped by the outer layer.
       * The symptom is "one page grows tall content but cannot scroll".
       */
      root.style.width = '100%'
      root.style.height = '100%'
      shadow.appendChild(root)

      const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null
      const onSchemeChange = (): void => {
        root.dataset.scheme = readScheme()
      }
      media?.addEventListener('change', onSchemeChange)

      const app = createVobs({ render })
      app.mount(root)

      return () => {
        media?.removeEventListener('change', onSchemeChange)
        app.destroy()
        host.shadowRoot?.replaceChildren()
      }
    }, [])

    return React.createElement('div', { ref: holder, style: hostStyle })
  }
}
