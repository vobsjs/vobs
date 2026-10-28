import {
  createInjectionKey,
  inject,
  type InjectionKey
} from '@vobs/vobs'
import type { KitLayoutContext } from './types'

export const KIT_LAYOUT_KEY: InjectionKey<KitLayoutContext> =
  createInjectionKey<KitLayoutContext>('vobs.kit.layout')

export function useKitLayout(): KitLayoutContext {
  const context = inject(KIT_LAYOUT_KEY)
  if (!context) {
    throw new Error('Vobs Layout: KitLayout context not found')
  }
  return context
}
