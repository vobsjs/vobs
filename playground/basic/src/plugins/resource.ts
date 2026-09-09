import { resourcePlugin } from '@vobs/resource'
import { playgroundResourceClient } from '../data/users'

export const resourcePluginInstance = resourcePlugin({ client: playgroundResourceClient })
