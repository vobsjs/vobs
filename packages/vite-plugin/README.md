# @vobs/vite-plugin

Vite plugin that compiles Vobs TSX, turns imported HTML files into components, and wires up HMR and i18n key extraction.

## Install

```bash
npm install @vobs/vite-plugin
```

## Quick start

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import { vobsPlugin } from '@vobs/vite-plugin'

const collectedKeys = new Set<string>()

export default defineConfig({
  plugins: [
    vobsPlugin({
      html: true,
      extractI18n: key => collectedKeys.add(key)
    })
  ]
})
```

## API

| Signature | Description |
| --- | --- |
| `vobsPlugin(options?)` | Create the plugin; compiles matched modules with `@vobs/compiler`, returns source maps, and throws compiler errors as `VobsError` with code, location and code frame. |
| `options.include` | `RegExp` selecting modules to compile; defaults to `/\.tsx(?:$|\?)/`. |
| `options.compiler` | Extra `CompileOptions` forwarded to the compiler (e.g. custom `plugins`). |
| `options.hmr` | Inject `import.meta.hot` accept/dispose handlers; defaults to on in dev and off for production builds. |
| `options.extractI18n` | Callback `(key, filename)` receiving each static translation key collected from `t('...')` and `i18n.t('...')` calls. |
| `options.html` | Compile imported `.html`/`.htm` modules into Vobs components (scripts, inline event attributes and dangerous URLs are rejected); `false` disables, or pass `{ extensions }` for other file types. |

## Types

VobsVitePluginOptions
