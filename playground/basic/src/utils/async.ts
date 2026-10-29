import type { Signal } from '@vobs/vobs'

export type Scenario = 'success' | 'error' | 'slow'

/** Interruptible mock delay: rejects with AbortError when the AbortSignal fires. */
export function waitFor(signal: AbortSignal, delay: number, message = 'Request cancelled'): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, delay)
    const abort = (): void => {
      clearTimeout(timer)
      reject(abortError(message))
    }
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
  })
}

export function abortError(message: string): Error {
  return Object.assign(new Error(message), { name: 'AbortError' })
}

export function isAbortError(value: unknown): boolean {
  return Boolean(value) && typeof value === 'object' && (value as { name?: unknown }).name === 'AbortError'
}

export type { Signal }
