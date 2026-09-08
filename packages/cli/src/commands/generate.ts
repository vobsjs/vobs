import { resolve } from 'node:path'
import * as p from '@clack/prompts'
import { logger } from '../utils/logger.js'
import { renderTemplate, writeFile, getTemplatesDir, ensureDir } from '../utils/file.js'
import type { GenerateOptions, ComponentTemplateContext, PageTemplateContext } from '../types.js'

export async function generateCommand(options: Partial<GenerateOptions>): Promise<void> {
  const type = options.type || (await p.select({
    message: 'What to generate?',
    options: [
      { value: 'component', label: 'Component' },
      { value: 'page', label: 'Page' }
    ]
  })) as 'component' | 'page'

  if (p.isCancel(type)) {
    p.cancel('Cancelled')
    return
  }

  const name = options.name || (await p.text({
    message: 'Name:',
    placeholder: type === 'component' ? 'Button' : 'AboutPage',
    validate: (v) => !v ? 'Name is required' : undefined
  })) as string

  if (p.isCancel(name)) {
    p.cancel('Cancelled')
    return
  }

  const templatesDir = getTemplatesDir()

  if (type === 'component') {
    const targetDir = options.targetDir || resolve(process.cwd(), 'src/components')
    ensureDir(targetDir)

    const context: ComponentTemplateContext = {
      name: toPascalCase(name),
      kebabName: toKebabCase(name)
    }

    const content = renderTemplate(
      resolve(templatesDir, 'component.hbs'),
      context as unknown as Record<string, unknown>
    )

    const filename = `${context.name}.tsx`
    writeFile(targetDir, filename, content)
    logger.success(`Created ${type} at ${resolve(targetDir, filename)}`)
  } else {
    const targetDir = options.targetDir || resolve(process.cwd(), 'src/pages')
    ensureDir(targetDir)

    const context: PageTemplateContext = {
      name: toPascalCase(name),
      path: `/${toKebabCase(name)}`
    }

    const content = renderTemplate(
      resolve(templatesDir, 'page.hbs'),
      context as unknown as Record<string, unknown>
    )

    const filename = `${context.name}.tsx`
    writeFile(targetDir, filename, content)
    logger.success(`Created ${type} at ${resolve(targetDir, filename)}`)
  }
}

function toPascalCase(str: string): string {
  return str
    .replace(/[^a-zA-Z0-9]/g, ' ')
    .split(/\s+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('')
}

function toKebabCase(str: string): string {
  return str
    .replace(/([A-Z])/g, '-$1')
    .toLowerCase()
    .replace(/^-/, '')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/--+/g, '-')
    .replace(/^-|-$/g, '')
}