# @vobs/cli

Command-line interface for the vobs framework: project scaffolding, code generation, and dev/build tooling.

## Install

```bash
npm install -g @vobs/cli
# or
npx @vobs/cli
```

## Quick start

```bash
# Create a new project
vobs init my-app

# Start the dev server
cd my-app
vobs dev

# Build for production
vobs build

# Generate a component
vobs g component Button

# Add a package
vobs add @vobs/ui
```

## Commands

| Command | Usage | Description |
| --- | --- | --- |
| `init` / `create` | `vobs init my-app` | Create a new vobs project with interactive prompts (project name, package manager, TypeScript, git). |
| `dev` | `vobs dev` | Start the Vite dev server. Accepts `--port`, `--open`, `--config`. |
| `build` | `vobs build` | Build for production via Vite. Accepts `--outDir`, `--mode`, `--config`. |
| `generate` / `g` | `vobs g component Button` | Generate a component or page from a Handlebars template. Accepts `--type`, `--dir`. |
| `add` | `vobs add @vobs/notification` | Install a package and save to dependencies. Accepts `-D` / `--dev`. |

## Options

| Option | Description |
| --- | --- |
| `-h, --help` | Show help output |
| `-V, --version` | Show version number |

### init options

| Option | Default | Description |
| --- | --- | --- |
| `--dir <dir>` | current directory | Target directory for the new project |
| `--pm <pm>` | detected | Package manager: `pnpm`, `npm`, or `yarn` |
| `--no-typescript` | TypeScript enabled | Skip TypeScript setup |
| `--no-git` | git init enabled | Skip git repository initialization |

### dev options

| Option | Default | Description |
| --- | --- | --- |
| `--port <port>` | Vite default | Dev server port |
| `--open` | false | Open browser on start |
| `--config <path>` | `vite.config.ts` | Path to Vite config file |

### build options

| Option | Default | Description |
| --- | --- | --- |
| `--outDir <dir>` | `dist` | Output directory |
| `--mode <mode>` | `production` | Build mode |
| `--config <path>` | `vite.config.ts` | Path to Vite config file |

## Templates

The `init` command scaffolds a project from Handlebars templates:

```
my-app/
├── package.json          # Project manifest with @vobs/* dependencies
├── vite.config.ts        # Vite config with vobsPlugin() and vobsTailwind()
├── tsconfig.json         # TypeScript config targeting ES2020
├── index.html            # Entry HTML with #app mount point
├── .gitignore            # Standard ignore rules
└── src/
    ├── main.ts           # Application entry with createVobs()
    ├── App.tsx           # Root component
    └── app.css           # Global styles
```

## Programmatic API

```ts
import { createCLI } from '@vobs/cli'

// Parse and execute CLI commands programmatically
const cli = createCLI()
cli.parse(process.argv)
```

```ts
import { scaffoldProject } from '@vobs/cli'

// Scaffold a project without CLI interaction
await scaffoldProject('/path/to/target', {
  name: 'my-app',
  packageName: 'my-app',
  typescript: true,
  vobsVersion: '1.0.0'
})
```

## Types

InitOptions, GenerateOptions, DevOptions, BuildOptions, AddOptions, TemplateContext, ComponentTemplateContext, PageTemplateContext, CLIOptions, LoggerLevel, PackageManager