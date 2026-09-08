import { devtoolsPlugin } from '@vobs/devtools'

// Vite replaces `import.meta.env.DEV` at build time so production bundles do
// not create the runtime collector unless an application explicitly opts in.
export const devtoolsPluginInstance = devtoolsPlugin({ expose: true, enabled: import.meta.env.DEV })
