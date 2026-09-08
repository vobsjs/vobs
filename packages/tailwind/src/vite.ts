import tailwindcss, { type PluginOptions } from '@tailwindcss/vite'
import type { Plugin } from 'vite'

export type VobsTailwindOptions = PluginOptions

/** Vite integration for Tailwind CSS with Vobs theme conventions. */
export function vobsTailwind(options: VobsTailwindOptions = {}): Plugin[] {
  return tailwindcss(options)
}
