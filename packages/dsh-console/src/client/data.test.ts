import { describe, expect, it } from 'vitest'
import {
  buildSparkline,
  createConsoleStore,
  createDshSource,
  createSwitchableSource,
  createSyntheticSource,
  EVENT_LIMIT,
  formatClock,
  formatDuration,
  formatTokens,
  selectConsoleSource,
  type ConsoleEvent,
  type ConsolePatch,
  type ConsoleSource
} from './data.js'

/* ------------------------------------------------------------------ 工具函数 */

describe('格式化', () => {
  it('formatClock 输出定长时刻，不受 locale 影响', () => {
    const time = new Date(2026, 0, 2, 3, 4, 5).getTime()
    expect(formatClock(time)).toBe('03:04:05')
  })

  it('formatDuration 覆盖毫秒/秒/分钟三档', () => {
    expect(formatDuration(240)).toBe('240ms')
    expect(formatDuration(4200)).toBe('4.2s')
    expect(formatDuration(138_000)).toBe('2m18s')
    expect(formatDuration(-1)).toBe('—')
  })

  it('formatTokens 覆盖 k / M 两档', () => {
    expect(formatTokens(940)).toBe('940')
    expect(formatTokens(41_200)).toBe('41.2k')
    expect(formatTokens(2_400_000)).toBe('2.40M')
  })
})

describe('buildSparkline', () => {
  it('空序列返回空路径', () => {
    expect(buildSparkline([], 90, 22)).toBe('')
  })

  it('生成以 M 开头的折线，点数与输入一致', () => {
    const path = buildSparkline([1, 5, 3, 8], 90, 22)
    expect(path.startsWith('M0.0')).toBe(true)
    expect((path.match(/[ML]/gu) ?? []).length).toBe(4)
  })

  it('常量序列不产生除零，画成一条水平线', () => {
    const path = buildSparkline([7, 7, 7], 90, 22)
    const ys = [...path.matchAll(/[ML][\d.]+ ([\d.]+)/gu)].map(match => match[1])
    expect(new Set(ys).size).toBe(1)
  })

  it('单点序列不崩', () => {
    expect(buildSparkline([3], 90, 22)).toMatch(/^M0\.0 /u)
  })
})

/* ------------------------------------------------------------------ 商店折叠 */

interface Harness {
  source: ConsoleSource
  emit(event: Partial<ConsoleEvent> & { seq: number }): void
  emitSessions(sessions: readonly never[]): void
  disposed: () => boolean
}

function createHarness(): Harness {
  const listeners = new Set<(patch: ConsolePatch) => void>()
  let disposed = false
  return {
    disposed: () => disposed,
    source: {
      kind: 'synthetic',
      label: 'test',
      note: 'test',
      snapshot: () => ({ events: [], sessions: [] }),
      subscribe(listener) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      dispose() {
        disposed = true
      }
    },
    emit(partial) {
      const event: ConsoleEvent = {
        time: 0,
        sessionId: 's1',
        sessionTitle: '会话',
        kind: 'tool/end',
        detail: '',
        ...partial
      }
      for (const listener of listeners) listener({ type: 'event', event })
    },
    emitSessions(sessions) {
      for (const listener of listeners) listener({ type: 'sessions', sessions })
    }
  }
}

describe('createConsoleStore', () => {
  it('新增事件插到最前，并累计工具统计', () => {
    const harness = createHarness()
    const store = createConsoleStore(harness.source)

    harness.emit({ seq: 1, tool: 'read', durationMs: 10 })
    harness.emit({ seq: 2, tool: 'read', durationMs: 30 })
    harness.emit({ seq: 3, tool: 'grep', durationMs: 100, status: 'err' })

    expect(store.events.value.map(event => event.seq)).toEqual([3, 2, 1])

    const read = store.tools.value.find(stat => stat.name === 'read')
    const grep = store.tools.value.find(stat => stat.name === 'grep')
    expect(read?.calls).toBe(2)
    expect(read?.failures).toBe(0)
    expect(read?.p50).toBe(10)
    expect(read?.p95).toBe(30)
    expect(read?.totalMs).toBe(40)
    expect(grep?.calls).toBe(1)
    expect(grep?.failures).toBe(1)
    expect(store.totals.value.calls).toBe(3)
    expect(store.totals.value.failures).toBe(1)
    expect(store.totals.value.successRate).toBeCloseTo(2 / 3)
  })

  it('工具按调用次数降序排列', () => {
    const harness = createHarness()
    const store = createConsoleStore(harness.source)
    harness.emit({ seq: 1, tool: 'a', durationMs: 1 })
    harness.emit({ seq: 2, tool: 'b', durationMs: 1 })
    harness.emit({ seq: 3, tool: 'b', durationMs: 1 })
    expect(store.tools.value.map(stat => stat.name)).toEqual(['b', 'a'])
  })

  it('非 tool/end 事件不进工具统计', () => {
    const harness = createHarness()
    const store = createConsoleStore(harness.source)
    harness.emit({ seq: 1, kind: 'turn/start', tool: 'read' })
    expect(store.tools.value.length).toBe(0)
    expect(store.events.value.length).toBe(1)
  })

  it('环形缓冲封顶，最旧的事件被丢弃', () => {
    const harness = createHarness()
    const store = createConsoleStore(harness.source)
    for (let index = 1; index <= EVENT_LIMIT + 25; index += 1) {
      harness.emit({ seq: index, tool: 'read', durationMs: 1 })
    }
    expect(store.events.value.length).toBe(EVENT_LIMIT)
    expect(store.events.value[0]?.seq).toBe(EVENT_LIMIT + 25)
    expect(store.events.value.at(-1)?.seq).toBe(26)
  })

  it('暂停期间丢弃入库并计数，继续后清零', () => {
    const harness = createHarness()
    const store = createConsoleStore(harness.source)
    harness.emit({ seq: 1 })

    store.pause()
    harness.emit({ seq: 2 })
    harness.emit({ seq: 3 })
    expect(store.events.value.length).toBe(1)
    expect(store.droppedWhilePaused.value).toBe(2)

    store.resume()
    harness.emit({ seq: 4 })
    expect(store.events.value.length).toBe(2)
    expect(store.droppedWhilePaused.value).toBe(0)
  })

  it('会话补丁直接替换列表', () => {
    const harness = createHarness()
    const store = createConsoleStore(harness.source)
    harness.emitSessions([])
    expect(store.sessions.value.length).toBe(0)
  })

  it('clear 清空事件与工具统计', () => {
    const harness = createHarness()
    const store = createConsoleStore(harness.source)
    harness.emit({ seq: 1, tool: 'read', durationMs: 5 })
    store.clear()
    expect(store.events.value.length).toBe(0)
    expect(store.tools.value.length).toBe(0)
    expect(store.totals.value.calls).toBe(0)
  })

  it('dispose 同时退订数据源', () => {
    const harness = createHarness()
    const store = createConsoleStore(harness.source)
    store.dispose()
    expect(harness.disposed()).toBe(true)
    harness.emit({ seq: 1 })
    expect(store.events.value.length).toBe(0)
  })
})

/* ---------------------------------------------------------------- 演示数据源 */

describe('createSyntheticSource', () => {
  it('同 seed 完全可复现', () => {
    const a = createSyntheticSource({ seed: 42 })
    const b = createSyntheticSource({ seed: 42 })
    a.tick(40)
    b.tick(40)
    expect(a.snapshot().events.map(event => event.kind)).toEqual(b.snapshot().events.map(event => event.kind))
    expect(a.snapshot().events.map(event => event.durationMs)).toEqual(b.snapshot().events.map(event => event.durationMs))
  })

  it('不同 seed 产生不同序列', () => {
    const a = createSyntheticSource({ seed: 1 })
    const b = createSyntheticSource({ seed: 2 })
    a.tick(20)
    b.tick(20)
    expect(a.snapshot().events.map(event => event.detail)).not.toEqual(b.snapshot().events.map(event => event.detail))
  })

  it('tick 产生递增 seq 的事件，且带会话与状态', () => {
    const source = createSyntheticSource({ seed: 7 })
    source.tick(12)
    const events = source.snapshot().events
    expect(events.length).toBeGreaterThan(5)
    for (const event of events) {
      expect(event.seq).toBeGreaterThan(0)
      expect(event.sessionId).not.toBe('')
      expect(event.sessionTitle).not.toBe('')
      expect(event.status).toBeDefined()
    }
    expect(events[0]?.seq).toBeGreaterThan(events[1]?.seq ?? 0)
  })

  it('订阅者收到增量补丁', () => {
    const source = createSyntheticSource({ seed: 3 })
    const seen: ConsoleEvent[] = []
    const unsubscribe = source.subscribe(patch => {
      if (patch.type === 'event') seen.push(patch.event)
    })
    source.tick(5)
    expect(seen.length).toBeGreaterThan(0)
    unsubscribe()
    const before = seen.length
    source.tick(5)
    expect(seen.length).toBe(before)
  })

  it('dispose 之后不再产出', () => {
    const source = createSyntheticSource({ seed: 9 })
    source.dispose()
    source.tick(5)
    expect(source.snapshot().events.length).toBe(0)
  })

  it('会话快照包含 seed 里的 8 个会话', () => {
    const source = createSyntheticSource()
    expect(source.snapshot().sessions.length).toBe(8)
    expect(source.snapshot().sessions.filter(session => session.state === 'run').length).toBe(3)
  })
})

/* -------------------------------------------------------------------- 探测 */

describe('createDshSource', () => {
  const mustSource = (ctx: Parameters<typeof createDshSource>[0]): ConsoleSource => {
    const source = createDshSource(ctx)
    if (source === undefined) throw new Error('expected a DSH source')
    return source
  }

  type Row = { sessionId?: string; title?: string; running?: boolean; updatedAt?: number }
  type Status = { running?: boolean; removed?: boolean; pendingInteraction?: unknown }

  const services = (rows: Record<string, Row>, statuses: Record<string, Status> = {}) => {
    let listSnapshot: { ids: string[]; byId: Record<string, Row> } = { ids: Object.keys(rows), byId: rows }
    let statusMap = new Map<string, Status>(Object.entries(statuses))
    const listListeners = new Set<() => void>()
    const statusListeners = new Set<() => void>()
    return {
      ctx: {
        slots: { inject: () => {}, register: () => {} },
        get: (name: string): unknown => {
          if (name === 'sessions') {
            return {
              list: {
                getSnapshot: () => listSnapshot,
                subscribe: (listener: () => void) => {
                  listListeners.add(listener)
                  return () => listListeners.delete(listener)
                }
              }
            }
          }
          if (name === 'uiSession') {
            return {
              sessionStatus: {
                getSnapshot: () => statusMap,
                subscribe: (listener: () => void) => {
                  statusListeners.add(listener)
                  return () => statusListeners.delete(listener)
                }
              }
            }
          }
          return undefined
        }
      },
      setRows(next: Record<string, Row>) {
        listSnapshot = { ids: Object.keys(next), byId: next }
        for (const listener of listListeners) listener()
      },
      setStatuses(next: Record<string, Status>) {
        statusMap = new Map(Object.entries(next))
        for (const listener of statusListeners) listener()
      }
    }
  }

  it('没有 sessions 服务时返回 undefined', () => {
    expect(createDshSource(undefined)).toBeUndefined()
    expect(createDshSource({ slots: { inject: () => {}, register: () => {} }, get: () => undefined })).toBeUndefined()
  })

  it('把列表快照映射成会话模型，并按最近活动排序', () => {
    const harness = services({
      a: { sessionId: 'a', title: '甲', running: false, updatedAt: 100 },
      b: { sessionId: 'b', title: '乙', running: true, updatedAt: 300 },
      c: { sessionId: 'c', updatedAt: 200 }
    })
    const source = mustSource(harness.ctx)
    const sessions = source.snapshot().sessions

    expect(sessions.map(session => session.id)).toEqual(['b', 'c', 'a'])
    expect(sessions[0]?.state).toBe('run')
    expect(sessions[2]?.state).toBe('idle')
    // 没有标题时退化成 id，而不是空白
    expect(sessions.find(session => session.id === 'c')?.title).toBe('c')
    // 列表快照里没有 token / 耗时
    expect(sessions[0]?.tokens).toBe(0)
    source.dispose()
  })

  it('pendingInteraction 映射成「等待审批」，优先于运行中', () => {
    const harness = services({ a: { sessionId: 'a', title: '甲', running: true, updatedAt: 1 } }, {
      a: { running: true, pendingInteraction: { kind: 'approval' } }
    })
    const source = mustSource(harness.ctx)
    expect(source.snapshot().sessions[0]?.state).toBe('wait')
    source.dispose()
  })

  it('首次读数只建基线，不刷一屏历史事件', () => {
    const harness = services({ a: { sessionId: 'a', running: true, updatedAt: 1 } })
    const source = mustSource(harness.ctx)
    expect(source.snapshot().events).toEqual([])
    source.dispose()
  })

  it('运行状态变化产生真实事件', () => {
    const harness = services({ a: { sessionId: 'a', title: '甲', running: false, updatedAt: 1 } })
    const source = mustSource(harness.ctx)
    const seen: ConsoleEvent[] = []
    source.subscribe(patch => {
      if (patch.type === 'event') seen.push(patch.event)
    })

    harness.setRows({ a: { sessionId: 'a', title: '甲', running: true, updatedAt: 2 } })
    expect(seen.at(-1)?.kind).toBe('turn/start')
    expect(seen.at(-1)?.status).toBe('run')

    harness.setRows({ a: { sessionId: 'a', title: '甲', running: false, updatedAt: 3 } })
    expect(seen.at(-1)?.kind).toBe('turn/end')

    source.dispose()
  })

  it('状态流上报等待审批时产生 approval/request', () => {
    const harness = services({ a: { sessionId: 'a', title: '甲', running: true, updatedAt: 1 } })
    const source = mustSource(harness.ctx)
    const seen: ConsoleEvent[] = []
    source.subscribe(patch => {
      if (patch.type === 'event') seen.push(patch.event)
    })

    harness.setStatuses({ a: { running: true, pendingInteraction: { kind: 'question' } } })
    expect(seen.at(-1)?.kind).toBe('approval/request')
    expect(seen.at(-1)?.status).toBe('warn')

    source.dispose()
  })

  it('会话进入与离开目录各有事件', () => {
    const harness = services({ a: { sessionId: 'a', title: '甲', running: false, updatedAt: 1 } })
    const source = mustSource(harness.ctx)
    const seen: ConsoleEvent[] = []
    source.subscribe(patch => {
      if (patch.type === 'event') seen.push(patch.event)
    })

    harness.setRows({
      a: { sessionId: 'a', title: '甲', running: false, updatedAt: 1 },
      b: { sessionId: 'b', title: '乙', running: false, updatedAt: 2 }
    })
    expect(seen.some(event => event.kind === 'session/open' && event.sessionId === 'b')).toBe(true)

    harness.setRows({ b: { sessionId: 'b', title: '乙', running: false, updatedAt: 2 } })
    expect(seen.some(event => event.kind === 'session/close' && event.sessionId === 'a')).toBe(true)

    source.dispose()
  })

  it('标题变化产生 session/update', () => {
    const harness = services({ a: { sessionId: 'a', title: '旧', running: false, updatedAt: 1 } })
    const source = mustSource(harness.ctx)
    const seen: ConsoleEvent[] = []
    source.subscribe(patch => {
      if (patch.type === 'event') seen.push(patch.event)
    })

    harness.setRows({ a: { sessionId: 'a', title: '新', running: false, updatedAt: 1 } })
    expect(seen.at(-1)?.kind).toBe('session/update')
    expect(seen.at(-1)?.detail).toContain('新')

    source.dispose()
  })

  it('dispose 之后退订，不再收到更新', () => {
    const harness = services({ a: { sessionId: 'a', running: false, updatedAt: 1 } })
    const source = mustSource(harness.ctx)
    let patches = 0
    source.subscribe(() => {
      patches += 1
    })
    source.dispose()
    harness.setRows({ a: { sessionId: 'a', running: true, updatedAt: 2 } })
    expect(patches).toBe(0)
  })
})

describe('selectConsoleSource', () => {
  it('没有服务时退回演示数据并说明原因', () => {
    const selection = selectConsoleSource(undefined)
    expect(selection.source.kind).toBe('synthetic')
    expect(selection.note).toContain('未探测到')
    selection.source.dispose()
  })

  it('探测到服务时切到真实源', () => {
    const selection = selectConsoleSource({
      slots: { inject: () => {}, register: () => {} },
      get: name =>
        name === 'sessions'
          ? { list: { getSnapshot: () => ({ ids: [], byId: {} }), subscribe: () => () => {} } }
          : undefined
    })
    expect(selection.source.kind).toBe('dsh')
    expect(selection.note).toContain('会话级')
    selection.source.dispose()
  })

  it('复用调用方给的演示源，不重复创建', () => {
    const demo = createSyntheticSource({ seed: 1 })
    const selection = selectConsoleSource(undefined, demo)
    expect(selection.source).toBe(demo)
    selection.source.dispose()
  })
})

describe('createSwitchableSource', () => {
  it('切换时广播 reset，并可取到新源', () => {
    const first = createSyntheticSource({ seed: 1 })
    const second = createSyntheticSource({ seed: 2 })
    const switchable = createSwitchableSource(first)

    const patches: string[] = []
    switchable.subscribe(patch => patches.push(patch.type))
    switchable.switchTo(second)

    expect(patches).toEqual(['reset'])
    expect(switchable.active).toBe(second)
    expect(switchable.kind).toBe('synthetic')
    switchable.dispose()
  })

  it('切换后旧源的推送不再透传', () => {
    const first = createSyntheticSource({ seed: 1 })
    const second = createSyntheticSource({ seed: 2 })
    const switchable = createSwitchableSource(first)
    const patches: ConsolePatch[] = []
    switchable.subscribe(patch => patches.push(patch))
    switchable.switchTo(second)
    patches.length = 0

    first.tick(3)
    expect(patches.length).toBe(0)

    second.tick(3)
    expect(patches.length).toBeGreaterThan(0)
    switchable.dispose()
  })
})
