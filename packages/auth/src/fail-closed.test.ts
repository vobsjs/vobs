// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { effect, scheduler, state } from '@vobs/reactivity'
import { createAuth } from './index'
import type { Session } from './index'

/*
 * Permission checks must **deny by default**: never throw, never substring-match.
 *
 * The original `hasPermission` / `hasRole` did a direct `session.value?.user.permissions.includes(...)`:
 *  1. A session missing fields (incomplete hydration, `{}`) → TypeError. Crash during mount;
 *     **swallowed by an effect during updates** — after which the previously authorized content
 *     stays on the page: the most permissive path is precisely the quietest one (security-relevant);
 *  2. If the field is a string → `.includes` degrades into **substring matching**:
 *     `roles: 'editor'` makes `hasRole('e')` true.
 * Now only "string arrays" are accepted; anything else counts as an empty array → always deny.
 */
const ok: Session = { user: { id: '1', roles: ['editor'], permissions: ['article:read'] } }

function make(session: Session | null) {
  const signal = state<Session | null>(session)
  return { auth: createAuth({ session: signal }), signal }
}

describe('auth checks deny by default', () => {
  it('never throws on a malformed session, always denies', () => {
    for (const broken of [{} as Session, { user: {} } as unknown as Session, { user: null } as unknown as Session]) {
      const { auth } = make(broken)
      expect(() => auth.hasPermission('article:read')).not.toThrow()
      expect(() => auth.hasRole('editor')).not.toThrow()
      expect(auth.hasPermission('article:read')).toBe(false)
      expect(auth.hasRole('editor')).toBe(false)
    }
  })

  it('a string field is never satisfied via substring matching', () => {
    const { auth } = make({ user: { id: '1', roles: 'editor', permissions: 'article:read article:edit' } } as unknown as Session)
    expect(auth.hasRole('e'), 'must never substring-match when roles is a string').toBe(false)
    expect(auth.hasRole('editor')).toBe(false)
    expect(auth.hasPermission('read')).toBe(false)
    expect(auth.hasPermission('article:read')).toBe(false)
  })

  it('updates no longer swallow the throw (previously old content silently stayed on the page)', () => {
    const { auth, signal } = make(ok)
    const reads: boolean[] = []
    // The check runs inside an effect: a throw would be swallowed by the framework (effect.ts error
    // path), leaving the page stuck on its previous state
    expect(() => {
      effect(() => { reads.push(auth.hasPermission('article:read')) })
      scheduler.flush()
    }).not.toThrow()
    expect(reads).toEqual([true])

    // Swap the session for a malformed one — the update must yield false, not a swallowed throw
    expect(() => {
      signal.value = {} as Session
      scheduler.flush()
    }).not.toThrow()
    expect(reads, 'must re-evaluate to a denial after the update').toEqual([true, false])
  })

  it('normal session behavior unchanged (non-regression)', () => {
    const { auth } = make(ok)
    expect(auth.hasPermission('article:read')).toBe(true)
    expect(auth.hasRole('editor')).toBe(true)
    expect(auth.hasPermission('nope')).toBe(false)
    expect(auth.hasRole('nope')).toBe(false)
  })

  it('non-string elements mixed into the array are ignored (no accidental allow)', () => {
    const { auth } = make({ user: { id: '1', roles: [1, 'editor', null], permissions: [{}, 'x'] } } as unknown as Session)
    expect(auth.hasRole('editor')).toBe(true)
    expect(auth.hasPermission('x')).toBe(true)
    expect(auth.hasRole('1')).toBe(false)
  })
})
