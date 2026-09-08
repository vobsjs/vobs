import { definePreferences, preferencesPlugin } from '@vobs/preferences'

export const preferences = definePreferences({
  density: { type: 'string', default: 'comfortable' },
  showTips: { type: 'boolean', default: true },
  workspace: { type: 'string', default: 'Playground' }
})

export const preferencesPluginInstance = preferencesPlugin({
  preferences,
  storage: 'local',
  prefix: 'playground:preferences:'
})
