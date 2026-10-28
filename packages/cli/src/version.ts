import { readFileSync } from 'node:fs'

/**
 * CLI 版本号的**单一来源**：直接读本包的 `package.json` ——
 * banner、`--help` 头部、脚手架产物三处都从这里取，**禁止再硬编码版本字符串**。
 */
let cached: string | undefined

export function cliVersion(): string {
  if (cached !== undefined) return cached
  try {
    const manifest = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8')
    ) as { version?: string }
    cached = manifest.version ?? '0.0.0'
  } catch {
    // 读不到 package.json（被打包成单文件等）时不要谎报一个像真版本号的常量
    cached = '0.0.0'
  }
  return cached
}
