import { describe, expect, it } from 'vitest'
import { createOwner, onDispose, runWithOwner } from './owner'

/*
 * Isolation of cascading disposal.
 *
 * When a child Owner's cleanup threw, `dispose()` used to call `child.dispose()`
 * bare — one child throwing meant **no sibling Owner got disposed and the parent's
 * own cleanups never ran** (reproduced: parent cleanup not executed, second child
 * owner still alive). That is a resource leak (effects stay bound, listeners stay
 * attached), with no hint at all.
 */
describe('Owner cascading disposal', () => {
  it('a child cleanup throwing does not block sibling and parent cleanups', () => {
    const parent = createOwner()
    const done: string[] = []

    runWithOwner(parent, () => {
      onDispose(() => { done.push('parent') })

      const first = createOwner()
      runWithOwner(first, () => {
        onDispose(() => { throw new Error('boom from first child') })
      })

      const second = createOwner()
      runWithOwner(second, () => {
        onDispose(() => { done.push('second') })
      })
    })

    // the error is still thrown (not swallowed), but the cleanups must all run
    expect(() => parent.dispose()).toThrow('boom from first child')
    expect(done).toContain('second')
    expect(done).toContain('parent')
  })

  it('when multiple children throw, the first error is thrown and no cleanup is skipped', () => {
    const parent = createOwner()
    const done: string[] = []

    runWithOwner(parent, () => {
      const first = createOwner()
      runWithOwner(first, () => {
        onDispose(() => { throw new Error('first boom') })
      })
      const second = createOwner()
      runWithOwner(second, () => {
        onDispose(() => { throw new Error('second boom') })
      })
      onDispose(() => { done.push('parent') })
    })

    expect(() => parent.dispose()).toThrow('first boom')
    expect(done).toContain('parent')
  })

  it('disposeSince isolates child errors the same way', () => {
    const owner = createOwner()
    const done: string[] = []
    let mark!: ReturnType<typeof owner.mark>

    runWithOwner(owner, () => {
      mark = owner.mark()
      const child = createOwner()
      runWithOwner(child, () => {
        onDispose(() => { throw new Error('child boom') })
      })
      onDispose(() => { done.push('after-mark') })
    })

    expect(() => owner.disposeSince(mark)).toThrow('child boom')
    expect(done).toContain('after-mark')
  })

  it('the parent Owner remains usable afterwards (disposed flag set and children cleared)', () => {
    const parent = createOwner()
    runWithOwner(parent, () => {
      const child = createOwner()
      runWithOwner(child, () => {
        onDispose(() => { throw new Error('boom') })
      })
    })

    expect(() => parent.dispose()).toThrow('boom')
    // a second dispose returns immediately without re-running cleanups
    expect(() => parent.dispose()).not.toThrow()
    expect(parent.disposed).toBe(true)
  })
})
