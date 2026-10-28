import pc from 'picocolors'

/*
 * Diagnostics/logs always go to **stderr**; stdout is reserved for **data**.
 *
 * Why this is not fussiness: `vobs check --json` output is a machine interface consumed by
 * AI and the devtools panel, and with `--json --write` the `logger.info('report written …')`
 * line would print a timestamped `[14:24:23] ℹ …` to stdout first, making
 * `JSON.parse(stdout)` fail outright (measured in `.artifacts/probe-audit-cli-check.mjs`:
 * with the same script `--json` parses and `--json --write` does not). Same for `warn`.
 *
 * Note: `error` already goes to stderr; `success`/`step` stay on stdout (they are the
 * **primary output** for humans, not side-channel logs), and check's success line stays on
 * stdout too.
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