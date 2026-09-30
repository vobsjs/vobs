# dsh-plugin-vobs

把 **vobs** 装成 **DeepSeek Harness（DSH）** 插件的最小可用实现，同时是「vobs → DSH 浏览器插件」的参考接线。

装上之后，DSH 窗口右下角会出现一块浮层：计数 / memo 派生值 / effect 执行次数，以及一个可增删的标签列表。它由 `@vobs/vobs` 渲染在 shadow root 里，外壳只有一个几行的 React 宿主。

```
┌──────────────────────────────────────┐
│ vobs  v1.7.5    Signals First · Z…  – ×│
├──────────────────────────────────────┤
│ 组件体执行   1 │ effect 执行   3       │
│ count 1   memo ×2  2   [−1] [ +1 ]    │
│ [ 给标签列表加一项… ]  [添加]          │
│ (signals ×) (run-once ×)              │
└──────────────────────────────────────┘
```

---

## 一、先解释：为什么 `github:vobsjs/vobs` 装了没反应

DSH 的插件不是「一个 JS 库」，而是一个 **cordis 组合包（bundle）**。插件管理器读到依赖后会检查这个包是否声明了组合包：

- 没有 `dsh.bundle` → 只当普通依赖装上，并给出警告 `declares no dsh.bundle — installed as a plain dependency, not a profile layer`；
- 有 `dsh.bundle.patch` → 把 patch 文件作为一层插入 profile 的 cordis 树；
- 如果还声明了 `dsh.client` → `@deepseek-ai/dsh-client-modules` 再把 `exports['./client']` 作为浏览器 bundle 提供给页面。

vobs 仓库根是 `private: true` 的 pnpm monorepo，没有 `main` / `exports` / `dsh` 字段，`.gitignore` 也排除了 `dist/`。所以直接装 `github:vobsjs/vobs` 只会把 `vobs-framework` 这个空壳装进 `node_modules`，组合层拿不到任何可插入的行 —— 界面上什么都不会发生。

**结论：前端框架本身不可能「是」插件；只能用它写一个插件。** 本包就是那个插件。

---

## 二、DSH 插件契约（已对照真实 DSH 校验）

| 位置 | 要求 | 本包的取值 |
| --- | --- | --- |
| `package.json` → `dsh.bundle.patch` | 指向 patch 文件（相对包根） | `./cordis.patch.yml` |
| `package.json` → `dsh.client.platform` | 客户端 bundle 的平台，Web 客户端为 `'web'` | `'web'` |
| `package.json` → `dsh.client.inject` / `external` / `immediately` | 可选。`inject` 列需要先加载的客户端包，`external` 列基座之外的模块请求 | 都不需要（只 `require('react')`，React 在平台模块表里） |
| `exports['.']` | Host 侧 cordis 插件模块（ESM，导出 `name` / `inject` / `apply`） | `./lib/index.js` |
| `exports['./client']` | **预构建**的浏览器 bundle | `./lib/client.js` |
| `cordis.patch.yml` | YAML 数组，用 `- insert:` 追加自己的行 | 见包内文件 |
| 安装期脚本 | 不要有 `prepare` / `postinstall`：DSH 不做构建，产物必须已提交 | 无 |
| 依赖 | 尽量为零，且绝不能出现 `workspace:` 协议（Git 子目录直装时解析不了） | 零依赖 |

浏览器 bundle 的形态是 DSH 客户端模块系统的一次 factory 注册，**不是**普通 ESM/CJS 包：

```js
window.__ModuleLoader__.load({
  id: 'dsh-plugin-vobs',              // 包名，作为浏览器模块身份
  factory: function (require) {       // 只注册，不执行副作用（含 CSS 注入）
    // ... 自包含的 bundle 内容 ...
    return plugin                       // 浏览器 cordis 插件本体
  }
});
```

几条硬约束（来自 DSH 的客户端模块实现）：

- bundle 必须是**自包含**的，不能拆 chunk、不能用动态 `import()`；入口只允许同步 `require` 平台模块（`react`、`react-dom`、`@deepseek-ai/dsh-client-ui-*` 这类静态表成员）。
- 除平台模块以外的一切（包括 vobs 本身）都必须打进产物。
- 模块副作用延后到首次物化，所以 CSS 注入要放在 factory 闭包里（本包的做法是挂载时注入 shadow root）。

---

## 三、安装

### 前置：先把产物提交进仓库

DSH 安装时**不会**构建你的包，`lib/index.js` 与 `lib/client.js` 必须已经在 Git 里：

```bash
pnpm build:packages      # 首次需要，产出 @vobs/vite-plugin 的 dist
pnpm build:dsh-plugin    # 产出 packages/dsh-plugin/lib/*
git add packages/dsh-plugin scripts/build-dsh-plugins.mjs package.json
git commit -m "feat(dsh-plugin): vobs DSH 插件包"
git tag v1.7.6           # 用一个包含本包的 tag
git push origin main --tags
```

### 方式 A：DSH 插件页（推荐）

在 DSH 侧边栏「插件」页的安装输入框里填：

```text
github:vobsjs/vobs#v1.7.6&path:/packages/dsh-plugin
```

`&path:` 是 pnpm 的 **Git 仓库子目录**语法，用来从 monorepo 里只取一个子包。已验证 DSH 内置的 pnpm 11.7.0 支持它。

- 想跟默认分支走就不写 ref：`github:vobsjs/vobs#path:/packages/dsh-plugin`
- ref 与 path 同时存在时必须用 `&` 连接

### 方式 B：命令行

```bash
dsh plugin --profile desktop add "github:vobsjs/vobs#v1.7.6&path:/packages/dsh-plugin"
```

> **Windows 注意**：`dsh.cmd` 是 batch 包装，`&` 会被 `cmd.exe` 当命令分隔符吃掉，结果是**静默装错包**（装成 monorepo 根，并提示 `declares no dsh.bundle`）。用 PowerShell 时必须加停止解析符：
>
> ```powershell
> dsh --% plugin --profile desktop add "github:vobsjs/vobs#v1.7.6&path:/packages/dsh-plugin"
> ```
>
> 这条路已实测可用；图形界面那条路不受影响（服务直接拿字符串，不经过 shell）。

### 方式 C：npm

把 `packages/dsh-plugin` 发布成 `dsh-plugin-vobs`（版本号与 `@vobs/*` 独立），然后在插件页填包名：

```text
dsh-plugin-vobs
```

### 方式 D：本地目录 / tgz

```bash
pnpm --filter dsh-plugin pack --pack-destination .artifacts
```

然后在插件页填**绝对路径**（目录或 `.tgz` 都行）。

### 装完

Host 侧新增了模块，**完全退出 DSH 再打开**（关窗口不一定退出进程）。面板出现在右下角，可以在插件页里停用或卸载。

---

## 四、开发

```bash
pnpm build:packages                     # 首次：build-dsh 依赖 @vobs/vite-plugin 的 dist
pnpm build:dsh-plugin                   # 构建 lib/index.js 与 lib/client.js
node packages/dsh-plugin/scripts/verify-client.mjs   # 对已构建产物做 jsdom 校验
pnpm typecheck                          # 仓库级类型检查
```

`verify-client.mjs` 不看源码、只看**产物**，按 DSH 的模块协议真跑一遍：注册 factory → 物化取插件 → `apply()` 注册进 `shell.overlay` → React 宿主挂载 → vobs 渲染 → 点击驱动响应式更新 → 清理。它同时是这份接线的可执行规格。

### 目录

```
packages/dsh-plugin/
├── package.json          # dsh 清单 + exports + 零依赖
├── cordis.patch.yml      # 只 insert 自己那行，不覆盖官方条目
├── lib/                  # 预构建产物（提交进 Git）
│   ├── index.js          # Host：合法 cordis 插件，只负责「被挂载」
│   └── client.js         # Client：__ModuleLoader__ factory
├── src/
│   ├── host/index.ts
│   └── client/
│       ├── index.tsx     # React 宿主 + shadow root + slot 注册
│       ├── panel.tsx     # 用 vobs JSX 写的面板
│       └── styles.ts     # 注入 shadow root 的 CSS
└── scripts/verify-client.mjs
```

根目录的 `scripts/build-dsh-plugins.mjs` 负责构建，它刻意**不**走 `build-packages.mjs`：客户端产物要包一层 `__ModuleLoader__`，且必须自包含、不能拆 chunk。

---

## 五、改成你自己的插件

- **换内容**：改 `src/client/panel.tsx`。它是普通 vobs 组件 —— 组件体只执行一次，`{count.value}` 这类表达式被编译器编译成独立的 DOM binding effect。
- **换位置**：`shell.overlay` 是 `@deepseek-ai/dsh-client-ui-layout` 声明的 `list` slot（scope: root），DSH 自家的配额提示、插件管理器 toast 也挂在这里。想换别的 slot 就改 `src/client/index.tsx` 里的 `ctx.slots.inject(...)`。
- **加语言**：客户端可用 `@deepseek-ai/dsh-client-locale`，此时要把它加进 `dsh.client.inject`。
- **跟主题**：面板已经读 `getComputedStyle(document.documentElement).colorScheme`（DSH 主题服务写在这里），读不到则退到 `prefers-color-scheme`；也可以直接用 DSH 的 `--dsw-alias-*` 设计变量。
- **加 Host 能力**：`src/host/index.ts` 现在是有意留空的。要往 Agent 侧加工具、订阅 `session/event`、注册服务，都在这里，并相应改 `inject`。

---

## 六、已知限制

- **版本耦合**：按 DSH Desktop 0.1.x（`@deepseek-ai/cordis@4.0.4`、`shell.overlay` 由 `dsh-client-ui-layout` 声明）接线。DSH 仍在演进，换版本要重新核对 slot 与平台模块表。
- **没有 `@deepseek-ai/cordis` peer 声明**：官方组合包会声明 `peerDependencies: { "@deepseek-ai/cordis": "~4.0.4" }`，但 profile 里并不安装 cordis（它在 app 内），声明 peer 可能让安装前的兼容性检查直接失败。本包因此**不声明**任何 peer，与 `dsh-plugin-whale-pet` 的做法一致。
- **只做 UI**：不注册工具、不订阅事件、不读写会话内容，也不发模型请求。
- **未在真实 Web GUI 里目视确认**：产物侧的协议、渲染、响应式、清理，以及 DSH 插件管理器的安装与组合树插入都已实测通过；面板在真实页面上的呈现仍需在装进 `desktop` profile 后刷新确认一次。

