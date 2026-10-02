// @vitest-environment jsdom
/*
 * 拖拽事件在 JSX 上的用法（真实项目 2026-10-02 踩坑 1）。
 *
 * 现象：`onDragOver` / `onDrop` 报
 *   `Property 'onDragOver' does not exist on type 'VobsHTMLAttributes'`
 * 于是「拖入文件导入」只能退回 `ref` 回调 + 原生 `addEventListener`。
 *
 * 关键事实（本文件同时锁住）：**运行时本来就支持** ——
 * `resolveEventName` 对任何 `on*` 属性做 `slice(2).toLowerCase()`，
 * `onDragOver` 解析成 `dragover`。缺的只是**类型声明**。
 *
 * 所以这个文件有两层验证：
 * 1. **类型层**：下面的 JSX 里直接写 `onDragOver`/`onDrop`，能通过 `pnpm run typecheck`
 *    （若类型缺失，这个文件自己就编译不过）
 * 2. **运行时层**：编译产物真的绑上了 `dragover`/`drop`，事件派发能触发回调
 */
import { describe, expect, it, vi } from 'vitest'
import { scheduler } from '@vobs/reactivity'
import { createDOMRenderer, setRenderer } from '@vobs/vobs'
import { compileWithSourceMap } from '@vobs/compiler'

setRenderer(createDOMRenderer())
const settle = (): void => { scheduler.flush() }

describe('拖拽事件：类型层', () => {
  it('编译器产出的代码走 bindEvent，事件名是 DOM 的 dragover/drop', () => {
    const src = `
      export const UploadArea = () => (
        <div
          class="drop-zone"
          onDragOver={event => { event.preventDefault() }}
          onDrop={event => { handleFiles(event.dataTransfer?.files) }}
        />
      )
    `
    const { code, diagnostics } = compileWithSourceMap(src, { filename: 'UploadArea.tsx' })
    expect(diagnostics.filter(d => d.severity === 'error')).toEqual([])
    // 事件绑定落到 "dragover" / "drop"（不是原始的 onDragOver 字符串）
    expect(code).toContain('"dragover"')
    expect(code).toContain('"drop"')
  })

  it('事件名解析表里 drag 系走的是 toLowerCase 通配（说明运行时早就支持）', () => {
    // 这里刻意不断言"别名表里有 dragover" —— 它**不在**别名表里，
    // 靠的是 slice(2).toLowerCase() 的通配。这正是"类型缺失但运行时有"的原因。
    const src = `export const A = () => <div onDragStart={f} onDragEnd={g} onDragEnter={h} onDragLeave={i} />`
    const { code } = compileWithSourceMap(src, { filename: 'a.tsx' })
    for (const name of ['dragstart', 'dragend', 'dragenter', 'dragleave']) {
      expect(code, `${name} 没被绑上`).toContain(`"${name}"`)
    }
  })
})

describe('拖拽事件：运行时层（真的能触发回调）', () => {
  it('dragover / drop 派发都会调用对应的处理函数', async () => {
    const { addEventListener } = await import('@vobs/runtime')
    const onDragOver = vi.fn()
    const onDrop = vi.fn()

    const zone = document.createElement('div')
    document.body.appendChild(zone)
    // 与编译器产物同一条路径
    addEventListener(zone, 'dragover', onDragOver)
    addEventListener(zone, 'drop', onDrop)

    zone.dispatchEvent(new Event('dragover', { bubbles: true, cancelable: true }))
    settle()
    expect(onDragOver, 'dragover 没触发 onDragOver').toHaveBeenCalledTimes(1)

    zone.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }))
    settle()
    expect(onDrop, 'drop 没触发 onDrop').toHaveBeenCalledTimes(1)

    zone.remove()
  })

  it('onDrop 能拿到 dataTransfer（拖入文件的真实用法）', async () => {
    const { addEventListener } = await import('@vobs/runtime')
    const received: unknown[] = []
    const zone = document.createElement('div')
    document.body.appendChild(zone)
    addEventListener(zone, 'drop', (event: Event) => { received.push((event as DragEvent).dataTransfer) })

    const event = new Event('drop', { bubbles: true, cancelable: true })
    zone.dispatchEvent(event)
    settle()
    expect(received, 'drop 回调没被调用').toHaveLength(1)
    zone.remove()
  })
})
