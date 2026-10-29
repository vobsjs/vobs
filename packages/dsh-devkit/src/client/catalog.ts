/**
 * The devkit's static content.
 *
 * Why static: **the browser side cannot see your app's runtime** — the devkit runs inside DSH
 * while the app runs in its own dev server; they are neither the same process nor the same page.
 * So this version bakes the content in at build time and never pretends to have live data.
 *
 * All content comes from real implementations in the repo (each signature verified against
 * source), nothing invented.
 */

export interface ApiEntry {
  readonly name: string
  readonly signature: string
  readonly summary: string
  readonly example: string
}

export interface ApiGroup {
  readonly group: string
  readonly origin: string
  readonly entries: readonly ApiEntry[]
}

export const API_GROUPS: readonly ApiGroup[] = [
  {
    group: 'Reactivity',
    origin: '@vobs/reactivity',
    entries: [
      {
        name: 'state',
        signature: 'state<T>(initialValue: T, debugName?: string): Signal<T>',
        summary: 'Creates a writable signal. The component body executes once, so reads must live in dynamic expressions or effects — do not reason about it like React.',
        example: `const count = state(0, 'count')

// Read: put it in a JSX dynamic expression
return <div>{count.value}</div>`
      },
      {
        name: 'effect',
        signature: 'effect(callback: EffectCallback): Effect',
        summary: 'Side effect. It only tracks the signals it reads inside its callback; writing a signal it reads would self-subscribe — wrap it in untrack.',
        example: `effect(() => {
  console.log(count.value)          // creates a subscription
  untrack(() => { mirrored.value = count.value })  // a write, but no subscription
})`
      },
      {
        name: 'untrack',
        signature: 'untrack<T>(fn: () => T): T',
        summary: 'Runs fn inside an effect without creating a subscription. Use it when writing a signal the effect reads, otherwise it self-subscribes — the guardrail reports VOBS_C210.',
        example: `effect(() => {
  untrack(() => { count.value++ })
})`
      },
      {
        name: 'memo',
        signature: 'memo<T>(compute: () => T): Memo<T>',
        summary: 'Derived value. When you need "B computed from A", use this — never an effect that "reads A and writes B", the most typical source of loops.',
        example: `const doubled = memo(() => count.value * 2)`
      },
      {
        name: 'batch',
        signature: 'batch<T>(fn: () => T): T',
        summary: 'Coalesces multiple writes inside fn into a single flush.',
        example: `batch(() => {
  a.value = 1
  b.value = 2
})`
      },
      {
        name: 'createOwner',
        signature: 'createOwner(): Owner',
        summary: 'Creates a scope: effects/memos under it are released together on dispose. onDispose registers cleanup; runWithOwner runs a piece of code inside a given scope.',
        example: `const owner = createOwner()
runWithOwner(owner, () => {
  effect(() => { /* released with the owner */ })
})`
      },
      {
        name: 'createId',
        signature: "createId(prefix = 'vobs'): string",
        summary: 'Generates stable ids (for label/for, aria associations, etc.).',
        example: `const id = createId('field')`
      }
    ]
  },
  {
    group: 'DSH plugins',
    origin: '@vobs/dsh',
    entries: [
      {
        name: 'defineDshPanel',
        signature: 'defineDshPanel(options: DshPanelOptions, render: () => VobsNode): DshClientPlugin',
        summary: 'Registers both places at once: a main (keyed) full-page panel + a sidebar entry. Both the devkit and the Console are written with it.',
        example: `export default defineDshPanel({
  key: 'my-panel',
  label: 'My Panel',
  sidebarEntry: { label: 'My Panel', order: 9, renderIcon: () => <Icon /> }
}, () => <MyPanel />)`
      },
      {
        name: 'defineDshOverlay',
        signature: 'defineDshOverlay(options: DshOverlayOptions, render: () => VobsNode): DshClientPlugin',
        summary: 'Registers an overlay panel (shell.overlay) that does not occupy the main area.',
        example: `export default defineDshOverlay({ id: 'my-overlay', order: 120 }, () => <Panel />)`
      },
      {
        name: 'defineDshPlugin',
        signature: 'defineDshPlugin(spec: DshPluginSpec): DshClientPlugin',
        summary: 'The low-level entry: you decide which slots to inject and how to mount. The previous two are sugar over it.',
        example: `export default defineDshPlugin({
  name: 'my-plugin',
  apply(ctx) { /* ctx.slots.inject(...) */ }
})`
      },
      {
        name: 'createVobsSlotHost',
        signature: 'createVobsSlotHost(render: () => VobsNode, options?: DshSurfaceOptions): DshSlotHostComponent',
        summary: 'Wraps a vobs render function into the host component DSH needs: React placeholder + shadow root + scheme following + lifecycle cleanup.',
        example: `const Host = createVobsSlotHost(() => <Panel />, { styles: CSS })`
      }
    ]
  },
  {
    group: 'Compiler',
    origin: '@vobs/compiler',
    entries: [
      {
        name: 'compile',
        signature: 'compile(code: string, options?: CompileOptions): string',
        summary: 'Compiles TSX into fine-grained DOM bindings. Diagnostics carry stable error codes (VOBS_C1xx/C2xx) and a codeFrame.',
        example: `const output = compile('<div>{count.value}</div>', { filename: 'a.tsx' })`
      },
      {
        name: 'compileWithSourceMap',
        signature: 'compileWithSourceMap(code, options?): CompileResult',
        summary: 'Same as above, but also returns a sourcemap and diagnostics (the Vite plugin uses this one).',
        example: `const { code, map, diagnostics } = compileWithSourceMap(src, { filename })`
      },
      {
        name: 'createCompiler',
        signature: 'createCompiler(options?: CompilerOptions): VobsCompiler',
        summary: 'Reuses one compiler instance (avoids re-initializing on repeated compilations).',
        example: `const compiler = createCompiler({ plugins: [] })`
      }
    ]
  },
  {
    group: 'Dev guardrails',
    origin: '@vobs/vobs/dev',
    entries: [
      {
        name: 'installDevGuardrails',
        signature: 'installDevGuardrails(options?: DevGuardrailOptions): () => void',
        summary: 'Installs the guardrails and returns an uninstall function. Apps built with vobsPlugin() install it automatically in dev; manual calls are rarely needed.',
        example: `import { installDevGuardrails } from '@vobs/vobs/dev'

const stop = installDevGuardrails({
  onViolation: v => console.log(v.error.code, v.error.fix)
})
stop()`
      }
    ]
  }
]

export interface PatternEntry {
  readonly title: string
  readonly summary: string
  readonly code: string
}

/** Copy-ready pattern examples. Deliberately "patterns" rather than a repo file index — the latter drifts as the directory changes. */
export const PATTERNS: readonly PatternEntry[] = [
  {
    title: 'Counter',
    summary: 'state + dynamic expression. The component body runs once; reads live in the JSX.',
    code: `import { state } from '@vobs/vobs'

const count = state(0, 'count')

export function Counter() {
  return (
    <button onClick={() => count.value++}>
      count = {count.value}
    </button>
  )
}`
  },
  {
    title: 'keyed lists',
    summary: 'Lists must be written as **direct** child expressions; putting them inside a ternary branch loses keyed reuse.',
    code: `export function List(props: { items: Signal<string[]> }) {
  return (
    <ul>
      {props.items.value.map(item => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  )
}`
  },
  {
    title: 'Derived values (the correct way)',
    summary: 'Use memo for "B computed from A"; never write an effect that "reads A and writes B".',
    code: `const count = state(0)
const doubled = memo(() => count.value * 2)

// ❌ Never do this: the effect reads count and writes doubled, the two signals drive each other
// effect(() => { doubled.value = count.value * 2 })`
  },
  {
    title: 'An effect writing the signal it reads',
    summary: 'The write must be wrapped in untrack, otherwise it self-subscribes (the guardrail reports VOBS_C210).',
    code: `effect(() => {
  const current = count.value
  untrack(() => { count.value = current + 1 })
})`
  },
  {
    title: 'Scopes and cleanup',
    summary: 'createOwner builds a scope, onDispose registers cleanup, and disposing the owner tears it all down.',
    code: `const owner = createOwner()

runWithOwner(owner, () => {
  const timer = setInterval(tick, 1000)
  onDispose(() => clearInterval(timer))
})

owner.dispose()   // the timer is cleared`
  },
  {
    title: 'Writing a DSH panel',
    summary: 'defineDshPanel registers main + a sidebar entry in one go; bundle with dshBundle() from @vobs/dsh/vite.',
    code: `import { defineDshPanel } from '@vobs/dsh'
import { state } from '@vobs/vobs'

const tab = state('a')

export default defineDshPanel({
  key: 'my-panel',
  label: 'My Panel',
  sidebarEntry: { label: 'My Panel', order: 9, renderIcon: () => <Icon /> },
  setup: () => undefined
}, () => <div>{tab.value === 'a' ? <A /> : <B />}</div>)`
  }
]

export interface GuardrailRule {
  readonly code: string
  readonly name: string
  readonly before: string
  readonly after: string
  readonly why: string
}

export const GUARDRAIL_RULES: readonly GuardrailRule[] = [
  {
    code: 'VOBS_C210',
    name: 'an effect wrote the signal it depends on',
    before: `effect(() => {
  count.value++          // reads + writes the same signal
})`,
    after: `effect(() => {
  untrack(() => { count.value++ })
})`,
    why: 'This used to be silent: the effect re-runs → writes again → re-runs again; in practice it re-ran hundreds of rounds in a row before something else masked it. '
      + 'Now the very first self-write is reported, naming the signal and where the effect was created.'
  },
  {
    code: 'VOBS_C211',
    name: 'the same effect ran more times than the limit within a very short window',
    before: `effect(() => { const v = a.value; if (v < 9) b.value = v + 1 })
effect(() => { const v = b.value; if (v < 9) a.value = v + 1 })`,
    after: `// Express the derivation with memo instead of two effects triggering each other
const next = memo(() => a.value + 1)`,
    why: 'Catches what dependency detection cannot: two effects each writing the other\'s dependency, so neither is "writing itself". '
      + 'A real loop always runs many times within a very short window, hence the judgment by time window rather than flush boundary.'
  }
]

export interface Capability {
  readonly name: string
  readonly status: 'done' | 'partial' | 'todo'
  readonly note: string
}

/** This page deliberately lists "what is done and what is not" — the panel must not pretend to have everything. */
export const CAPABILITIES: readonly Capability[] = [
  { name: 'Dev-time guardrails', status: 'done', note: '@vobs/vobs/dev · installs automatically in dev + reports to the terminal (VOBS_C210 / C211)' },
  { name: 'API index', status: 'partial', note: 'this panel page is a static draft; a standalone vobs docs query command is not done yet' },
  { name: 'Code patterns', status: 'partial', note: 'this panel\'s "Patterns" page holds copy-ready snippets; a standalone runnable example library is not done yet' },
  { name: 'vobs check static analysis', status: 'todo', note: 'produce a file:line issue list without running the app — not done yet' },
  { name: 'AI context pack', status: 'todo', note: 'pitfall list + core paradigms for AI to load — not done yet' },
  { name: 'Scaffold preset tests', status: 'todo', note: 'new projects ship headless render assertions so the AI can prove itself — not done yet' },
  { name: 'DSH skill packaging', status: 'todo', note: 'package the AI context as a skill, auto-loaded on task match — not done yet' }
]
