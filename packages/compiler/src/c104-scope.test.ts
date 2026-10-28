/*
 * The **trigger-surface narrowing** of `VOBS_C104` (1.8.1).
 *
 * Field feedback (a real project upgrading to 1.8.0): of 18 hits, about **16 were pure-data-function false positives**,
 * and it was an `error` — blocking builds outright, turning the upgrade into whack-a-mole. Both false-positive sources reported by users were confirmed:
 *
 * 1. `return cond && value` — 1.8.0 reported **any** `return &&` unconditionally, ignoring what the right value was
 * 2. `return x ? x : null` — only the branch's emptiness was checked, not whether the return value was a **render node**,
 *    so normal null modeling like `T | null` was all reported as "a top-level conditional return in a component"
 *
 * The argument only holds when "the return value will be rendered": component run-once → that return never re-evaluates;
 * a pure data function runs on every call, where conditional returns are perfectly fine.
 *
 * After narrowing it is still heuristic (statics cannot tell "is this function a component"), so it was also downgraded from error to warning.
 */
import { describe, expect, it } from 'vitest'
import { compileWithSourceMap } from './index'

const c104 = (source: string) =>
  compileWithSourceMap(source, { filename: 'case.tsx' }).diagnostics.filter(d => d.code === 'VOBS_C104')

describe("VOBS_C104 shapes that must not be reported (pure data functions — the report's false-positive sources)", () => {
  it('`return v ? v : null` (normal T | null null-modeling)', () => {
    expect(c104(`
      type User = { name: string }
      function pick(value: User | null): User | null {
        return value ? value : null
      }
    `)).toEqual([])
  })

  it('`return a && b` (pure data; the right value is not a node)', () => {
    expect(c104(`
      function nameOf(user: { name: string } | null): string | null {
        return user && user.name
      }
    `)).toEqual([])
  })

  it('`return list.length && list[0]`', () => {
    expect(c104(`
      function first<T>(list: T[]): T | null {
        return list.length && list[0]
      }
    `)).toEqual([])
  })

  it('data conditionals inside single-expression arrows', () => {
    expect(c104(`
      const trim = (text: string | null) => text ? text.trim() : null
      const label = (n: number | null) => n && String(n)
    `)).toEqual([])
  })

  it('an `if` early return (never reported anyway)', () => {
    expect(c104(`
      function resolve(value: string | null): string {
        if (!value) return ''
        return value
      }
    `)).toEqual([])
  })

  it('a `Boolean()` wrapper (never reported anyway)', () => {
    expect(c104(`
      function has(value: unknown) {
        return Boolean(value) && true
      }
    `)).toEqual([])
  })

  it('a ternary whose both branches are data (even when it looks like "returning empty")', () => {
    expect(c104(`
      function pick(a: number | null, b: number | null): number | null {
        return a ? a : undefined
      }
    `)).toEqual([])
  })
})

describe('VOBS_C104 shapes that must be reported (genuinely rendered)', () => {
  it('`return cond && <A/>`', () => {
    const found = c104(`
      export function Panel() {
        const open = state(true)
        return open.value && <div>内容</div>
      }
    `)
    expect(found).toHaveLength(1)
    expect(found[0]!.fix).toContain('Show')
  })

  it('`return cond ? <A/> : null`', () => {
    expect(c104(`
      export function Panel() {
        return open.value ? <div>内容</div> : null
      }
    `)).toHaveLength(1)
  })

  it('`return cond ? null : <B/>`', () => {
    expect(c104(`
      export function Panel() {
        return open.value ? null : <div>空态</div>
      }
    `)).toHaveLength(1)
  })

  it('**a warning, not an error** (statics cannot tell "is it a component"; it must not block builds)', () => {
    const found = c104(`
      export function Panel() {
        return open.value && <div>内容</div>
      }
    `)
    expect(found[0]!.severity).toBe('warning')
  })

  it('the fix text no longer depends on global utility classes (points to Show / classList)', () => {
    const found = c104(`
      export function Panel() {
        return open.value && <div>内容</div>
      }
    `)
    const fix = found[0]!.fix ?? ''
    expect(fix).toContain('Show')
    expect(fix).toContain('classList')
    /*
     * The point is **not stringing together `class=`**: the 1.8.0 text was
     * `<A class={cond ? 'is-on' : 'is-off'} />`, which requires a pre-existing **global**
     * `.is-off` utility class in the project; real projects usually only have compound selectors
     * (`.seq-param-group.is-off`), and following it verbatim yields "the class is applied but the styles never take effect".
     * `classList` needs no pre-existing classes at all.
     */
    expect(fix).not.toContain('class={')
  })
})

describe('VOBS_C104 nesting and boundaries', () => {
  it('does not descend into nested functions (the inner one is its own scope)', () => {
    // The outer returns a node so it is reported; the inner is a data function so it is not — there should be exactly 1
    const found = c104(`
      export function Panel() {
        const label = (u: {n: string} | null) => u ? u.n : null
        return open.value && <div>{label(user)}</div>
      }
    `)
    expect(found).toHaveLength(1)
  })

  it('a ternary at a JSX child position must **not** be reported (that is the correct form)', () => {
    expect(c104(`
      export function Panel() {
        return <div>{open.value ? <A/> : <B/>}</div>
      }
    `)).toEqual([])
  })

  it('`return cond1 ? <A/> : <B/>` — both branches are nodes, no empty branch → not reported', () => {
    expect(c104(`
      export function Panel() {
        return open.value ? <A/> : <B/>
      }
    `)).toEqual([])
  })
})
