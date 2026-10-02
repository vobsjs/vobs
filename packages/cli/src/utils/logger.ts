import pc from 'picocolors'

/*
 * 诊断/日志一律走 **stderr**，stdout 只留给**数据**。
 *
 * 为什么这不是洁癖：`vobs check --json` 的输出是给 AI 与开发台面板消费的机器接口，
 * 而 `--json --write` 时 `logger.info('报告写入 …')` 会先往 stdout 打一行带时间戳的
 * `[14:24:23] ℹ …`，于是 `JSON.parse(stdout)` 直接失败（实测
 * `.artifacts/probe-audit-cli-check.mjs`：同一脚本里 `--json` 可 parse、`--json --write` 不可）。
 * `warn` 同理。
 *
 * 注意：`error` 本来就走 stderr；`success`/`step` 保持 stdout（它们是给人看的**主输出**，
 * 不是旁路日志），`check` 的成功行也仍是 stdout。
 */
function timestamp(): string {
  return pc.dim(`[${new Date().toLocaleTimeString()}]`)
}

export function info(msg: string): void {
  console.error(`${timestamp()} ${pc.cyan('ℹ')} ${msg}`)
}

export function success(msg: string): void {
  console.log(`${timestamp()} ${pc.green('✔')} ${msg}`)
}

export function warn(msg: string): void {
  console.error(`${timestamp()} ${pc.yellow('⚠')} ${msg}`)
}

export function error(msg: string): void {
  console.error(`${timestamp()} ${pc.red('✖')} ${msg}`)
}

export function step(msg: string): void {
  console.log(`\n  ${pc.bold(pc.cyan(msg))}`)
}

export const logger = { info, success, warn, error, step }