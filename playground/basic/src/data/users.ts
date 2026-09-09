import { createResourceClient } from '@vobs/resource'
import { createLocalColumnSettingsPersistence } from '@vobs/table'
import { state } from '@vobs/vobs'

export interface PlaygroundUser {
  readonly id: number
  readonly name: string
  readonly role: string
  readonly status: 'Active' | 'Invited'
}

export const usersSearch = state('')
export const usersStatus = state<'' | PlaygroundUser['status']>('')
export const resourceScenario = state<'ready' | 'error' | 'empty' | 'slow'>('ready')
export const serverPage = state(1)
export const serverPageSize = state(2)
export const playgroundResourceClient = createResourceClient()
export const usersColumnSettingsPersistence = createLocalColumnSettingsPersistence('vobs:playground:users.columns')

const USERS: readonly PlaygroundUser[] = [
  { id: 1, name: 'Ada Lovelace', role: 'Maintainer', status: 'Active' },
  { id: 2, name: 'Lin Chen', role: 'Contributor', status: 'Active' },
  { id: 3, name: 'Grace Hopper', role: 'Reviewer', status: 'Invited' },
  { id: 4, name: 'Margaret Hamilton', role: 'Maintainer', status: 'Active' },
  { id: 5, name: 'Alan Turing', role: 'Contributor', status: 'Active' }
]

export const playgroundUsers = USERS

export function findUserById(id: string | readonly string[] | undefined): PlaygroundUser | null {
  const numericId = Number(id)
  if (!Number.isInteger(numericId)) return null
  return USERS.find(user => user.id === numericId) ?? null
}

export const usersResource = playgroundResourceClient.resource<readonly PlaygroundUser[]>({
  key: () => ['playground', 'users', usersSearch.value, usersStatus.value],
  staleTime: 30_000,
  fetcher: async signal => {
    await waitForResource(signal, 240)
    const query = usersSearch.value.trim().toLocaleLowerCase()
    const status = usersStatus.value
    return USERS.filter(user => {
      if (status && user.status !== status) return false
      if (!query) return true
      return `${user.name} ${user.role} ${user.status}`
        .toLocaleLowerCase().includes(query)
    })
  }
})

export const scenarioResource = playgroundResourceClient.resource<readonly PlaygroundUser[]>({
  key: () => ['playground', 'scenario', resourceScenario.value],
  fetcher: async signal => {
    await waitForResource(signal, resourceScenario.value === 'slow' ? 1200 : 180)
    if (resourceScenario.value === 'error') throw new Error('Demo request failed')
    return resourceScenario.value === 'empty' ? [] : USERS.slice(0, 2)
  }
})

export const serverUsersResource = playgroundResourceClient.resource({
  key: () => ['playground', 'users-server', serverPage.value, serverPageSize.value],
  fetcher: async signal => {
    await waitForResource(signal, 160)
    const start = (serverPage.value - 1) * serverPageSize.value
    return { rows: USERS.slice(start, start + serverPageSize.value), total: USERS.length }
  }
})

function waitForResource(signal: AbortSignal, delay: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, delay)
    const abort = (): void => {
      clearTimeout(timer)
      reject(Object.assign(new Error('Request cancelled'), { name: 'AbortError' }))
    }
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
  })
}
