export interface InitOptions {
  /** Project name */
  name: string
  /** Target directory */
  targetDir: string
  /** Package manager to use */
  packageManager?: 'pnpm' | 'npm' | 'yarn'
  /** Use TypeScript */
  typescript?: boolean
  /** Initialize git repo */
  git?: boolean
}

export interface GenerateOptions {
  /** Generator type: component | page */
  type: 'component' | 'page'
  /** Name of the generated artifact */
  name: string
  /** Target directory (defaults to src/components/ or src/pages/) */
  targetDir?: string
}

export interface DevOptions {
  /** Vite config file path */
  config?: string
  /** Port to listen on */
  port?: number
  /** Open browser on start */
  open?: boolean
}

export interface BuildOptions {
  /** Vite config file path */
  config?: string
  /** Output directory */
  outDir?: string
  /** Mode (production | development) */
  mode?: string
}

export interface AddOptions {
  /** Package name to add */
  package: string
  /** Save as dev dependency */
  dev?: boolean
}

export interface TemplateContext {
  /** Project name */
  name: string
  /** Package name (kebab-case) */
  packageName: string
  /** Use TypeScript */
  typescript: boolean
  /** @vobs/* version to use */
  vobsVersion: string
}

export interface ComponentTemplateContext {
  /** Component name (PascalCase) */
  name: string
  /** Component name (kebab-case) */
  kebabName: string
}

export interface PageTemplateContext {
  /** Page name (PascalCase) */
  name: string
  /** Route path */
  path: string
}

export type LoggerLevel = 'info' | 'success' | 'warn' | 'error'

export interface CLIOptions {
  /** Enable debug output */
  debug?: boolean
}