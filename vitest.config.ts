import { defineConfig, mergeConfig } from 'vitest/config'
import { configDefaults } from 'vitest/config'
import viteConfig from './vite.config'
import { workspaceAliases } from './scripts/vite-workspace.mjs'

/*
 * **需要独立 threads 池的测试文件**：依赖 Node 全局 / 原生 hook，与 vmThreads
 * 复用的 jsdom 环境不兼容 ——
 * - `tailwind/index.test.ts`：@tailwindcss/node 的 `registerHooks` 在 vm 上下文被 vitest 拦截
 * - `payment/alipay.test.ts` / `http/index.test.ts`：undici 求值要 `ReadableStream` 全局
 * - `vobs/lifecycle.test.ts`：「没有 document 时不执行」的环境切换语义
 * 新文件若在 vm 池报「xxx is not defined / not available」，把路径加进这里。
 */
const NODE_SEMANTICS_FILES = [
  'packages/tailwind/src/index.test.ts',
  'packages/payment/src/alipay/alipay.test.ts',
  'packages/http/src/index.test.ts',
  'packages/vobs/src/lifecycle.test.ts'
]

/**
 * 测试配置 = 既有 vite 配置（workspace 别名）+ JSX 转换。
 *
 * **必须合并而不是替换**：`vite.config.ts` 里的 `workspaceAliases()` 把 `@vobs/*`
 * 指到各包的 `src`。一旦测试只读本文件，`@vobs/runtime/error` 就会解析到
 * `dist/error.js` —— 那是另一份打包副本，类身份不同，`toThrow(VobsError)` 之类的
 * `instanceof` 断言会假；这正是跨入口身份问题的表现。
 *
 * 另一半：仓库里此前**一个 `.test.tsx` 都没有**，而含 `.tsx` 源码的四个包
 * （devtools-ui / dsh-console / dsh-devkit / dsh-plugin）恰好就是没测试的那几个。
 * 原因不是巧合 —— 默认 JSX 转换走 React classic（`React.createElement`），
 * `.tsx` 组件一挂载就 `ReferenceError: React is not defined`。
 * `tsconfig.base.json` 里的 `"jsx": "preserve"` + `"jsxImportSource": "@vobs/vobs"`
 * 只管 `tsc`，esbuild/vitest 不会照着做，所以这里显式指定。
 */
export default mergeConfig(
  viteConfig,
  defineConfig({
    // 显式带上别名，免得将来有人把 vite.config.ts 改成非默认位置时又踩一次
    resolve: { alias: workspaceAliases() },
    esbuild: {
      jsx: 'automatic',
      jsxImportSource: '@vobs/vobs'
    },
    test: {
      /*
       * **分池**：主组 dom 用 vmThreads 复用 jsdom 环境（默认 threads 池下每个
       * 测试文件都新建一个 jsdom —— 195 个文件累计 ~350s、占全量 ~78% 耗时，
       * vitest 自己会在输出末尾提示）；vmThreads 每个 worker 只建一次环境，
       * 且保持 per-file 模块隔离（instanceof 断言的类身份不受影响）。
       * 例外组 node-semantics 保留原池，见 NODE_SEMANTICS_FILES 注释。
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
       * 只做一件事：把 `@vobs/test-utils` 的 `cleanupMountedApps` 接到 vitest 的 afterEach 上。
       * mount() 会装进程级渲染器单例，忘记 destroy() 的用例会污染同文件后续用例；而包本身
       * 不能依赖 vitest（没有 devDependencies），清理必须由调用方接钩子 —— 见该文件注释。
       */
      setupFiles: ['./scripts/vitest-setup.ts']
    }
  })
)
