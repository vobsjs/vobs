import {
  createElement,
  insertDynamic,
  setAttribute,
  type VobsNode
} from '@vobs/vobs'
import {
  bindClassList,
  bindCommonAttributes,
  bindUserStyle,
  readProp
} from './utils'
import type { VuiCommonProps } from './types'

export interface PieSlice {
  /** 名称（无障碍与图例用） */
  readonly label?: string
  readonly value: number
  /** 扇区色；缺省走内置调色板（data-index） */
  readonly color?: string
}

export interface PieChartProps extends VuiCommonProps {
  readonly slices?: readonly PieSlice[]
  /** 外径（默认 140） */
  readonly size?: number
  /** 环宽占半径比例（默认 0.6，越小环越细） */
  readonly innerRatio?: number
}

/** 环形占比图（纯 SVG，无外部依赖；data 驱动重建） */
export function PieChart(props: PieChartProps = {}): VobsNode {
  const root = createElement('div')
  bindClassList(root, props, () => ['vui-pie'])
  bindCommonAttributes(root, props, ['slices', 'size', 'innerRatio'])
  bindUserStyle(root, props)
  insertDynamic(root, null, () => createPieSvg(props))
  return root
}

function createPieSvg(props: PieChartProps): VobsNode {
  const size = readProp(props, 'size', 140)
  const slices = readProp<readonly PieSlice[]>(props, 'slices', [])
  const innerRatio = readProp(props, 'innerRatio', 0.6)
  const total = slices.reduce((sum, s) => sum + Math.max(0, s.value), 0) || 1

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  setAttribute(svg, 'width', String(size))
  setAttribute(svg, 'height', String(size))
  setAttribute(svg, 'viewBox', `0 0 ${size} ${size}`)
  setAttribute(svg, 'role', 'img')

  const r = size / 2 - 2
  const ir = r * innerRatio
  const cx = size / 2
  let acc = 0
  slices.forEach((slice, index) => {
    const share = Math.max(0, slice.value) / total
    if (share <= 0) return
    const a0 = (acc / total) * 2 * Math.PI
    acc += Math.max(0, slice.value)
    const a1 = (acc / total) * 2 * Math.PI
    const [x0, y0] = [cx + r * Math.sin(a0), cx - r * Math.cos(a0)]
    const [x1, y1] = [cx + r * Math.sin(a1), cx - r * Math.cos(a1)]
    const [x2, y2] = [cx + ir * Math.sin(a1), cx - ir * Math.cos(a1)]
    const [x3, y3] = [cx + ir * Math.sin(a0), cx - ir * Math.cos(a0)]
    const largeArc = a1 - a0 > Math.PI ? 1 : 0
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    setAttribute(path, 'class', 'vui-pie__seg')
    setAttribute(path, 'data-index', String(index))
    setAttribute(
      path,
      'd',
      `M${x0} ${y0}A${r} ${r} 0 ${largeArc} 1 ${x1} ${y1}L${x2} ${y2}A${ir} ${ir} 0 ${largeArc} 0 ${x3} ${y3}z`
    )
    if (slice.label !== undefined) setAttribute(path, 'aria-label', slice.label)
    if (slice.color !== undefined) setAttribute(path, 'fill', slice.color)
    svg.appendChild(path)
  })
  return svg
}

export interface LineChartProps extends VuiCommonProps {
  /** 数据点（支持负值，零线自动虚线） */
  readonly values?: readonly number[]
  /** x 轴标签（与 values 等长） */
  readonly labels?: readonly string[]
  /** 视图宽（默认 420，svg 以 100% 宽自适应容器） */
  readonly width?: number
  /** 视图高（默认 160） */
  readonly height?: number
}

/** 折线趋势图（纯 SVG，无外部依赖；data 驱动重建） */
export function LineChart(props: LineChartProps = {}): VobsNode {
  const root = createElement('div')
  bindClassList(root, props, () => ['vui-line'])
  bindCommonAttributes(root, props, ['values', 'labels', 'width', 'height'])
  bindUserStyle(root, props)
  insertDynamic(root, null, () => createLineSvg(props))
  return root
}

function createLineSvg(props: LineChartProps): VobsNode {
  const width = readProp(props, 'width', 420)
  const height = readProp(props, 'height', 160)
  const values = readProp<readonly number[]>(props, 'values', [])
  const labels = readProp<readonly string[]>(props, 'labels', [])
  const padding = 24
  const max = Math.max(...values, 1)
  const min = Math.min(...values, 0)
  const x = (i: number): number => padding + (i * (width - padding * 2)) / Math.max(1, values.length - 1)
  const y = (v: number): number => height - 22 - ((v - min) / (max - min || 1)) * (height - 40)

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  setAttribute(svg, 'viewBox', `0 0 ${width} ${height}`)
  setAttribute(svg, 'style', 'width:100%')
  setAttribute(svg, 'role', 'img')

  for (let i = 0; i < 4; i++) {
    const grid = document.createElementNS('http://www.w3.org/2000/svg', 'line')
    const gy = 18 + (i * (height - 40)) / 3
    setAttribute(grid, 'x1', String(padding))
    setAttribute(grid, 'x2', String(width - padding))
    setAttribute(grid, 'y1', String(gy))
    setAttribute(grid, 'y2', String(gy))
    setAttribute(grid, 'class', 'vui-line__grid')
    svg.appendChild(grid)
  }
  if (min < 0) {
    const zero = document.createElementNS('http://www.w3.org/2000/svg', 'line')
    setAttribute(zero, 'x1', String(padding))
    setAttribute(zero, 'x2', String(width - padding))
    setAttribute(zero, 'y1', String(y(0)))
    setAttribute(zero, 'y2', String(y(0)))
    setAttribute(zero, 'class', 'vui-line__zero')
    svg.appendChild(zero)
  }
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  setAttribute(path, 'class', 'vui-line__area')
  setAttribute(path, 'fill', 'none')
  setAttribute(
    path,
    'd',
    values.map((v, i) => `${i !== 0 ? 'L' : 'M'}${x(i)} ${y(v)}`).join('')
  )
  svg.appendChild(path)
  values.forEach((v, i) => {
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
    setAttribute(dot, 'class', 'vui-line__dot')
    setAttribute(dot, 'cx', String(x(i)))
    setAttribute(dot, 'cy', String(y(v)))
    setAttribute(dot, 'r', '3')
    svg.appendChild(dot)
  })
  labels.forEach((label, i) => {
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text')
    setAttribute(text, 'class', 'vui-line__label')
    setAttribute(text, 'x', String(x(i)))
    setAttribute(text, 'y', String(height - 4))
    setAttribute(text, 'text-anchor', 'middle')
    text.textContent = label
    svg.appendChild(text)
  })
  return svg
}
