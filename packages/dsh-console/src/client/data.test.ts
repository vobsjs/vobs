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

/* ------------------------------------------------------------------ Utilities */

describe('formatting', () => {
  it('formatClock outputs a fixed-width time, locale-independent', () => {
    const time = new Date(2026, 0, 2, 3, 4, 5).getTime()
    expect(formatClock(time)).toBe('03:04:05')
  })

  it('formatDuration covers the ms/s/minute tiers', () => {
    expect(formatDuration(240)).toBe('240ms')
    expect(formatDuration(4200)).toBe('4.2s')
    expect(formatDuration(138_000)).toBe('2m18s')
    expect(formatDuration(-1)).toBe('—')
  })

  it('formatTokens covers the k / M tiers', () => {
    expect(formatTokens(940)).toBe('940')
    expect(formatTokens(41_200)).toBe('41.2k')
    expect(formatTokens(2_400_000)).toBe('2.40M')
  })
})

describe('buildSparkline', () => {
  it('returns an empty path for an empty sequence', () => {
    expect(buildSparkline([], 90, 22)).toBe('')
  })

  it('produces a line starting with M, with as many points as the input', () => {
    const path = buildSparkline([1, 5, 3, 8], 90, 22)
    expect(path.startsWith('M0.0')).toBe(true)
    expect((path.match(/[ML]/gu) ?? []).length).toBe(4)
  })

  it('a constant sequence never divides by zero and draws a horizontal line', () => {
    const path = buildSparkline([7, 7, 7], 90, 22)
    const ys = [...path.matchAll(/[ML][\d.]+ ([\d.]+)/gu)].map(match => match[1])
    expect(new Set(ys).size).toBe(1)
  })

  it('a single-point sequence does not crash', () => {
    expect(buildSparkline([3], 90, 22)).toMatch(/^M0\.0 /u)
  })
})

/* ------------------------------------------------------------------ Store folding */

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
  it('new events are inserted at the front and tool stats accumulate', () => {
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

  it('tools are sorted by call count descending', () => {
    const harness = createHarness()
    const store = createConsoleStore(harness.source)
    harness.emit({ seq: 1, tool: 'a', durationMs: 1 })
    harness.emit({ seq: 2, tool: 'b', durationMs: 1 })
    harness.emit({ seq: 3, tool: 'b', durationMs: 1 })
    expect(store.tools.value.map(stat => stat.name)).toEqual(['b', 'a'])
  })

  it('non tool/end events do not enter tool stats', () => {
    const harness = createHarness()
    const store = createConsoleStore(harness.source)
    harness.emit({ seq: 1, kind: 'turn/start', tool: 'read' })
    expect(store.tools.value.length).toBe(0)
    expect(store.events.value.length).toBe(1)
  })

  it('the ring buffer caps out and the oldest events are dropped', () => {
    const harness = createHarness()
    const store = createConsoleStore(harness.source)
    for (let index = 1; index <= EVENT_LIMIT + 25; index += 1) {
      harness.emit({ seq: index, tool: 'read', durationMs: 1 })
    }
    expect(store.events.value.length).toBe(EVENT_LIMIT)
    expect(store.events.value[0]?.seq).toBe(EVENT_LIMIT + 25)
    expect(store.events.value.at(-1)?.seq).toBe(26)
  })

  it('while paused, drops are counted; the counter resets on resume', () => {
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

  it('a sessions patch replaces the list outright', () => {
    const harness = createHarness()
    const store = createConsoleStore(harness.source)
    harness.emitSessions([])
    expect(store.sessions.value.length).toBe(0)
  })

  it('clear empties events and tool stats', () => {
    const harness = createHarness()
    const store = createConsoleStore(harness.source)
    harness.emit({ seq: 1, tool: 'read', durationMs: 5 })
    store.clear()
    expect(store.events.value.length).toBe(0)
    expect(store.tools.value.length).toBe(0)
    expect(store.totals.value.calls).toBe(0)
  })

  it('dispose also unsubscribes from the data source', () => {
    const harness = createHarness()
    const store = createConsoleStore(harness.source)
    store.dispose()
    expect(harness.disposed()).toBe(true)
    harness.emit({ seq: 1 })
    expect(store.events.value.length).toBe(0)
  })
})

/* ---------------------------------------------------------------- Demo data source */

describe('createSyntheticSource', () => {
  it('same seed is fully reproducible', () => {
    const a = createSyntheticSource({ seed: 42 })
    const b = createSyntheticSource({ seed: 42 })
    a.tick(40)
    b.tick(40)
    expect(a.snapshot().events.map(event => event.kind)).toEqual(b.snapshot().events.map(event => event.kind))
    expect(a.snapshot().events.map(event => event.durationMs)).toEqual(b.snapshot().events.map(event => event.durationMs))
  })

  it('different seeds produce different sequences', () => {
    const a = createSyntheticSource({ seed: 1 })
    const b = createSyntheticSource({ seed: 2 })
    a.tick(20)
    b.tick(20)
    expect(a.snapshot().events.map(event => event.detail)).not.toEqual(b.snapshot().events.map(event => event.detail))
  })

  it('tick produces events with increasing seq, carrying session and status', () => {
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

  it('subscribers receive incremental patches', () => {
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

  it('no production after dispose', () => {
    const source = createSyntheticSource({ seed: 9 })
    source.dispose()
    source.tick(5)
    expect(source.snapshot().events.length).toBe(0)
  })

  it('the session snapshot contains the 8 sessions from the seed', () => {
    const source = createSyntheticSource()
    expect(source.snapshot().sessions.length).toBe(8)
    expect(source.snapshot().sessions.filter(session => session.state === 'run').length).toBe(3)
  })
})

/* -------------------------------------------------------------------- Probing */

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

  it('returns undefined when there is no sessions service', () => {
    expect(createDshSource(undefined)).toBeUndefined()
    expect(createDshSource({ slots: { inject: () => {}, register: () => {} }, get: () => undefined })).toBeUndefined()
  })

  it('maps the list snapshot into session models, sorted by most recent activity', () => {
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
    // Falls back to the id when there is no title, not to blank
    expect(sessions.find(session => session.id === 'c')?.title).toBe('c')
    // List snapshots carry no tokens / durations
    expect(sessions[0]?.tokens).toBe(0)
    source.dispose()
  })

  it('pendingInteraction maps to "awaiting approval", taking precedence over running', () => {
    const harness = services({ a: { sessionId: 'a', title: '甲', running: true, updatedAt: 1 } }, {
      a: { running: true, pendingInteraction: { kind: 'approval' } }
    })
    const source = mustSource(harness.ctx)
    expect(source.snapshot().sessions[0]?.state).toBe('wait')
    source.dispose()
  })

  it('the first read only builds the baseline, without flooding a screen of history events', () => {
    const harness = services({ a: { sessionId: 'a', running: true, updatedAt: 1 } })
    const source = mustSource(harness.ctx)
    expect(source.snapshot().events).toEqual([])
    source.dispose()
  })

  it('run-state changes produce real events', () => {
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

  it('the status stream reporting awaiting-approval produces approval/request', () => {
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

  it('sessions entering and leaving the catalog each produce an event', () => {
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

  it('a title change produces session/update', () => {
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

  it('after dispose it unsubscribes and receives no more updates', () => {
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
  it('falls back to demo data when there are no services, and explains why', () => {
    const selection = selectConsoleSource(undefined)
    expect(selection.source.kind).toBe('synthetic')
    expect(selection.note).toContain('was not detected')
    selection.source.dispose()
  })

  it('switches to the real source when services are detected', () => {
    const selection = selectConsoleSource({
      slots: { inject: () => {}, register: () => {} },
      get: name =>
        name === 'sessions'
          ? { list: { getSnapshot: () => ({ ids: [], byId: {} }), subscribe: () => () => {} } }
          : undefined
    })
    expect(selection.source.kind).toBe('dsh')
    expect(selection.note).toContain('session-level')
    selection.source.dispose()
  })

  it('reuses the demo source given by the caller instead of creating a new one', () => {
    const demo = createSyntheticSource({ seed: 1 })
    const selection = selectConsoleSource(undefined, demo)
    expect(selection.source).toBe(demo)
    selection.source.dispose()
  })
})

describe('createSwitchableSource', () => {
  it('broadcasts reset on switch and exposes the new source', () => {
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

  it('pushes from the old source are no longer forwarded after switching', () => {
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
