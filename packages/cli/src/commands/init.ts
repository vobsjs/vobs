import { resolve } from 'node:path'
import { execSync } from 'node:child_process'
import * as p from '@clack/prompts'
import { logger } from '../utils/logger.js'
import { scaffoldProject } from '../utils/file.js'
import { installDependencies } from '../utils/pm.js'
import type { InitOptions } from '../types.js'

export async function initCommand(options: Partial<InitOptions>): Promise<void> {
  const projectName = options.name || (await p.text({
    message: 'Project name:',
    placeholder: 'my-vobs-app',
    validate: (v) => !v ? 'Project name is required' : undefined
  })) as string

  if (p.isCancel(projectName)) {
    p.cancel('Cancelled')
    return
  }

  const targetDir = options.targetDir || resolve(process.cwd(), projectName)

  const packageManager = options.packageManager || (await p.select({
    message: 'Package manager:',
    options: [
      { value: 'pnpm', label: 'pnpm' },
      { value: 'npm', label: 'npm' },
      { value: 'yarn', label: 'yarn' }
    ]
  })) as 'pnpm' | 'npm' | 'yarn'

  if (p.isCancel(packageManager)) {
    p.cancel('Cancelled')
    return
  }

  const useTypescript = options.typescript ?? (await p.confirm({
    message: 'Use TypeScript?',
    initialValue: true
  })) as boolean

  if (p.isCancel(useTypescript)) {
    p.cancel('Cancelled')
    return
  }

  const initGit = options.git ?? (await p.confirm({
    message: 'Initialize a git repository?',
    initialValue: true
  })) as boolean

  if (p.isCancel(initGit)) {
    p.cancel('Cancelled')
    return
  }

  logger.step(`Creating project ${projectName}...`)

  await scaffoldProject(targetDir, {
    name: projectName,
    packageName: projectName.toLowerCase().replace(/\s+/g, '-'),
    typescript: useTypescript,
    vobsVersion: '1.0.0'
  })

  logger.success('Project scaffolded')

  logger.step('Installing dependencies...')
  installDependencies(targetDir, packageManager)
  logger.success('Dependencies installed')

  if (initGit) {
    logger.step('Initializing git repository...')
    try {
      execSync('git init', { cwd: targetDir, stdio: 'ignore' })
      logger.success('Git repository initialized')
    } catch {
      logger.warn('Git not found, skipping git init')
    }
  }

  logger.step('Done!')
  console.log(`\n  ${packageManager === 'pnpm' ? 'pnpm' : packageManager === 'yarn' ? 'yarn' : 'npm run'} dev\n`)
}