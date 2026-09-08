import { useI18n } from '@vobs/i18n'
import { state } from '@vobs/vobs'
import { Button, Card, Tag } from '@vobs/ui'

const commands = [
  {
    name: 'init / create',
    usage: 'vobs init my-app',
    description: 'Create a new vobs project',
    options: ['--dir <dir>', '--pm <pm>', '--no-typescript', '--no-git'],
    template: 'basic'
  },
  {
    name: 'dev',
    usage: 'vobs dev',
    description: 'Start the dev server (delegates to Vite)',
    options: ['--config <path>', '--port <port>', '--open']
  },
  {
    name: 'build',
    usage: 'vobs build',
    description: 'Build for production (delegates to Vite)',
    options: ['--config <path>', '--outDir <dir>', '--mode <mode>']
  },
  {
    name: 'generate / g',
    usage: 'vobs g component Button',
    description: 'Generate code (component or page)',
    options: ['--type <type>', '--dir <dir>']
  },
  {
    name: 'add',
    usage: 'vobs add @vobs/ui',
    description: 'Add a package',
    options: ['-D, --dev']
  }
]

const templateFiles = [
  { name: 'package.json', desc: 'Project manifest with @vobs/* dependencies' },
  { name: 'vite.config.ts', desc: 'Vite config with vobsPlugin() and vobsTailwind()' },
  { name: 'tsconfig.json', desc: 'TypeScript config targeting ES2020' },
  { name: 'index.html', desc: 'Entry HTML with #app mount point' },
  { name: 'src/main.ts', desc: 'Application entry with createVobs()' },
  { name: 'src/App.tsx', desc: 'Root component' },
  { name: 'src/app.css', desc: 'Global styles' },
  { name: '.gitignore', desc: 'Standard ignore rules' }
]

export function CLIPage() {
  const i18n = useI18n()
  const output = state('', 'cli.output')

  const handlePreview = () => {
    output.value = `> vobs init my-app
  ✔ Project scaffolded
  ✔ Dependencies installed
  ✔ Git repository initialized

  Done!

  cd my-app
  pnpm dev`
  }

  const handlePreviewGenerate = () => {
    output.value = `> vobs g component Button
  ✔ Created component at ${window.location.origin}/src/components/Button.tsx`
  }

  return (
    <div class="cli-page">
      <div class="cli-header">
        <h1>{i18n.t('cli.title')}</h1>
        <p class="cli-description">{i18n.t('cli.description')}</p>
      </div>

      {/* Commands */}
      <Card class="cli-section">
        <h2 class="cli-section-title">{i18n.t('cli.commands.title')}</h2>
        <p class="cli-section-desc">{i18n.t('cli.commands.description')}</p>
        <div class="cli-commands">
          {commands.map(cmd => (
            <div class="cli-command-item">
              <div class="cli-command-header">
                <code class="cli-command-name">{cmd.name}</code>
                <Tag tone="brand">{cmd.template ?? 'vite'}</Tag>
              </div>
              <code class="cli-command-usage">$ {cmd.usage}</code>
              <p class="cli-command-desc">{cmd.description}</p>
              {cmd.options.length > 0 && (
                <div class="cli-command-options">
                  {cmd.options.map(opt => (
                    <code class="cli-option-tag">{opt}</code>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </Card>

      {/* Templates */}
      <Card class="cli-section">
        <h2 class="cli-section-title">{i18n.t('cli.templates.title')}</h2>
        <p class="cli-section-desc">{i18n.t('cli.templates.description')}</p>
        <div class="cli-template-list">
          {templateFiles.map(f => (
            <div class="cli-template-item">
              <code class="cli-template-name">{f.name}</code>
              <span class="cli-template-desc">{f.desc}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Preview */}
      <Card class="cli-section">
        <h2 class="cli-section-title">{i18n.t('cli.preview.title')}</h2>
        <p class="cli-section-desc">{i18n.t('cli.preview.description')}</p>
        <div class="cli-preview-actions">
          <Button variant="primary" onClick={handlePreview}>{i18n.t('cli.preview.runInit')}</Button>
          <Button variant="secondary" onClick={handlePreviewGenerate}>{i18n.t('cli.preview.runGenerate')}</Button>
        </div>
        {output.value && (
          <pre class="cli-preview-output">{output.value}</pre>
        )}
      </Card>
    </div>
  )
}