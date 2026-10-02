/*
 * vitest 的全局 setup。
 *
 * 存在的唯一理由是：`@vobs/test-utils` 的 `mount()` 会把测试渲染器装进**进程级**
 * `setRenderer` 单例，而包自己**不能依赖 vitest**（它连 devDependencies 都没有），
 * 所以清理函数必须由调用方接到 vitest 的钩子上。这里接一次，之后任何用例忘记
 * `destroy()` 都不会再污染同文件后续用例（vitest 默认 `globals: false`，
 * 包内读不到 `globalThis.afterEach`，只能在这里接）。
 */
import { afterEach } from 'vitest'
import { cleanupMountedApps } from '@vobs/test-utils'

afterEach(cleanupMountedApps)
