import * as p from '@clack/prompts'
import { logger } from '../utils/logger.js'
import { detectPackageManager, addPackage } from '../utils/pm.js'
import type { AddOptions } from '../types.js'

export async function addCommand(options: Partial<AddOptions>): Promise<void> {
  const pkg = options.package || (await p.text({
    message: 'Package to add:',
    placeholder: '@vobs/ui',
    validate: (v) => !v ? 'Package name is required' : undefined
  })) as string

  if (p.isCancel(pkg)) {
    p.cancel('Cancelled')
    return
  }

  const isDev = options.dev ?? (await p.confirm({
    message: 'Save as dev dependency?',
    initialValue: false
  })) as boolean

  if (p.isCancel(isDev)) {
    p.cancel('Cancelled')
    return
  }

  const pm = detectPackageManager(process.cwd())

  logger.step(`Installing ${pkg}...`)
  addPackage(process.cwd(), pm, pkg, isDev)

  logger.success(`Installed ${pkg}`)
  console.log(`\n  Import it in your code:\n`)
  console.log(`    import { ... } from '${pkg}'`)
  console.log()
}