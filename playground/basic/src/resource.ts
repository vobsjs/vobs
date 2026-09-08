import { resourcePlugin } from '@vobs/resource'
import {
  playgroundResourceClient,
  resourceScenario,
  scenarioResource,
  serverPage,
  serverPageSize,
  serverUsersResource,
  usersColumnSettingsPersistence,
  usersResource,
  usersSearch,
  usersStatus,
  type PlaygroundUser
} from './data/users'

export {
  playgroundResourceClient,
  resourceScenario,
  scenarioResource,
  serverPage,
  serverPageSize,
  serverUsersResource,
  usersColumnSettingsPersistence,
  usersResource,
  usersSearch,
  usersStatus
}
export type { PlaygroundUser }

export const resourcePluginInstance = resourcePlugin({ client: playgroundResourceClient })
