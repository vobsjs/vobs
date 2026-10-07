# vobs 框架契约（写代码前必读）

vobs 是**编译型 / 细粒度 / 响应式**框架，与 React 的心智模型有几处**根本不同**。
下面的每一条都来自真实事故，**违反时通常编译通过、运行期才错**。

> 本文档由 `vobs agent-doc` 从框架版本生成 —— 不要手改生成的块。
> 每条后面括号里是**违反时框架会报的诊断码**。

## 一、组件体只执行一次（run-once）

**组件函数体只在创建时跑一次**，之后只有 JSX 里订阅的位置更新。

- ❌ `const filtered = list.value.filter(...)` —— 一次快照，之后永不更新
- ✅ 派生放进 JSX：`<div>{list.value.filter(...).map(render)}</div>`
- ❌ 组件体里取快照给回调用：`const v = name.value; onClick={() => save(v)}`
- ✅ 回调内重读：`onClick={() => save(name.value)}`
- 动态 props 用 getter 形态，不要传求值后的值

## 二、条件渲染：**不要在组件体里 `return` 分支**（`VOBS_C107` / `VOBS_C104`）

组件体里读信号的 `return` 在挂载时固化，**三种写法坏得一模一样**：

```tsx
return cond.value ? <A/> : <B/>        // ❌ 冻结
if (cond.value) return <A/>            // ❌ 冻结
return cond.value ? <A/> : null        // ❌ 冻结
```

顶层 `return` 处**没有 parent/anchor**，所以两支都是 JSX 也一样不会重分支。

| 场景 | 用什么 |
|---|---|
| **路由分支** | **`<RouterView/>`**（声明式，内部 `insertDynamic` + `resetKey`） |
| 保留挂载、只切显隐 | **`<Show when={cond}>`**（切 `hidden` + `inert`，焦点/滚动/内部状态不丢） |
| 只切类名 | `class="base" classList={{ 'is-on': cond.value }}` |
| 普通条件渲染 | 放进 **JSX 子节点位置**：`<div>{cond.value ? <A/> : <B/>}</div>` |

## 三、effect 里不要写自己读过的信号（`VOBS_C210` / `VOBS_C211`）

**依赖是自动收集的**：effect 运行期间读到的**任何**信号都会变成依赖。

- ❌ `effect(() => { count.value++ })` —— 读+写同一个信号 = 自订阅循环
- ❌ `effect(() => { if (session.value) void sync() })` —— **「只调了个函数」不等于没依赖**：
  被调函数在**首个 `await` 之前**的代码是**同步执行**的，它读的信号算在 effect 头上
- ✅ 只想声明依赖：**`effect(on(deps, () => { … }))`** —— 回调在 untrack 作用域里跑，
  它调用的函数碰什么信号都不会反向订阅
- ✅ 派生值用 `memo`，不要"读 A 写 B"
- 兜底才是 `untrack(() => { X.value = next })`

**别在 effect 里调 async 函数**（`VOBS_C106`）：`effect` 不等它，
且首个 `await` 之前的部分是同步的。异步取数用 **`@vobs/resource`**。

## 四、客户端副作用与 SSR

- 定时器 / 监听 / `matchMedia` / `localStorage` → **`onMount` 启动、`onDestroy` 清理**
  （**不要手写 `typeof window` 守卫**）
- **渲染输出本身**依赖浏览器（窗口尺寸 / `localStorage` 回填 / `Date.now` / 随机值）
  → **`<ClientOnly fallback={…}>`**（首轮两侧都渲染 fallback，水合对得上）
- 模块顶层**禁止** JSX（`VOBS_C105`）：import 求值早于渲染器安装

## 五、列表与数据

- **数组更新必须换引用**：`list.value = [...list.value, item]`；
  原地 `push` / 改字段**不触发更新**
- JSX **子节点位置**只放四种形态：组件标签 / 元素 / 两分支三元 / `.map()`
- 数据结构里**只存纯描述**（字符串/样式/结构字段），**节点对象别进数据常量**
  （SSG 序列化会炸，产物出现 `[object Xxx]` 时框架会直接报错）

## 六、输入

- **数字输入走 `parseNumber`**（`<Field type="number">` 已内置）：
  空串 / 非法 / 超界**不提交**，保持原值
  —— `Number('') === 0` 会把输入清成 0 并沿联动链路清零兄弟维度
- `<select>` 的 value 直接绑，**不要写 ref 兜底**（1.5.1+ 已修时序）

## 七、图标与 SVG

- **SVG 直接写 JSX**（`<svg><path/></svg>`，1.7.4+ 按 namespace 创建与水合）
- 图标要**登记进白名单**；查表 miss 时 `@vobs/icon-core` 会警告点名（但仍应登记）

## 八、提交前自测

```bash
pnpm run check:source            # = vobs check，全仓一次列出全部诊断
pnpm run check:runtime           # 真实浏览器逐路由跑护栏（需 Chrome）
pnpm run check:runtime:interact  # 再点所有按钮、触发所有输入
```

`vite build` **会**打印编译期警告（`C104`/`C105`/`C106`/`C107`），但只覆盖它编译到的文件；
`check:source` 才是全仓入口。

---

## 一句话速记

| 主题 | 一句话 |
|---|---|
| 组件体 | 只跑一次，派生进 JSX |
| 回调 | 触发时重读 `.value` |
| 条件渲染 | 路由用 `RouterView`，显隐用 `Show`，别在组件体 return 分支 |
| effect | 别写自己读的信号，用 `on(deps, fn)` |
| async | 别塞进 effect，用 `@vobs/resource` |
| 客户端 | `onMount`/`onDestroy`/`ClientOnly`，别手写 `typeof window` |
| 列表 | 换引用 |
| 数字 | `parseNumber` |
| SVG | 直接写 |
| 自测 | `check:source` + `check:runtime` |
