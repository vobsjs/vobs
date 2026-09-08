import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { execSync } from 'node:child_process'

export type PackageManager = 'pnpm' | 'npm' | 'yarn'

/** Detect the package manager to use */
export function detectPackageManager(targetDir?: string): PackageManager {
  // Check if a specific package manager is locked
  if (targetDir) {
    if (existsSync(resolve(targetDir, 'pnpm-lock.yaml'))) return 'pnpm'
    if (existsSync(resolve(targetDir, 'yarn.lock'))) return 'yarn'
    if (existsSync(resolve(targetDir, 'package-lock.json'))) return 'npm'
  }

  // Check for global preference
  const userAgent = process.env.npm_config_user_agent || ''
  if (userAgent.startsWith('pnpm')) return 'pnpm'
  if (userAgent.startsWith('yarn')) return 'yarn'
  if (userAgent.startsWith('npm')) return 'npm'

  // Default to pnpm
  return 'pnpm'
}

/** Install dependencies in a directory */
export function installDependencies(targetDir: string, pm: PackageManager): void {
  const cmd = pm === 'yarn' ? 'yarn' : `${pm} install`
  execSync(cmd, { cwd: targetDir, stdio: 'inherit' })
}

/** Add a package as a dependency */
export function addPackage(targetDir: string, pm: PackageManager, pkg: string, dev: boolean): void {
  const installFlag = dev ? '-D' : ''
  const cmd = pm === 'npm'
    ? `npm install ${installFlag} ${pkg}`
    : pm === 'yarn'
      ? `yarn add ${installFlag} ${pkg}`
      : `pnpm add ${installFlag} ${pkg}`

  execSync(cmd, { cwd: targetDir, stdio: 'inherit' })
}