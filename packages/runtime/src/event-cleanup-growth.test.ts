// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createOwner } from '@vobs/reactivity'
import { createDOMRenderer, setRenderer } from '@vobs/vobs'
import { addEventListener, bindSpreadProps, createElement, removeEventListener, setStaticProps } from './index'

setRenderer(createDOMRenderer())

const flush = async () => { await Promise.resolve(); await Promise.resolve() }

/*
 * `Owner.cleanups` is a **push-only array** (reactivity/src/owner.ts:57,84).
 * Event rebinding used to unconditionally call `owner.onDispose(...)` on **every**
 * `addEventListener`, so each handler swap added a cleanup entry that never executes,
 * with the old handler closure held captive.
 *
 * Measured (.artifacts/reports/runtime.supplement.md drawback 4 and the earlier report's
 * drawback 1, two independent reproductions):
 * 500 replacements → `cleanups.length === 500`; one round of `{...props}` swapping onClick → 202.
 * Component effects rebind events on every re-run, so this is **unbounded growth** on the
 * hot path (equivalent to a memory leak on long-lived pages).
 *
 * The criterion uses the cleanups count difference around `owner.mark()` — `mark()` is a
 * public Owner API, not depending on `cleanups` being a private field.
 */
describe('event rebinding must not make Owner.cleanups grow without bound', () => {
  it('swapping the handler 200 times for the same (node,event) grows the cleanup slots by only 1', () => {
    const owner = createOwner()
    const el = createElement('button')
    owner.run(() => {
      const before = owner.mark().cleanups
      for (let index = 0; index < 200; index += 1) {
        addEventListener(el, 'click', () => { void index })
      }
      const after = owner.mark().cleanups
      // Before the fix this was 200
      expect(after - before).toBe(1)
    })
  })

  it('different event names each occupy one slot (not shared)', () => {
    const owner = createOwner()
    const el = createElement('button')
    owner.run(() => {
      const before = owner.mark().cleanups
      addEventListener(el, 'click', () => {})
      addEventListener(el, 'keydown', () => {})
      addEventListener(el, 'focus', () => {})
      expect(owner.mark().cleanups - before).toBe(3)
    })
  })

  it('the same event name on different nodes each occupies one slot', () => {
    const owner = createOwner()
    const a = createElement('button')
    const b = createElement('button')
    owner.run(() => {
      const before = owner.mark().cleanups
      addEventListener(a, 'click', () => {})
      addEventListener(b, 'click', () => {})
      // Same event name but different nodes: must each occupy a slot (that's what the
      // per-node numeric id in the key is for)
      expect(owner.mark().cleanups - before).toBe(2)
    })
  })

  it('{...props} rebinding onClick 200 rounds doesn\'t grow the cleanup slots', async () => {
    const owner = createOwner()
    let handler = (): void => {}
    await owner.run(async () => {
      const el = createElement('button')
      const before = owner.mark().cleanups
      bindSpreadProps(el, () => ({ onClick: handler }))
      // Baseline after establishment: the binding's own effect cleanup + one event slot each
      const baseline = owner.mark().cleanups

      for (let index = 0; index < 200; index += 1) {
        handler = () => { void index }
        await flush()
      }

      const after = owner.mark().cleanups
      // The criterion is "200 rebind rounds **added nothing**" (not some absolute number):
      // before the fix each round added +1 → the difference would be ~202; now it must be 0.
      expect(after - baseline).toBe(0)
      // And establishment added only a small fixed overhead (effect cleanup + event slots), not 200
      expect(baseline - before).toBeLessThanOrEqual(3)
    })
  })

  it('Owner disposal still detaches the **latest** listener (the slot wasn\'t invalidated by rebinding)', () => {
    const owner = createOwner()
    const el = createElement('button')
    const hits: string[] = []
    owner.run(() => {
      addEventListener(el, 'click', () => hits.push('old'))
      addEventListener(el, 'click', () => hits.push('new'))
    })
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(hits).toEqual(['new'])

    owner.dispose()
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    // After disposal everything must be fully detached — the slot must store the latest
    // handle, not point at an already-detached old handle
    expect(hits).toEqual(['new'])
  })

  it('re-attaching after removeEventListener still occupies only one slot', () => {
    const owner = createOwner()
    const el = createElement('button')
    owner.run(() => {
      const before = owner.mark().cleanups
      const first = (): void => {}
      addEventListener(el, 'click', first)
      removeEventListener(el, 'click', first)
      addEventListener(el, 'click', () => {})
      // Detach then attach: the slot is overwritten, nothing added
      expect(owner.mark().cleanups - before).toBe(1)
    })
  })

  it('setStaticProps events occupy no cleanup slot (static events don\'t go through addEventListener)', () => {
    const owner = createOwner()
    const el = createElement('button')
    owner.run(() => {
      const before = owner.mark().cleanups
      setStaticProps(el, { onClick: () => {} })
      expect(owner.mark().cleanups - before).toBe(0)
    })
  })
})
