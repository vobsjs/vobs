# vobs

Signals First · Zero Re-renders · Ultra Lightweight

> 发布于 npm 的 `@vobs/*` 作用域 —— 37 个包，统一版本号。
>
> **AI 读者**：本 README 是入口，不是完整契约。在你的项目里运行
> `vobs agent-doc` 生成 AGENTS.md（与框架版本强一致），加 `--llms <dir>`
> 可同时产出 llms.txt / vobs-context.md / diagnostics.md 知识分发文件。
> 写代码前先读下面的 **Forbidden** 一节 —— 那些反模式会被编译诊断拦截。

## Core model

- **Signals** —— 细粒度响应式（`state` / `memo` / `effect`）：push 失效 + pull 求值，脏检查去重，微任务批量刷新带环检测。
- **Compiler** —— JSX 在构建期编译成定向 DOM 绑定（`bindText` / `bindAttribute` / `bindProperty`），控制流编译成 `insertDynamic`，列表编译成 `insertList`（keyed / indexed 调和）。每个属性是独立 effect，改一个 prop 不碰别的。
- **Run-once components** —— 组件函数体只执行一次，没有 re-render。动态部分是信号与 effect；`Owner` 树追踪每个组件实例，离开树时自动释放信号、effect 与监听。

## Quick start

```bash
npm install @vobs/vobs @vobs/vite-plugin
```

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import { vobsPlugin } from '@vobs/vite-plugin'

export default defineConfig({
  plugins: [vobsPlugin()]
})
```

```tsx
// counter.tsx
import { state } from '@vobs/vobs'

export function Counter() {
  const count = state(0)
  return <button onClick={() => count.value++}>Count: {count.value}</button>
}
```

```ts
// main.ts
import { createVobs } from '@vobs/vobs'
import { Counter } from './counter'

const app = createVobs({ render: () => <Counter /> })
app.mount(document.getElementById('app')!)
```

编译产物是一段直线式 DOM 操作；更新由信号驱动的 effect 完成，粒度到单个 DOM 绑定。

与 React 的关键差异：组件体只执行一次。`{count.value}` 不是"求值一次的文本"，
而是编译器生成的独立文本绑定 —— 点击时只有这个文本节点更新，`Counter` 函数不会重跑。
由此带来的全部约束见下一节。

## Forbidden — 会被诊断拦截的反模式

React 习惯直接迁移到 vobs 的典型错误。每一条都有对应的编译期诊断码（`vobs explain <code>` 查详情与改法）：

| 不要写 | 为什么 | 写成 | 码 |
| --- | --- | --- | --- |
| 组件体顶层 `return cond.value ? <A/> : <B/>` | 挂载时固化，之后永不切换 | 三元放进 JSX 子节点位置；保留挂载切显隐用 `<Show when={…}>`；路由分支用 `<RouterView/>` | C104 / C107 |
| 组件体里 `const v = sig.value` 再给 JSX / 回调用 | 创建时刻的快照，信号变化它永不更新 | JSX 里直接 `sig.value`；回调触发时重读；动态 props 用 getter 形态 | C118 |
| `const node = <Comp/>` 存变量备用 | `<Comp/>` 是立即执行的调用，不是 React 那种描述对象 | 节点直接写进 JSX 位置 | C108 |
| `effect(() => { sig.value++ })` | 读 + 写同一信号 = 自订阅循环 | 依赖声明用 `effect(on([deps], fn))`；派生值用 `memo` | C210 |
| `effect(() => { void load() })` 调 async 函数 | 首个 `await` 之前的代码同步执行，读的信号算进 effect 的依赖 | 异步取数用 `@vobs/resource` | C106 |
| `list.value.push(x)` / `sort()` / `splice()` | 引用不变，信号不通知，界面停在旧数据 | `list.value = [...list.value, x]` | C233 |
| `{cond.value ? items.map(…) : null}` | list 藏进三元分支，失去 keyed 复用 | `map` 作直接子表达式，条件挪进项内 | C232 |

以上全部可被 **`pnpm check:source`**（= `vobs check`：静态分析 + 编译器诊断，全仓一次列全）提前发现；
dev 模式下运行时护栏（`@vobs/vobs/dev`）还会在浏览器控制台再拦一层 —— C210/C211 按**真实依赖集**判定，比静态分析更精确。

## Packages

核心包逐个说明，其余按用途分组（每个包的细节见 `packages/` 下的各自 README）：

| 包 | 作用 |
| --- | --- |
| [`@vobs/vobs`](packages/vobs) | 总入口：re-export reactivity + runtime + DOM renderer，`createVobs`、context、JSX runtime |
| [`@vobs/reactivity`](packages/reactivity) | Signals、effect、memo、调度器、Owner 树 |
| [`@vobs/runtime`](packages/runtime) | 渲染器无关的 DOM 操作、动态插入、列表、边界、HMR |
| [`@vobs/compiler`](packages/compiler) | TS/JSX 编译器：语句级 source map + 结构化诊断（C104–C234） |
| [`@vobs/vite-plugin`](packages/vite-plugin) | Vite 集成：TSX 转换、HTML 组件、HMR、dev 护栏与 Agent 快照通道 |
| [`@vobs/dom`](packages/dom) / [`@vobs/ssr`](packages/ssr) | DOM 渲染器适配；字符串渲染、水合、状态序列化 |

- **应用能力**：[`@vobs/router`](packages/router)（守卫 / loader / 懒加载 / 数据请求追踪）、[`@vobs/resource`](packages/resource)（异步资源缓存与修订安全变更）、[`@vobs/http`](packages/http)、[`@vobs/auth`](packages/auth) / [`@vobs/jwt-auth`](packages/jwt-auth)、[`@vobs/storage`](packages/storage)、[`@vobs/sync`](packages/sync) / [`@vobs/queue`](packages/queue)、[`@vobs/forms`](packages/forms)、[`@vobs/i18n`](packages/i18n) / [`@vobs/dict`](packages/dict)、[`@vobs/preferences`](packages/preferences)、[`@vobs/payment`](packages/payment)、[`@vobs/upload`](packages/upload)、[`@vobs/captcha`](packages/captcha)、[`@vobs/notification`](packages/notification)、[`@vobs/logger`](packages/logger)
- **UI 与主题**：[`@vobs/ui`](packages/ui)（dialog / drawer / popover / focus trap）、[`@vobs/layout`](packages/layout)、[`@vobs/kit`](packages/kit)（ui + layout + table + auth + i18n + theme 的高层组合）、[`@vobs/table`](packages/table)、[`@vobs/transition`](packages/transition)、[`@vobs/icon-core`](packages/icon-core)、[`@vobs/theme`](packages/theme)、[`@vobs/tailwind`](packages/tailwind)
- **工具**：[`@vobs/cli`](packages/cli)（`vobs check` / `agent-doc` / `explain` / `mcp` / DSH 命令组）、[`@vobs/devtools`](packages/devtools) / [`@vobs/devtools-ui`](packages/devtools-ui)（调试内核与面板：owner / signal / effect / 网络追踪）、[`@vobs/test-utils`](packages/test-utils)

## DSH 插件

vobs 可用于编写 DeepSeek Harness 客户端插件（一套工具链 + 三个插件包，不发布 npm、走 Git 子目录分发）。
安装、构建、校验与已知坑见 **[docs/dsh.md](docs/dsh.md)**。

## Development

```bash
pnpm install
pnpm test        # vitest in watch mode
pnpm test:run    # single pass
pnpm typecheck   # tsc --noEmit
pnpm check:source # = vobs check：静态分析 + 编译器诊断（effect 自订阅 / 列表写进分支 / 组件体里读信号）
pnpm check:runtime # 真实 Chrome 逐路由跑运行时护栏（需 Chrome）
pnpm dev         # playground
pnpm build       # package artifacts + typecheck + playground production build
pnpm verify:packages # all publishable tarball ESM/CJS/types/source smoke checks
```

- Node 24+（`engines` 强制 ≥ 24.22.1），pnpm workspace
- `packages/*` — framework packages; all 37 public packages publish `dist` ESM/CJS/types and retain `src` through an explicit `/source` entry
- `playground/*` — integration examples covering router, devtools, i18n, theme, and more
