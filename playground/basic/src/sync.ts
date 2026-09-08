import { syncPlugin } from '@vobs/sync'
import { state } from '@vobs/vobs'

export const syncScenario = state<'success' | 'error' | 'slow'>('success', 'playground.sync.scenario')

function waitForSync(signal: AbortSignal, delay: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, delay)
    const abort = (): void => {
      clearTimeout(timer)
      reject(Object.assign(new Error('Sync cancelled'), { name: 'AbortError' }))
    }
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
  })
}

export const playgroundSyncTransport = {
  sync: async (_payload: unknown, signal: AbortSignal) => {
    await waitForSync(signal, syncScenario.value === 'slow' ? 1200 : 220)
    if (syncScenario.value === 'error') throw new Error('Mock sync failed')
    return { cursor: `cursor-${Date.now()}`, changes: [] }
  }
}

export const syncPluginInstance = syncPlugin({ transport: playgroundSyncTransport })
