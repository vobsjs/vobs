import { describe, expect, it } from 'vitest'
import { createOwner, onDispose, runWithOwner } from './owner'

/*
 * 级联销毁的隔离性。
 *
 * 子 Owner 的 cleanup 抛错时，原来 `dispose()` 里是裸调 `child.dispose()` ——
 * 一个子级抛错就让**兄弟 Owner 全不销毁、父自身的 cleanup 也不跑**
 * （实测：父 cleanup 未执行、第二个子 owner 仍存活）。
 * 那是资源泄漏（effect 不解绑、监听不移除），而且完全没有提示。
 */
describe('Owner 级联销毁', () => {
  it('子级 cleanup 抛错不阻断兄弟与父自身的清理', () => {
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

    // 错误照旧抛出来（不吞），但清理必须走完
    expect(() => parent.dispose()).toThrow('boom from first child')
    expect(done).toContain('second')
    expect(done).toContain('parent')
  })

  it('多个子级都抛错时抛第一个，且不跳过任何清理', () => {
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

  it('disposeSince 同样隔离子级错误', () => {
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

  it('父 Owner 后续仍然可用（disposed 标记与 children 已清空）', () => {
    const parent = createOwner()
    runWithOwner(parent, () => {
      const child = createOwner()
      runWithOwner(child, () => {
        onDispose(() => { throw new Error('boom') })
      })
    })

    expect(() => parent.dispose()).toThrow('boom')
    // 再次 dispose 直接返回，不重复跑清理
    expect(() => parent.dispose()).not.toThrow()
    expect(parent.disposed).toBe(true)
  })
})
