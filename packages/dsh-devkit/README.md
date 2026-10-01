# dsh-plugin-vobs-devkit

**Vobs 开发台** —— 注册进 DSH 的 `main`（keyed）整页面板 + 左侧栏入口，给「用 vobs 写代码的人」和「帮人写 vobs 代码的 AI」提供一份参考。

内容**在构建期打进产物**，运行时零请求、零依赖。

## 四个 tab

| Tab | 内容 |
| --- | --- |
| 护栏 | `VOBS_C210` / `VOBS_C211` 两条规则的说明与前后写法对照（来自已实现的 `@vobs/vobs/dev`） |
| API | 仓库里真实存在的 API 索引：签名、说明、示例（逐个对着源码核过） |
| 示例 | 可直接复制的写法示例 |
| 状态 | 如实列出这个工具链哪些能力做了、哪些没做 |

## 为什么内容是静态的

**开发台跑在 DSH 里，你的应用跑在它自己的 dev server 里 —— 两者不是同一个页面。**
所以面板看不到你应用的运行时（包括运行时护栏的告警）。

要显示活数据（工作区信息、`vobs check` 结果）需要把 DSH 的 **Host 半侧**接上：Host 能读工作区、能跑 CLI，再通过 cordis 的服务把结果送给客户端。这一步**还没做**，「状态」页里如实标了。

## 安装

```bash
dsh plugin --profile desktop add "github:vobsjs/vobs#<ref>&path:/packages/dsh-devkit"
```

`<ref>` 用包含本包的 tag 或提交 SHA。装完**完全退出 DSH 再打开** —— Host 侧模块不会热加载。

## 开发

```bash
pnpm build:dsh-devkit                              # 构建 lib/{index,client}.js
node packages/dsh-devkit/scripts/verify-devkit.mjs # 50 项产物校验（jsdom 里真挂载、真点击）
```

产物 `lib/` 是**签入仓库**的 —— DSH 不会构建你的包。改了源码必须重新构建并提交，否则装进来的还是旧产物（`dsh-plugin` 的校验脚本会用内嵌版本号拦住这种情况）。

## 写这个面板时踩到的坑（面板自己踩的）

第一版 `ApiIndex` 在组件体里读了 `props.apiName.value` —— 组件体只执行一次，所以点击左侧 API 条目右侧纹丝不动。改成 `memo` 派生值后才正确。

这**正是本面板「护栏」页在讲的那个坑**（按 React 心智模型在组件体里读信号）。写 vobs 时记住：**组件体只跑一次，可变读取必须放进动态表达式或 `memo`**。
