# dsh-plugin-vobs-devkit

**Vobs 开发台** —— 注册进 DSH 的 `main`（keyed）整页面板 + 左侧栏入口，给「用 vobs 写代码的人」和「帮人写 vobs 代码的 AI」提供一份参考。

## 五个 tab

| Tab | 内容 | 数据来自 |
| --- | --- | --- |
| **项目** | 工作区里 `.vobs/check.json` 的问题清单（`文件:行:列` + 出错行 + 修复建议），汇总文件/错误/警告数 | **活数据** · `vobs check --write` |
| 护栏 | `VOBS_C210` / `VOBS_C211` 两条规则的说明与前后写法对照（来自已实现的 `@vobs/vobs/dev`） | 构建期静态 |
| API | 仓库里真实存在的 API 索引：签名、说明、示例（逐个对着源码核过） | 构建期静态 |
| 示例 | 可直接复制的写法示例 | 构建期静态 |
| 状态 | 如实列出这个工具链哪些能力做了、哪些没做 | 构建期静态 |

## 「项目」页怎么用

```bash
vobs check --write     # 在被检查的项目根目录跑，产出 .vobs/check.json
```

面板读这个文件并在文件变化时自动重读（比对 `version`，没变就不重读）。
**面板只读、不执行命令** —— DSH 的 workspace-files Remote 没有写入能力，面板也启动不了进程，
所以这份报告由 AI（或你自己）跑出来。

读文件走的是 DSH 内置的 `remote.workspaceFiles`（`readBytes` / `stat`），
**不需要本插件的 Host 半侧** —— 这是这套面板能做成的前提。

### 已知的取舍

- **轮询而不是变更流**：DSH 还提供 `changes()`（流式、更强），但它的消费方式（异步迭代器还是回调）
  我没在活体 DSH 上验证过；`stat()` 的形状是确定的，比 `version` 既便宜又稳。要升级只需替换这一段。
- **用哪个工作区**：取最近更新的那个非空会话的 `cwd`。面板会把它显示出来，选错了能一眼看见。
  要手动切换得等做会话选择器。

## 写这个面板时踩到的坑

- 第一版 `ApiIndex` 在组件体里读 `props.apiName.value` —— 组件体只执行一次，所以点击左侧 API
  条目右侧纹丝不动。改成 `memo` 派生值后才正确。（这正是本面板「护栏」页在讲的坑。）
- `data instanceof Uint8Array` **跨 realm 会失败**（jsdom / iframe / worker 边界上构造函数不同）。
  改成按 `byteLength` 判形状。
- vobs 的 JSX 会**吃掉表达式前的空格**：`{x} 个文件` 渲染成 `12个文件`。用模板字符串显式带上。

## 为什么其余页面是静态的

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
