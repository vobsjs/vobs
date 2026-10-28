import {
  createFragment,
  createElement,
  insertBefore,
  insertDynamic,
  setAttribute,
  type VobsNode
} from '@vobs/vobs'
import {
  bindClassList,
  bindCommonAttributes,
  bindUserStyle,
  readProp,
  resolveSlot
} from './utils'
import type { VuiChildren, VuiCommonProps } from './types'

export type ProgressTone = 'brand' | 'ok' | 'warn' | 'bad'

export interface ProgressBarProps extends VuiCommonProps {
  /** Progress 0-100 (clamped automatically). */
  readonly v?: number
  readonly tone?: ProgressTone
  /** Bar height (number as px, default 6). */
  readonly height?: number
  /** Accessible name. */
  readonly label?: string
}

/** Linear progress bar. */
export function ProgressBar(props: ProgressBarProps = {}): VobsNode {
  const root = createElement('div')
  bindClassList(root, props, () => [
    'vui-progress',
    toneClass(readProp<ProgressTone>(props, 'tone', 'brand'))
  ])
  bindCommonAttributes(root, props, ['v', 'tone', 'height'])
  bindUserStyle(root, props)
  setAttribute(root, 'role', 'progressbar')
  const fallbackLabel = `Progress ${Math.round(clamp01(readProp(props, 'v', 0)))}%`
  root.setAttribute('aria-label', fallbackLabel)
  const bar = createElement('i')
  setAttribute(bar, 'class', 'vui-progress__bar')
  insertDynamic(bar, null, () => {
    setAttribute(root, 'aria-valuenow', String(Math.round(clamp01(readProp(props, 'v', 0)))))
    return null
  })
  insertBefore(root, bar, null)
  const height = readProp<number | undefined>(props, 'height', undefined)
  if (height !== undefined) setAttribute(root, 'style', `height:${height}px`)
  return root
}

export interface ProgressRingProps extends VuiCommonProps {
  /** Progress 0-100 (clamped automatically). */
  readonly v?: number
  readonly tone?: ProgressTone
  /** Outer diameter (default 44). */
  readonly size?: number
  /** Stroke width (default 4). */
  readonly stroke?: number
  /** Ring-center content (defaults to `N%`). */
  readonly children?: VuiChildren
}

/** Ring progress (SVG double arc; the center can hold text/icons). */
export function ProgressRing(props: ProgressRingProps = {}): VobsNode {
  const root = createElement('div')
  bindClassList(root, props, () => ['vui-ring'])
  bindCommonAttributes(root, props, ['v', 'tone', 'size', 'stroke'])
  bindUserStyle(root, props)
  setAttribute(root, 'role', 'img')
  insertDynamic(root, null, () => createRing(props))
  return root
}

function createRing(props: ProgressRingProps): VobsNode {
  const size = readProp(props, 'size', 44)
  const stroke = readProp(props, 'stroke', 4)
  const v = clamp01(readProp(props, 'v', 0))
  const tone = readProp<ProgressTone>(props, 'tone', 'brand')
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const offset = c * (1 - v / 100)
  const NS = 'http://www.w3.org/2000/svg'

  return createFragment((parent, anchor) => {
    const svg = document.createElementNS(NS, 'svg')
    setAttribute(svg, 'width', String(size))
    setAttribute(svg, 'height', String(size))
    setAttribute(svg, 'viewBox', `0 0 ${size} ${size}`)
    setAttribute(svg, 'style', 'transform:rotate(-90deg)')
    const track = document.createElementNS(NS, 'circle')
    setAttribute(track, 'cx', String(size / 2))
    setAttribute(track, 'cy', String(size / 2))
    setAttribute(track, 'r', String(r))
    setAttribute(track, 'fill', 'none')
    setAttribute(track, 'stroke', 'var(--bg-overlay-l3)')
    setAttribute(track, 'stroke-width', String(stroke))
    const arc = document.createElementNS(NS, 'circle')
    setAttribute(arc, 'class', arcClass(tone))
    setAttribute(arc, 'cx', String(size / 2))
    setAttribute(arc, 'cy', String(size / 2))
    setAttribute(arc, 'r', String(r))
    setAttribute(arc, 'fill', 'none')
    setAttribute(arc, 'stroke-width', String(stroke))
    setAttribute(arc, 'stroke-linecap', 'round')
    setAttribute(arc, 'stroke-dasharray', String(c))
    setAttribute(arc, 'stroke-dashoffset', String(offset))
    svg.appendChild(track)
    svg.appendChild(arc)
    parent.insertBefore(svg, anchor)

    const center = createElement('div')
    setAttribute(center, 'class', 'vui-ring__center')
    if (props.children !== undefined && props.children !== null) {
      const node = resolveSlot(props.children)
      if (node) insertBefore(center, node, null)
    } else {
      center.textContent = `${Math.round(v)}%`
    }
    insertBefore(parent, center, anchor)
  })
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0
  return Math.min(100, Math.max(0, v))
}

function toneClass(tone: ProgressTone): string | undefined {
  return tone === 'brand' ? undefined : `is-${tone}`
}

function arcClass(tone: ProgressTone): string {
  const toneSuffix = toneClass(tone)
  return toneSuffix === undefined ? 'vui-ring__arc' : `vui-ring__arc ${toneSuffix}`
}
