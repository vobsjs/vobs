/*
 * Global vitest setup.
 *
 * The only reason this exists: `@vobs/test-utils`'s `mount()` installs the test
 * renderer into a **process-level** `setRenderer` singleton, and the package itself
 * **must not depend on vitest** (it has no devDependencies), so the cleanup function
 * has to be hooked onto vitest by the caller. Hooked once here, any test that
 * forgets `destroy()` no longer pollutes later tests in the same file (vitest
 * defaults to `globals: false`; `globalThis.afterEach` is not readable inside the
 * package, so it can only be wired here).
 */
import { afterEach } from 'vitest'
import { cleanupMountedApps } from '@vobs/test-utils'

afterEach(cleanupMountedApps)
