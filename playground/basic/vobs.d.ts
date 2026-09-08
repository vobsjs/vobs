declare module '*.vobs' {
    export function App(): unknown
  }

declare module '*.html' {
  import type { VobsNode } from '@vobs/vobs'
  const component: (props?: Record<string, unknown>) => VobsNode
  export default component
}

declare module '*.htm' {
  import type { VobsNode } from '@vobs/vobs'
  const component: (props?: Record<string, unknown>) => VobsNode
  export default component
}
