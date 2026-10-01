import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config'
import { workspaceAliases } from './scripts/vite-workspace.mjs'

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
    }
  })
)
