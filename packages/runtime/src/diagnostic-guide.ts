/**
 * 诊断码的**可查询说明**（`vobs explain` 的数据源）。
 *
 * ## 为什么需要它
 *
 * 这一轮里 C104–C108 的规则我都是**读源码**才知道的；AI 只看到错误信息那一句。
 * Rust 生态的 `rustc --explain E0382` 是同类设施，而它被广泛认为是
 * "对人不友好但 AI 友好"的典范 —— 因为规则**可以查，不用猜**。
 *
 * ## 为什么放在 `@vobs/runtime`
 *
 * `@vobs/compiler`（静态规则）与 `@vobs/vobs`（运行时护栏）**都依赖它**，
 * 而诊断说明要能描述两边的码。放这里，双方与 CLI 都能读到**同一份**。
 *
 * ## 覆盖范围（诚实标注）
 *
 * 目前覆盖**能从框架语义说准**的码。`vobs explain` 对没有条目的码**明确说没有**，
 * 而不是编一段像模像样的说明 —— 猜的文档比没有文档更糟（`VOBS_C102`/`C103`
 * 等构建器内部错误尚未收录）。
 *
 * 每条必须回答四个问题（少一个就退回成"只有一句报错"）：
 * **是什么** / **为什么是坑** / **正确写法** / **反例**。
 */
export interface DiagnosticGuide {
  readonly code: string
  /** 默认严重度（静态规则与运行时可能不同，这里是给人看的典型值）。 */
  readonly severity: 'error' | 'warning'
  /** 一句话：这个码在说什么。 */
  readonly title: string
  /** 为什么会发生、为什么是坑。 */
  readonly why: string
  /** 正确写法。 */
  readonly correct: string
  /** 反例（触发它的形态）。 */
  readonly wrong: string
}

export const DIAGNOSTIC_GUIDES: readonly DiagnosticGuide[] = [
  {
    code: 'VOBS_C104',
    severity: 'warning',
    title: '组件体里的条件 return 只会求值一次（run-once 冻结）',
    why: '组件体只执行一次，所以这个 return 在挂载时就固化了，之后信号变化不会再切换。'
      + '只有"返回值会被渲染"时才是问题，所以规则只认含 JSX 的形态。',
    correct: '把条件放进 JSX 子节点位置（`<div>{cond ? <A/> : <B/>}</div>`）—— 编译期生成响应式条件工厂；'
      + '只切显隐用 `<Show when={cond}>`；路由用 `<RouterView/>`。',
    wrong: '`return cond.value ? <A/> : null`'
  },
  {
    code: 'VOBS_C105',
    severity: 'warning',
    title: '模块顶层写了 JSX',
    why: '模块顶层表达式在 import 求值时执行，**早于** `createVobs()` 安装渲染器，'
      + '运行时必炸「渲染器未初始化」，而堆栈指向 import 它的地方，与真正原因隔得很远。',
    correct: '把 JSX 移进组件体；需要「数据 + 节点」的常量，改成**返回节点的函数**'
      + '（`const menu = () => [<Item/>]`）。',
    wrong: '`const MENU = <KitMenuItem />`（写在模块顶层）'
  },
  {
    code: 'VOBS_C106',
    severity: 'warning',
    title: '把 async 函数交给了 effect / 生命周期',
    why: 'async 函数在**首个 await 之前**的代码是同步执行的，那些读写在 effect 的追踪作用域内 —— '
      + '「effect 只调了个函数」不等于没依赖。而且 effect 不等返回的 Promise，清理契约也对不上。',
    correct: '只想声明依赖用 `effect(on(deps, () => { … }))`；只想跑一次副作用放 `onMount`；'
      + '异步取数用 `@vobs/resource`；确要保留就显式 `untrack(() => { void fn() })`。',
    wrong: '`effect(async () => { if (!s.value.on) return; s.value = { on: true } })`'
  },
  {
    code: 'VOBS_C107',
    severity: 'warning',
    title: '组件体的 return 读了信号（run-once 冻结）',
    why: '组件顶层 `return` 处**没有 parent/anchor**，而响应式条件渲染需要一个能换内容的位置 —— '
      + '所以 `return cond.value ? <A/> : <B/>` 即使两支都是 JSX 也**一样冻结**（实测编译产物无 insertDynamic）。',
    correct: '路由分支用 `<RouterView/>`；保留挂载只切显隐用 `<Show when={cond}>`；'
      + '普通条件渲染放进 JSX 子节点位置。',
    wrong: '`return router.currentRoute.value.path === "/login" ? <Login/> : <Shell/>`'
  },
  {
    code: 'VOBS_C108',
    severity: 'warning',
    title: 'JSX 被存进变量（节点被急切创建）',
    why: '`const node = <X/>` 在**这一行**就把组件实例化并跑了 body（`<X/>` 是 `createComponent(...)`，'
      + '不是 React 那种描述对象）。之后的条件判断发生在创建之后，组件可能带着空值渲染并崩。',
    correct: '① 写在 JSX 子节点位置；② 组件顶层 return 处**别改成三元**（会命中 C107），用 `Show`/`RouterView`；'
      + '③ 要复用就用**返回节点的函数**（延迟求值）；④ 别把节点存进数据常量（会进 SSG 序列化）；'
      + '⑤ 有内部状态要保留时，常驻挂载 + 传状态对象 + 内部判空。',
    wrong: '`const node = <Picker el={p.value} />; return open.value ? node : null`'
  },
  {
    code: 'VOBS_C118',
    severity: 'warning',
    title: '组件体里把信号读进常量',
    why: '组件体只执行一次，所以这个常量是**创建时刻的快照**，之后信号变化它永不更新 —— '
      + '界面看起来"卡住了"，但没有任何报错。',
    correct: '把读取放进 JSX（`<div>{count.value}</div>`）或回调体内；派生值用 `memo`。',
    wrong: '`const snapshot = count.value; return <div>{snapshot}</div>`'
  },
  {
    code: 'VOBS_C210',
    severity: 'warning',
    title: 'effect 写入了它自己依赖的信号（自订阅）',
    why: '依赖是**自动收集**的：effect 运行期间读到的任何信号都会变成依赖，写入会把它重新调度 → '
      + '循环。而且**被调函数在首个 await 之前的代码也是同步执行的**，所以"只调了个函数"不等于没依赖。',
    correct: '首选 `effect(on(deps, () => { … }))`（回调在 untrack 作用域里跑，结构上不会自订阅）；'
      + '次选改成派生值 / `memo`；兜底才是 `untrack(() => { x.value = next })`。'
      + '静态规则按变量名判定，可能误报（同名局部遮蔽），所以是 warning；'
      + '运行时护栏按真实依赖集判定，是 error。',
    wrong: '`effect(() => { count.value = count.value + 1 })`'
  },
  {
    code: 'VOBS_C211',
    severity: 'error',
    title: '同一个 effect 在短时间内连跑很多次',
    why: '大概率是自订阅，或两个 effect 在互相触发。它比 C210 更宽 —— 互相触发的循环不一定有单点自订阅。',
    correct: '检查这些 effect 对信号的写入：首选 `effect(on(deps, fn))`；由其它信号派生的值改用 `memo`；'
      + '兜底才是 `untrack`。注意被调函数首个 await 之前的代码也是同步的。',
    wrong: '两个 effect 各自读对方写的信号'
  },
  {
    code: 'VOBS_C232',
    severity: 'warning',
    title: 'list 写在三元 / && 的分支里',
    why: '三元里同时有节点与 list 时，list 那一支**不会编译成 `insertList`** —— 会走多态插入，'
      + '失去 keyed 复用（重排时整段重建而不是移动节点）。',
    correct: '把 list 提成**直接的**子表达式：先写条件分支，再单独写 `{items.map(...)}`。',
    wrong: '`{cond ? items.value.map(i => <li key={i}/>) : <b/>}`'
  }
]

/** 按码查说明；没有条目时返回 `undefined`（调用方必须显式处理，不要编）。 */
export function findDiagnosticGuide(code: string): DiagnosticGuide | undefined {
  return DIAGNOSTIC_GUIDES.find(item => item.code === code)
}
