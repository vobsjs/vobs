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
      + '失去 keyed 复用（重排时整段重建而不是移动节点）。'
      + '还有一个更容易被忽略的代价：**分支条件本身变化也会重建整个列表** —— '
      + '因为编译产物是 `insertDynamicValue(el, null, () => cond.value ? items.map(…) : null)`，'
      + '那个 getter 读了 `cond`。而直接子表达式编译成 `insertList(el, null, () => items, renderItem)`，'
      + '只订阅列表源。'
      + '影响大小看**条目数与是否有状态**：几项无状态按钮可忽略；几十项、或条目内有焦点/输入/滚动状态时必须改。',
    correct: '把 list 提成**直接的**子表达式：先写条件分支，再单独写 `{items.map(...)}`。',
    wrong: '`{cond ? items.value.map(i => <li key={i}/>) : <b/>}`'
  },

  /* ---------- 构建器 / 配置层（补齐 --missing 指出的缺口） ---------- */
  {
    code: 'VOBS_C002',
    severity: 'error',
    title: '边界组件缺少必需属性',
    why: '`ResourceBoundary` / `ErrorBoundary` / `AsyncBoundary` 靠各自那个属性工作：'
      + '`resource` 决定订阅哪个资源、`fallback` 决定出错时渲染什么、`promise` 决定等哪个 Promise。'
      + '缺了它，编译期不知道该挂什么，运行期也建立不起边界 —— '
      + '而症状是"边界**没生效**"（错误照样冒到上层、资源不订阅），不是一条清楚的报错。',
    correct: '`<ResourceBoundary resource={userResource}>…</ResourceBoundary>`；'
      + '`<ErrorBoundary fallback={(e) => <Err error={e}/>}>…</ErrorBoundary>`；'
      + '`<AsyncBoundary promise={pending}>…</AsyncBoundary>`。',
    wrong: '`<ErrorBoundary>…</ErrorBoundary>`（漏了 `fallback`）'
  },
  {
    code: 'VOBS_C007',
    severity: 'error',
    title: '编译器插件缺少 name 或重名',
    why: '插件按 `name` 去重与排序，而**顺序决定谁先改 AST**。'
      + '没有 name、或两个插件同名时，`transformPluginNodes` 的产出顺序不确定 —— '
      + '于是"同一份源码两次编译结果不同"，这类构建不确定性比崩溃更难查。'
      + '所以这里**直接抛错**（`VobsError`）而不是给警告。',
    correct: '每个插件都给唯一且稳定的 `name`：`{ name: "vobs-plugin-i18n", transform(...) {…} }`。',
    wrong: '两个插件都写 `{ name: "i18n" }`，或干脆不写 `name`'
  },
  {
    code: 'VOBS_C101',
    severity: 'error',
    title: '不支持的 JSX 标签形态',
    why: 'React 接受 `<svg:rect>`（JSX 命名空间标签）与 `<Foo.Bar>`（成员表达式）。'
      + 'vobs 不做这两种解析：它们没有清晰的"组件还是 DOM 元素"归属，'
      + '而 vobs 正是靠**大小写**来区分二者的 —— 猜错会导致整棵子树走错编译路径。',
    correct: '组件用大写标识符 `<MyComponent/>`；DOM 元素用小写标签名 `<rect/>`；'
      + 'Fragment 用 `<Fragment>` 或 `<>…</>`。',
    wrong: '`<svg:rect/>`、`<Svg.Rect/>`'
  },
  {
    code: 'VOBS_C102',
    severity: 'warning',
    title: 'on* 属性绑到了不存在 / 不规范的事件名',
    why: '三种情形**分开定级**：'
      + '① `onFoo` 解析出的事件既不符合 `on` + 大写的约定、也不是已知 DOM 事件'
      + '→ **回调永远不会触发，而且毫无声音**（error）；'
      + '② 小写 `onclick` 只是"碰巧对得上"，换个名字就会静默失效（warning）；'
      + '③ `onFoo` 是未知事件 —— 可能是自定义事件（可忽略），也可能是拼错（warning）。'
      + '**只在"不可能是对"时报 error**：这条的目的不是拦人，'
      + '而是把"绑到不存在的事件上、回调永不触发且没有任何提示"这件事说出来。',
    correct: '事件处理器写成 `on` + 大写字母开头：`onClick` / `onDoubleClick` / `onPointerDown`。'
      + '本来不是事件处理器的属性换个别名；确需手动挂监听就在 effect 里 `addEventListener`。',
    wrong: '`onclick={…}`（小写）、`onClik={…}`（拼错）、`onFooBar={…}`（非标准事件）'
  },
  {
    code: 'VOBS_C103',
    severity: 'warning',
    title: 'map 回调体不满足「单个 JSX 表达式」或「恰好一个 return」',
    why: '编译器靠这个形态把列表编译成 **keyed 复用**（`insertList`：按 key 调和、移动已有节点）。'
      + '回调体一旦有多个语句、或返回的是 Fragment，它就认不出来 → 退化成**多态插入**：'
      + '每轮**重建每一项**，`key` 与 keyed 复用全部失效（重排时节点身份丢失、项内状态被重置）。',
    correct: '把计算提到 `map` 之外（或先用 `memo` 派生好），让回调体保持"单个 JSX 表达式"；'
      + '列表项用**一个元素**而不要用 Fragment 包。',
    wrong: '`{items.map(i => { const t = f(i); return <li key={i}>{t}</li> })}`　'
      + '`{items.map(i => <><li key={i}/></>)}`'
  }
]

/** 按码查说明；没有条目时返回 `undefined`（调用方必须显式处理，不要编）。 */
export function findDiagnosticGuide(code: string): DiagnosticGuide | undefined {
  return DIAGNOSTIC_GUIDES.find(item => item.code === code)
}
