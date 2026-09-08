import pc from 'picocolors'

function timestamp(): string {
  return pc.dim(`[${new Date().toLocaleTimeString()}]`)
}

export function info(msg: string): void {
  console.log(`${timestamp()} ${pc.cyan('ℹ')} ${msg}`)
}

export function success(msg: string): void {
  console.log(`${timestamp()} ${pc.green('✔')} ${msg}`)
}

export function warn(msg: string): void {
  console.log(`${timestamp()} ${pc.yellow('⚠')} ${msg}`)
}

export function error(msg: string): void {
  console.error(`${timestamp()} ${pc.red('✖')} ${msg}`)
}

export function step(msg: string): void {
  console.log(`\n  ${pc.bold(pc.cyan(msg))}`)
}

export const logger = { info, success, warn, error, step }