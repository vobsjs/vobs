import { createVobs, type VobsNode } from '@vobs/vobs'
import { resolveDshReact } from './react.js'

/** React 内联样式对象。 */
export interface DshHostStyle {
  [key: string]: string | number
}

/** 面板外观与定位选项。 */
export interface DshSurfaceOptions {
  /** 注入到 shadow root 的样式表。样式双向隔离：DSH 的全局 CSS 进不来，这里也漏不出去。 */
  styles?: string
  /** 宿主元素的内联样式，决定面板挂在页面哪里。 */
  hostStyle?: DshHostStyle
  /** 配色解析；默认读 DSH 主题写下的 color-scheme，退到 prefers-color-scheme。 */
  scheme?: () => 'light' | 'dark'
}

/** 浮层默认宿主样式：固定右下角、压过一切。 */
export const DEFAULT_OVERLAY_HOST_STYLE: DshHostStyle = {
  position: 'fixed',
  right: '18px',
  bottom: '18px',
  zIndex: 2147483000,
  pointerEvents: 'auto',
  contain: 'layout style'
}

/** 主区域整页默认宿主样式：铺满父容器。 */
export const DEFAULT_PANEL_HOST_STYLE: DshHostStyle = {
  display: 'block',
  width: '100%',
  height: '100%',
  minWidth: 0,
  minHeight: 0
}

/** 侧栏入口图标默认宿主样式。 */
export const DEFAULT_ICON_HOST_STYLE: DshHostStyle = {
  display: 'block',
  width: '100%',
  height: '100%'
}

/**
 * 当前配色。DSH 的主题服务把 `color-scheme` 写在根元素上，
 * 读不到就退到 `prefers-color-scheme`，两者都是标准 API，不依赖 DSH 内部实现。
 */
export function resolveScheme(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'light'
  const declared = (getComputedStyle(document.documentElement).colorScheme ?? '').toLowerCase()
  if (declared.includes('dark')) return 'dark'
  if (declared.includes('light')) return 'light'
  const prefersDark = typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
  return prefersDark ? 'dark' : 'light'
}

/** vobs 面板根节点的类名；配色变量由使用方的样式表定义在它上面。 */
export const DSH_ROOT_CLASS = 'vobs-dsh-root'

/** 由 createVobsSlotHost 产出的 React 组件。 */
export type DshSlotHostComponent = () => unknown

/**
 * 把一个 vobs 渲染函数包成 DSH slot 能接受的 React 组件。
 *
 * 宿主组件本身只做三件事：占一个 DOM 元素、在该元素上开 shadow root、
 * 把 vobs 应用挂进去。所有业务逻辑都在 vobs 里，React 侧永远只有这一个空壳。
 *
 * @param render - vobs 渲染函数（返回 VobsNode），对应 `createVobs({ render })`
 * @param options - 样式、宿主定位与配色解析
 * @returns 可直接交给 `slots.register` 的组件
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

      // 面板根与 <style> 平级：vobs 的 mount 会清空自己的容器，不能连样式一起清掉。
      const root = document.createElement('div')
      root.className = DSH_ROOT_CLASS
      root.dataset.scheme = readScheme()
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
