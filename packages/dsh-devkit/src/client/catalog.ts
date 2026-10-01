/**
 * 开发台的静态内容。
 *
 * 为什么是静态的：**浏览器半侧看不到你应用的运行时** —— 开发台跑在 DSH 里，应用跑在
 * 它自己的 dev server 里，两者不是同一个进程也不是同一个页面。所以这一版把内容在
 * 构建期打进来，不做任何「假装拿到了活数据」的事。
 *
 * 内容来源都是仓库里的真实实现（签名逐个对着源码核过），不是编的。
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
    group: '响应式',
    origin: '@vobs/reactivity',
    entries: [
      {
        name: 'state',
        signature: 'state<T>(initialValue: T, debugName?: string): Signal<T>',
        summary: '创建一个可写信号。组件体只执行一次，所以读取要放在动态表达式或 effect 里，别按 React 的心智模型理解。',
        example: `const count = state(0, 'count')

// 读：放进 JSX 的动态表达式里
return <div>{count.value}</div>`
      },
      {
        name: 'effect',
        signature: 'effect(callback: EffectCallback): Effect',
        summary: '副作用。它只追踪自己在回调里读到的信号；写自己读过的信号会自订阅，必须用 untrack 包住。',
        example: `effect(() => {
  console.log(count.value)          // 建立订阅
  untrack(() => { mirrored.value = count.value })  // 写，但不建立订阅
})`
      },
      {
        name: 'untrack',
        signature: 'untrack<T>(fn: () => T): T',
        summary: '在 effect 内部执行 fn 且不建立订阅。写自己读过的信号时用它，否则会自订阅 —— 护栏会报 VOBS_C210。',
        example: `effect(() => {
  untrack(() => { count.value++ })
})`
      },
      {
        name: 'memo',
        signature: 'memo<T>(compute: () => T): Memo<T>',
        summary: '派生值。要「由 A 算出 B」就用它，不要写「读 A 写 B」的 effect —— 那是最典型的循环来源。',
        example: `const doubled = memo(() => count.value * 2)`
      },
      {
        name: 'batch',
        signature: 'batch<T>(fn: () => T): T',
        summary: '把 fn 里的多次写入合并成一次刷新。',
        example: `batch(() => {
  a.value = 1
  b.value = 2
})`
      },
      {
        name: 'createOwner',
        signature: 'createOwner(): Owner',
        summary: '建立作用域：它下面的 effect/memo 会随 dispose 一起释放。onDispose 注册清理，runWithOwner 在指定作用域里跑一段。',
        example: `const owner = createOwner()
runWithOwner(owner, () => {
  effect(() => { /* 随 owner 释放 */ })
})`
      },
      {
        name: 'createId',
        signature: "createId(prefix = 'vobs'): string",
        summary: '生成稳定 id（用于 label/for、aria 关联等）。',
        example: `const id = createId('field')`
      }
    ]
  },
  {
    group: 'DSH 插件',
    origin: '@vobs/dsh',
    entries: [
      {
        name: 'defineDshPanel',
        signature: 'defineDshPanel(options: DshPanelOptions, render: () => VobsNode): DshClientPlugin',
        summary: '一次注册两处：main（keyed）整页面板 + 左侧栏入口。开发台与 Console 都是用它写的。',
        example: `export default defineDshPanel({
  key: 'my-panel',
  label: 'My Panel',
  sidebarEntry: { label: 'My Panel', order: 9, renderIcon: () => <Icon /> }
}, () => <MyPanel />)`
      },
      {
        name: 'defineDshOverlay',
        signature: 'defineDshOverlay(options: DshOverlayOptions, render: () => VobsNode): DshClientPlugin',
        summary: '注册一个浮层面板（shell.overlay），不占主区域。',
        example: `export default defineDshOverlay({ id: 'my-overlay', order: 120 }, () => <Panel />)`
      },
      {
        name: 'defineDshPlugin',
        signature: 'defineDshPlugin(spec: DshPluginSpec): DshClientPlugin',
        summary: '底层入口：自己决定注入哪些 slot、怎么挂载。前两个是它的语法糖。',
        example: `export default defineDshPlugin({
  name: 'my-plugin',
  apply(ctx) { /* ctx.slots.inject(...) */ }
})`
      },
      {
        name: 'createVobsSlotHost',
        signature: 'createVobsSlotHost(render: () => VobsNode, options?: DshSurfaceOptions): DshSlotHostComponent',
        summary: '把 vobs 渲染函数包成 DSH 需要的宿主组件：React 占位 + shadow root + 配色跟随 + 生命周期清理。',
        example: `const Host = createVobsSlotHost(() => <Panel />, { styles: CSS })`
      }
    ]
  },
  {
    group: '编译器',
    origin: '@vobs/compiler',
    entries: [
      {
        name: 'compile',
        signature: 'compile(code: string, options?: CompileOptions): string',
        summary: '把 TSX 编译成细粒度 DOM 绑定。诊断带稳定错误码（VOBS_C1xx/C2xx）与 codeFrame。',
        example: `const output = compile('<div>{count.value}</div>', { filename: 'a.tsx' })`
      },
      {
        name: 'compileWithSourceMap',
        signature: 'compileWithSourceMap(code, options?): CompileResult',
        summary: '同上，额外返回 sourcemap 与 diagnostics（Vite 插件走的是这条）。',
        example: `const { code, map, diagnostics } = compileWithSourceMap(src, { filename })`
      },
      {
        name: 'createCompiler',
        signature: 'createCompiler(options?: CompilerOptions): VobsCompiler',
        summary: '复用同一个编译器实例（多次编译时避免重复初始化）。',
        example: `const compiler = createCompiler({ plugins: [] })`
      }
    ]
  },
  {
    group: '开发期护栏',
    origin: '@vobs/vobs/dev',
    entries: [
      {
        name: 'installDevGuardrails',
        signature: 'installDevGuardrails(options?: DevGuardrailOptions): () => void',
        summary: '装上护栏，返回卸载函数。用 vobsPlugin() 的应用在 dev 下会自动装，一般不需要手动调用。',
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

/** 可直接复制的写法示例。刻意是「写法」而不是仓库文件索引 —— 后者会随目录变动失真。 */
export const PATTERNS: readonly PatternEntry[] = [
  {
    title: '计数器',
    summary: 'state + 动态表达式。组件体只跑一次，读取放在 JSX 里。',
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
    title: 'keyed 列表',
    summary: '列表要写成**直接的**子表达式；写进三元分支会失去 keyed 复用。',
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
    title: '派生值（正确做法）',
    summary: '由 A 算出 B 用 memo，不要写「读 A 写 B」的 effect。',
    code: `const count = state(0)
const doubled = memo(() => count.value * 2)

// ❌ 不要这样：effect 读 count 又写 doubled，两个信号互相驱动
// effect(() => { doubled.value = count.value * 2 })`
  },
  {
    title: 'effect 写自己读的信号',
    summary: '必须用 untrack 包住写入，否则会自订阅（护栏报 VOBS_C210）。',
    code: `effect(() => {
  const current = count.value
  untrack(() => { count.value = current + 1 })
})`
  },
  {
    title: '作用域与清理',
    summary: 'createOwner 建作用域，onDispose 注册清理，owner 释放时一起收掉。',
    code: `const owner = createOwner()

runWithOwner(owner, () => {
  const timer = setInterval(tick, 1000)
  onDispose(() => clearInterval(timer))
})

owner.dispose()   // timer 被清掉`
  },
  {
    title: '写一个 DSH 面板',
    summary: 'defineDshPanel 一次注册 main + 侧栏入口；用 @vobs/dsh/vite 的 dshBundle() 打包。',
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
    name: 'effect 写入了自己依赖的信号',
    before: `effect(() => {
  count.value++          // 读 + 写同一个信号
})`,
    after: `effect(() => {
  untrack(() => { count.value++ })
})`,
    why: '以前这是静默的：effect 重跑 → 又写一次 → 再重跑，实测连续重跑上百轮才被别的地方掩盖住。'
      + '现在第一次自写就报，并指名是哪个信号、effect 在哪创建的。'
  },
  {
    code: 'VOBS_C211',
    name: '同一个 effect 在极短时间内连跑超限',
    before: `effect(() => { const v = a.value; if (v < 9) b.value = v + 1 })
effect(() => { const v = b.value; if (v < 9) a.value = v + 1 })`,
    after: `// 用 memo 表达派生关系，而不是让两个 effect 互相触发
const next = memo(() => a.value + 1)`,
    why: '抓依赖检测覆盖不到的情形：两个 effect 各写对方的依赖，谁都不是「写自己」。'
      + '真正的循环一定在极短时间内连跑很多次，所以用时间窗而不是刷新边界来判定。'
  }
]

export interface Capability {
  readonly name: string
  readonly status: 'done' | 'partial' | 'todo'
  readonly note: string
}

/** 这一页刻意如实列出「哪些做了、哪些没做」—— 面板不该假装自己什么都有。 */
export const CAPABILITIES: readonly Capability[] = [
  { name: '开发期护栏', status: 'done', note: '@vobs/vobs/dev · dev 下自动装 + 终端上报（VOBS_C210 / C211）' },
  { name: 'API 索引', status: 'partial', note: '本面板这一页是静态雏形；独立的 vobs docs 查询命令未做' },
  { name: '写法示例', status: 'partial', note: '本面板「示例」页是可直接复制的写法；独立的可运行示例库未做' },
  { name: 'vobs check 静态检查', status: 'todo', note: '不跑应用就能给出 文件:行 的问题清单 —— 未做' },
  { name: 'AI 上下文包', status: 'todo', note: '坑位清单 + 核心范式，供 AI 加载 —— 未做' },
  { name: '脚手架预置测试', status: 'todo', note: '新项目自带无头渲染断言，让 AI 能自证 —— 未做' },
  { name: 'DSH skill 封装', status: 'todo', note: '把 AI 上下文包成 skill，任务匹配时自动加载 —— 未做' }
]
