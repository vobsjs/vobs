import { defineConfig, mergeConfig } from 'vitest/config'
import { configDefaults } from 'vitest/config'
import viteConfig from './vite.config'
import { workspaceAliases } from './scripts/vite-workspace.mjs'

/*
 * **Test files that need a separate threads pool**: they depend on Node globals / native hooks,
 * which are incompatible with the jsdom environment reused by vmThreads —
 * - `tailwind/index.test.ts`: @tailwindcss/node's `registerHooks` gets intercepted by vitest inside the vm context
 * - `payment/alipay.test.ts` / `http/index.test.ts`: undici evaluation requires the `ReadableStream` global
 * - `vobs/lifecycle.test.ts`: the "do nothing when there is no document" environment-switching semantics
 * If a new file reports "xxx is not defined / not available" in the vm pool, add its path here.
 */
const NODE_SEMANTICS_FILES = [
  'packages/tailwind/src/index.test.ts',
  'packages/payment/src/alipay/alipay.test.ts',
  'packages/http/src/index.test.ts',
  'packages/vobs/src/lifecycle.test.ts'
]

/**
 * Test config = the existing vite config (workspace aliases) + JSX transform.
 *
 * **Must merge, not replace**: `workspaceAliases()` in `vite.config.ts` points `@vobs/*`
 * at each package's `src`. If tests only read this file, `@vobs/runtime/error` would resolve to
 * `dist/error.js` — a separately bundled copy with a different class identity, so `instanceof`
 * assertions like `toThrow(VobsError)` would fail spuriously. This is exactly the cross-entry
 * identity problem.
 *
 * The other half: the repository previously had **not a single `.test.tsx`**, and the four packages
 * with `.tsx` sources (devtools-ui / dsh-console / dsh-devkit / dsh-plugin) were precisely the ones
 * without tests. Not a coincidence — the default JSX transform went through React classic
 * (`React.createElement`), so a mounted `.tsx` component immediately threw
 * `ReferenceError: React is not defined`. `"jsx": "preserve"` + `"jsxImportSource": "@vobs/vobs"`
 * in `tsconfig.base.json` only governs `tsc`; esbuild/vitest do not follow it, hence the explicit
 * setting here.
 */
export default mergeConfig(
  viteConfig,
  defineConfig({
    // Aliases restated explicitly, so nobody trips over this again if vite.config.ts is ever moved off its default location
    resolve: { alias: workspaceAliases() },
    esbuild: {
      jsx: 'automatic',
      jsxImportSource: '@vobs/vobs'
    },
    test: {
      /*
       * **Split pools**: the main `dom` group uses vmThreads to reuse one jsdom environment (under the default
       * threads pool every test file creates a new jsdom — 195 files added up to ~350s, ~78% of total runtime;
       * vitest itself hints at this at the end of its output). vmThreads creates the environment once per worker
       * while keeping per-file module isolation (class identity for instanceof assertions is unaffected).
       * The exception group node-semantics keeps the original pool; see the NODE_SEMANTICS_FILES comment.
       */
      projects: [
        {
          test: {
            name: 'node-semantics',
            environment: 'jsdom',
            include: NODE_SEMANTICS_FILES,
            setupFiles: ['./scripts/vitest-setup.ts']
          }
        },
        {
          test: {
            name: 'dom',
            environment: 'jsdom',
            pool: 'vmThreads',
            exclude: [...configDefaults.exclude, ...NODE_SEMANTICS_FILES],
            setupFiles: ['./scripts/vitest-setup.ts']
          }
        }
      ],
      /*
       * Does exactly one thing: hooks `@vobs/test-utils`'s `cleanupMountedApps` onto vitest's afterEach.
       * mount() installs a process-level renderer singleton, so cases that forget destroy() pollute later
       * cases in the same file; and the package itself cannot depend on vitest (it has no devDependencies),
       * so cleanup must be wired up by the caller — see that file's comments.
       */
      setupFiles: ['./scripts/vitest-setup.ts']
    }
  })
)
