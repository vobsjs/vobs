# @vobs/tailwind

Tailwind CSS v4 integration for Vobs, with theme tokens exposed through Tailwind's namespaces.

## Install

```bash
npm install @vobs/tailwind
```

## Quick start

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import { vobsTailwind } from '@vobs/tailwind'

export default defineConfig({
  plugins: [vobsTailwind()]
})
```

```css
/* app.css */
@import "@vobs/tailwind/styles.css";
```

## API

| Signature | Description |
| --- | --- |
| `vobsTailwind(options?)` | Thin wrapper around the Tailwind v4 Vite plugin (`@tailwindcss/vite`); returns the plugin array and passes options through unchanged. |
| `@vobs/tailwind/styles.css` | Tailwind theme and utilities layers plus Vobs theme tokens. |
| `@vobs/tailwind/styles-prefixed.css` | Same stylesheet with utilities under the `vobs` prefix, for class name collisions. |
| `@vobs/tailwind/theme.css` | Vobs semantic tokens mapped to Tailwind's color, spacing and radius namespaces. |

## Types

VobsTailwindOptions
