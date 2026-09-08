import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import Handlebars from 'handlebars'

const __dirname = dirname(fileURLToPath(import.meta.url))
const TEMPLATES_ROOT = resolve(__dirname, '..', 'templates')

/** Get the absolute path to the templates directory */
export function getTemplatesDir(): string {
  return TEMPLATES_ROOT
}

/** Read a template file and compile it with Handlebars */
export function renderTemplate(
  templatePath: string,
  context: Record<string, unknown>
): string {
  const source = readFileSync(templatePath, 'utf-8')
  const template = Handlebars.compile(source)
  return template(context)
}

/** Write a file, creating parent directories if needed */
export function writeFile(dir: string, filename: string, content: string): void {
  const filePath = resolve(dir, filename)
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, content, 'utf-8')
}

/** Ensure a directory exists */
export function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

/** Check if a path exists */
export function pathExists(path: string): boolean {
  return existsSync(path)
}

/** Copy a template directory recursively, rendering each .hbs file */
async function copyDirRecursive(srcDir: string, destDir: string, context: Record<string, unknown>): Promise<void> {
  const { readdirSync } = await import('node:fs')
  const { join } = await import('node:path')

  const entries = readdirSync(srcDir, { withFileTypes: true })

  for (const entry of entries) {
    const srcPath = join(srcDir, entry.name)
    const isHbs = entry.name.endsWith('.hbs')
    const destName = isHbs ? entry.name.slice(0, -4) : entry.name
    const destPath = join(destDir, destName)

    if (entry.isDirectory()) {
      ensureDir(destPath)
      await copyDirRecursive(srcPath, destPath, context)
    } else if (isHbs) {
      const content = renderTemplate(srcPath, context)
      writeFile(destDir, destName, content)
    } else {
      const content = readFileSync(srcPath, 'utf-8')
      writeFile(destDir, destName, content)
    }
  }
}

/** Scaffold a project from the basic template */
export async function scaffoldProject(
  targetDir: string,
  context: Record<string, unknown>
): Promise<void> {
  const templateDir = resolve(TEMPLATES_ROOT, 'basic')
  ensureDir(targetDir)
  await copyDirRecursive(templateDir, targetDir, context)
}