import { readFileSync } from 'node:fs'

/**
 * CLI 版本号的**单一来源**：直接读本包的 `package.json`。
 *
 * 此前版本号在三处各自硬编码，且都与 `package.json` 不符：
 * - `banner.ts` 的 `𝗩𝗢𝗕𝗦 𝗖𝗟𝗜 𝘃𝟭.𝟬` 常量 —— 这就是 `vobs --version` 的**全部**输出；
 * - `cli.ts` 的 `cli.version('1.0.0')` —— `--help` 头部显示 `vobs/1.0.0`；
 * - `init.ts` 的 `vobsVersion: '1.0.0'` —— 写进脚手架产物。
 * 同一个仓库的 `commands/dsh.ts` 早就有正确的"读 package.json"实现，所以这不是能力问题，
 * 而是没人从**外部**看过 CLI 的版本输出（三处不一致也正因如此从未被发现）。
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
