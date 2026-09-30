# dsh-plugin-vobs-console

**Vobs Console** —— 用 [vobs](https://github.com/vobsjs/vobs) 渲染的 DSH 多会话实时驾驶舱。

它注册进 DSH 的 `main`（keyed）slot，在左侧栏多一个 **Console** 入口，点开占满主区域。整页 GUI 由 vobs 在自己的 shadow root 里渲染，外层只有一个几行的 React 宿主 —— 这份宿主由 [`@vobs/dsh`](../dsh) 提供，本包自己没有一行 React。

预览图见 [`packages/dsh-plugin/design/preview/`](../dsh-plugin/design/preview)。

---

## 为什么需要它

DSH 现在的界面是**单会话为中心**的：主区域是对话，右侧是当前会话的文件 / 终端 / 预览。**跨会话、跨 turn 的运行态**是散的 —— 谁在跑、跑了多久、烧了多少 token、哪个工具在失败，得一个个会话点开看。

Console 补的就是这块。

| Tab | 内容 |
| --- | --- |
| **总览** | 运行中会话 / 等待审批 / 工具调用 / 成功率四个实时指标；最近事件；工具 Top 5；会话运行态（token 与耗时） |
| **事件流** | 全部运行事件的实时列表，可过滤、可暂停；暂停期间新事件被丢弃并计数，而不是继续堆积 |
| **工具分析** | 每个工具的调用次数 / 成功率 / P50 / P95 / 总耗时 / 趋势折线。统计是**增量**维护的，不会为算 P95 重扫全量事件 |
| **产物** | 由写入 / 编辑 / 交付类工具事件推导出的交付物时间线 |

为什么用 vobs 而不是 React：这些界面的负载是**高频流式更新**（事件流每秒几十到几百条）。vobs 的组件体只执行一次，更新全部落在绑定的 DOM 节点上；`insertList` 做 keyed 复用，只插入新增行。这正是这套 UI 的技术前提，`packages/dsh-console/scripts/verify-console.mjs` 里有对应的可执行断言。

---

## 数据来源

Console 会**自动选择**数据源，界面上有明确标注：

| 情况 | 数据源 | 徽标 |
| --- | --- | --- |
| 探测到 DSH 的 `sessions` 服务 | 真实会话目录与运行状态 | 绿色「DSH 实时数据」 |
| 没探测到 | 本地确定性演示生成器 | 橙色「演示数据」 |

### 真实数据（`createDshSource`）

读的是 `@deepseek-ai/dsh-api-session-controller` 在客户端发布的 `sessions` 服务，
以及 `uiSession.sessionStatus`。这些方法名与行字段是从已安装 DSH 的 `lib/client.js`
里读出来的，不是猜的：

| 来源 | 拿到什么 |
| --- | --- |
| `ctx.get('sessions').list.getSnapshot()` / `.subscribe()` | `{ ids, byId }`，行含 `sessionId / title / running / blank / updatedAt / parentSessionId / depth` |
| `ctx.get('uiSession').sessionStatus` | 每会话的 `running` / `pendingInteraction` / `removed` |

由此得到：会话列表、运行中 / 等待审批的状态、以及**由状态跃迁派生的事件流**
（`turn/start`、`turn/end`、`approval/request`、`session/open`、`session/close`、`session/update`）。

**拿不到什么，以及为什么不硬凑**：

- **token 与耗时** —— 不在会话目录快照里，显示为「—」。
- **工具级事件** —— 属于会话内部历史，要采集就得对每个会话 `retain()` 打开并跟随它的事件流。
  而 DSH 自己刻意避免「为了列表去打开冷会话」；本适配器同样不越这条线。

因此「工具分析」页在真实数据下会显示一段解释而不是空表格；切到演示数据时那一页是完整的
（用来预览表格与趋势线的行为）。这是有意的取舍：**宁可少显示，也不把拿不到的数据编出来。**

### 演示数据

`createSyntheticSource` 是确定性的（mulberry32 + 固定 seed），因此同一份输入每次结果一致。
它有两个用途：真实接线之外的预览载体，以及**事件风暴的现成压测夹具**（`source.tick(200)` 一次灌 200 条）。

`ConsoleSource` 接口是数据面的唯一边界，换数据源不需要动任何视图代码；
`createSwitchableSource` 让 Console 先以演示数据建好，探测到真实服务后整体切换并广播 `reset`。

---

## 安装

先确保仓库里有构建产物（`lib/client.js` 必须提交，DSH 不做构建），然后：

```text
github:vobsjs/vobs#<tag>&path:/packages/dsh-console
```

或在命令行：

```bash
dsh plugin --profile desktop add "github:vobsjs/vobs#<tag>&path:/packages/dsh-console"
```

> Windows 下 `dsh.cmd` 是 batch 包装，`&` 会被 `cmd.exe` 吃掉而**静默装错包**，PowerShell 里要用 `dsh --% plugin …`。细节见 [dsh-plugin 的 README](../dsh-plugin/README.md#三安装)。

装完完全退出 DSH 再打开；左侧栏出现 **Console** 图标。

---

## 开发

```bash
pnpm build:packages        # 首次：产出 @vobs/dsh 与 @vobs/vite-plugin 的 dist
pnpm build:dsh-console     # 产出 packages/dsh-console/lib/{index,client}.js
pnpm --filter dsh-plugin-vobs-console verify     # 60 项产物校验
```

`scripts/verify-console.mjs` 不看源码、只看产物，按 DSH 的模块协议真跑一遍：
注册 factory → 物化取插件 → `apply()` 注册 `main` + `sidebar.panellist` → 挂载 → 断言 KPI / 会话列表 →
推进演示时钟灌入事件 → 断言 tab 切换、过滤、暂停丢弃计数、工具聚合与趋势线 →
清理 shadow root 与定时器。

单元测试在 `src/client/data.test.ts`（24 项）：格式化、SVG 折线生成、环形缓冲封顶、
工具聚合（含「失败是调用的子集，不能重复计入」这条曾经写错过的规则）、暂停语义、演示数据可复现性。

### 目录

```
packages/dsh-console/
├── package.json          # dsh 清单（bundle.patch + client.platform）
├── cordis.patch.yml      # 只 insert 自己那行
├── lib/                  # 预构建产物（提交进 Git）
├── src/
│   ├── host/index.ts     # Host：只负责「被挂载」
│   └── client/
│       ├── index.tsx     # defineDshPanel：main + sidebar.panellist
│       ├── console.tsx   # 整页：头部 + 四个 tab
│       ├── data.ts       # 数据模型、环形缓冲、工具聚合、演示源、服务探测
│       ├── styles.ts     # 注入 shadow root 的 CSS（读 DSH design token）
│       └── icons.tsx     # vobs JSX 画的内联 SVG
└── scripts/verify-console.mjs
```

---

## 已知限制

- **数据是演示的**：真实事件流接线需要对照活体 DSH 核对 `SessionControlStream` / `SessionEventStream` 的方法签名，尚未完成。
- **事件流没有虚拟滚动**：环形缓冲 5000 条，但一次最多渲染 300 行。滚动性能压测还没做。
- **视觉自建**：vobs 面板里用不了 DSH 的 React 组件库（`@deepseek-ai/dsh-client-ui-primitives`），一致性靠 `--dsw-*` design token 维持。
- **slot 是非官方契约**：`main` / `sidebar.panellist` 的名字与语义从已安装的 DSH 反推，DSH 升级后可能漂移。
- **40/900px 假设**：布局按 DSH 主区域的容器尺寸设计，极窄窗口下会退化（未做响应式）。
