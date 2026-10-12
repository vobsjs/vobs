// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createDOMRenderer, setRenderer, type VobsNode } from '@vobs/vobs'
import { state } from '@vobs/reactivity'
import {
  Checkbox,
  FormField,
  Input,
  LineChart,
  MoneyText,
  MonthPicker,
  NumberInput,
  PieChart,
  ProgressBar,
  ProgressRing,
  Segmented,
  TablePanel
} from './index'

const tick = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 10))

async function mount(render: () => VobsNode): Promise<HTMLElement> {
  setRenderer(createDOMRenderer())
  const root = render()
  await tick()
  return root as HTMLElement
}

describe('Segmented', () => {
  const ITEMS = [
    { id: 'in', label: '收入', tone: 'success' as const },
    { id: 'out', label: '支出', tone: 'danger' as const }
  ]

  it('点击写回 bind 并触发 onChange，高亮随 value 移动', async () => {
    const bind = state('in')
    const picked: string[] = []
    const root = await mount(() => Segmented({ items: ITEMS, bind, onChange: v => { picked.push(v) } }))
    const options = root.querySelectorAll<HTMLButtonElement>('.vui-seg__opt')
    expect(options[0]?.classList.contains('is-active')).toBe(true)
    options[1]!.click()
    await tick()
    expect(bind.value).toBe('out')
    expect(picked).toEqual(['out'])
    expect(root.querySelector('[data-id="in"]')?.classList.contains('is-active')).toBe(false)
    expect(root.querySelector('[data-id="out"]')?.classList.contains('is-active')).toBe(true)
  })

  it('受控 value（无 bind）同样驱动高亮', async () => {
    const root = await mount(() => Segmented({ items: ITEMS, value: 'out' }))
    expect(root.querySelector('[data-id="out"]')?.classList.contains('is-active')).toBe(true)
  })
})

describe('ProgressBar / ProgressRing', () => {
  it('进度截断到 0-100 并写入 aria-valuenow', async () => {
    const root = await mount(() => ProgressBar({ v: 120 }))
    expect(root.getAttribute('aria-valuenow')).toBe('100')
  })

  it('Ring 默认中心显示百分比，children 可覆盖', async () => {
    const ring = await mount(() => ProgressRing({ v: 42 }))
    expect(ring.querySelector('.vui-ring__center')?.textContent).toBe('42%')
    expect(ring.querySelector('.vui-ring__arc')).not.toBeNull()
    const custom = await mount(() => ProgressRing({ v: 42, children: '近满' }))
    expect(custom.querySelector('.vui-ring__center')?.textContent).toBe('近满')
  })
})

describe('NumberInput', () => {
  it('加减按钮按 step 步进并写回 bind', async () => {
    const bind = state(5)
    const root = await mount(() => NumberInput({ bind, min: 0, max: 10, step: 2 }))
    const buttons = root.querySelectorAll<HTMLButtonElement>('.vui-numberinput__btn')
    const input = root.querySelector('input') as HTMLInputElement
    buttons[0]!.click()
    await tick()
    expect(bind.value).toBe(3)
    expect(input.value).toBe('3')
    buttons[1]!.click()
    buttons[1]!.click()
    await tick()
    expect(bind.value).toBe(7)
  })

  it('键入越界收敛到 max', async () => {
    const changes: number[] = []
    const root = await mount(() => NumberInput({ value: 8, min: 0, max: 10, onChange: n => { changes.push(n) } }))
    const input = root.querySelector('input') as HTMLInputElement
    input.value = '99'
    input.dispatchEvent(new Event('input'))
    await tick()
    expect(changes).toEqual([10])
  })
})

describe('FormField', () => {
  it('label + required 自动补 *，error 走 bad 色提示', async () => {
    const root = await mount(() => FormField({ label: '金额', required: true, error: '请输入大于 0 的金额' }))
    expect(root.querySelector('.vui-field__label')?.textContent).toBe('金额 *')
    expect(root.querySelector('.vui-field__msg')?.getAttribute('data-tone')).toBe('bad')
    expect(root.classList.contains('is-error')).toBe(true)
  })

  it('无 error 时显示 hint', async () => {
    const root = await mount(() => FormField({ label: '税号', hint: '18 位' }))
    expect(root.querySelector('.vui-field__msg')?.textContent).toBe('18 位')
  })
})

describe('Input prefix / suffix', () => {
  it('前缀后缀渲染为 affix 槽', async () => {
    const root = await mount(() => Input({ prefix: '¥', suffix: '元' }))
    expect(root.querySelector('.vui-input__prefix')?.textContent).toBe('¥')
    expect(root.querySelector('.vui-input__suffix')?.textContent).toBe('元')
  })
})

describe('Checkbox mixed', () => {
  it('mixed 同步 indeterminate property 与 data-mixed', async () => {
    const root = await mount(() => Checkbox({ checked: false, mixed: true }))
    const control = root.querySelector('input') as HTMLInputElement
    expect(control.indeterminate).toBe(true)
    expect(root.querySelector('.vui-check__box')?.getAttribute('data-mixed')).toBe('true')
  })
})

describe('Table 状态增强', () => {
  const COLS = [{ id: 'name', label: '名称' }]

  it('state=loading 渲染骨架行', async () => {
    const root = await mount(() => TablePanel({ columns: COLS, rows: [], state: 'loading', loadingRows: 3 }))
    expect(root.querySelectorAll('tr[data-loading]').length).toBe(3)
  })

  it('state=error 渲染错误区，onRetry 点击回调', async () => {
    let retried = 0
    const root = await mount(() => TablePanel({ columns: COLS, rows: [], state: 'error', onRetry: () => { retried += 1 } }))
    const retry = root.querySelector('.vui-table__retry') as HTMLButtonElement
    expect(retry).not.toBeNull()
    retry.click()
    expect(retried).toBe(1)
  })

  it('rowActive 命中行带 data-active，rowHeight 落到行 style', async () => {
    const rows = [{ id: 1, name: '甲' }, { id: 2, name: '乙' }]
    const root = await mount(() => TablePanel({
      columns: [{ id: 'name', label: '名称', key: 'name' }],
      rows,
      rowActive: row => row.id === 2,
      rowHeight: 48
    }))
    const activeRows = root.querySelectorAll('tr[data-active="true"]')
    expect(activeRows.length).toBe(1)
    expect(activeRows[0]?.textContent).toContain('乙')
    expect(root.querySelectorAll('tbody tr')[0]?.getAttribute('style')).toContain('height:48px')
  })

  it('列宽写入 th style', async () => {
    const root = await mount(() => TablePanel({ columns: [{ id: 'name', label: '名称', width: 120 }], rows: [{ name: '甲' }] }))
    expect(root.querySelector('th')?.getAttribute('style')).toContain('width:120px')
  })
})

describe('MoneyText / NumText', () => {
  it('负数 auto 态显示红括号，in/out 带符号', async () => {
    const negative = await mount(() => MoneyText({ value: -1234.5 }))
    expect(negative.textContent).toContain('(1,234.50)')
    expect(negative.classList.contains('is-out')).toBe(true)
    const income = await mount(() => MoneyText({ value: 100, kind: 'in', plain: true }))
    expect(income.textContent).toBe('+100.00')
    const out = await mount(() => MoneyText({ value: 100, kind: 'out' }))
    expect(out.textContent).toBe('¥-100.00')
  })
})

describe('MonthPicker', () => {
  it('前后翻月跨年进位', async () => {
    const bind = state('2026-01')
    const root = await mount(() => MonthPicker({ bind }))
    const buttons = root.querySelectorAll<HTMLButtonElement>('.vui-monthpicker__btn')
    buttons[0]!.click()
    await tick()
    expect(bind.value).toBe('2025-12')
    buttons[1]!.click()
    await tick()
    expect(bind.value).toBe('2026-01')
  })
})

describe('Charts', () => {
  it('PieChart 按切片渲染 path，空数据不渲染扇区', async () => {
    const root = await mount(() => PieChart({ slices: [{ label: '材料', value: 3 }, { label: '人工', value: 1 }] }))
    expect(root.querySelectorAll('.vui-pie__seg').length).toBe(2)
    const empty = await mount(() => PieChart({ slices: [] }))
    expect(empty.querySelectorAll('.vui-pie__seg').length).toBe(0)
  })

  it('LineChart 渲染折线/圆点/标签', async () => {
    const root = await mount(() => LineChart({ values: [-12, 4, 18], labels: ['一', '二', '三'] }))
    expect(root.querySelector('.vui-line__area')).not.toBeNull()
    expect(root.querySelectorAll('.vui-line__dot').length).toBe(3)
    expect(root.querySelector('.vui-line__zero')).not.toBeNull()
    expect(root.querySelectorAll('.vui-line__label').length).toBe(3)
  })
})
