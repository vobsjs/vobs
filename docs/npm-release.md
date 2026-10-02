# vobs npm 发布流程

本文档记录 vobs 双轨 npm 包的版本发布流程。

> **现状（2026-09-30 核对）**
>
> 本文档此前描述「推送版本标签后由 `.github/workflows/publish.yml` 自动发布」。
> 实际仓库里**没有** `publish.yml` —— `.github/workflows/` 下只有 `ci.yml`
> （PR 与 `main` push 的质量门禁）与 `release.yml`（推 `v*` 标签时**校验**版本对齐）。
> 因此**推送标签不会自动发布**，发布是本地手动执行的。
> 下面的「手动发布」一节给出当前实际可用的命令。
>
> **这是决定，不是过渡状态**（2026-10-02 明确）：标签在本仓库**只做校验**，
> 发布**始终手动执行**。不打算补 `publish.yml` 走 OIDC 自动发布 ——
> 自动发布需要为 37 个包逐个配置 Trusted Publisher，而手动发布的实际频率很低，
> 收益不抵维护面。「首次配置」一节保留为**备案**（真要做时的步骤），不属于待办。
>
> 另需知道：Git 标签在本仓库承担**两个**用途 —— npm 发版，以及 DSH 插件包的安装引用
> （`github:vobsjs/vobs#<tag>&path:/packages/<name>`）。`v1.7.6` 是**只用后者**的标签：
> 它指向插件提交，当时 37 个包的版本仍是 `1.7.5`，`check:release` 对它是失败的，
> npm 上也没有对应版本。发版时不要复用已推送的标签。

## 发布范围

当前发布名单为以下 37 个已完成产物构建与发布验证的公共包：

```text
@vobs/reactivity
@vobs/runtime
@vobs/dom
@vobs/vobs
@vobs/compiler
@vobs/icon-core
@vobs/notification
@vobs/auth
@vobs/i18n
@vobs/layout
@vobs/resource
@vobs/theme
@vobs/ui
@vobs/kit
@vobs/router
@vobs/forms
@vobs/table
@vobs/captcha
@vobs/devtools
@vobs/devtools-ui
@vobs/dict
@vobs/http
@vobs/jwt-auth
@vobs/logger
@vobs/preferences
@vobs/queue
@vobs/ssr
@vobs/storage
@vobs/sync
@vobs/tailwind
@vobs/test-utils
@vobs/transition
@vobs/upload
@vobs/vite-plugin
@vobs/cli
@vobs/payment
@vobs/dsh
```

根目录项目是 private workspace，不参与发布；其他尚未进入名单的包也不会被发布。

`@vobs/cli` 和 `@vobs/payment` 现已加入公共打包、版本一致性校验和发布清单；
两者继续保留 `dist/` 与 `/source` 双轨入口。

`@vobs/dsh`（1.7.7 新增）同样保留 `dist/` 与 `/source` 双轨入口，并额外导出
`./react`、`./vite`、`./types`、`./preview` 四个子路径；它的 `vite` 是
`peerDependencies` 且标记为 optional（只有 `./vite` 入口需要）。

`packages/dsh-plugin` 与 `packages/dsh-console` **不在**发布名单里：它们不是
`@vobs/*` 包，版本独立（`0.1.0`），通过 Git 标签 + `#path:` 子目录安装，
产物 `lib/` 提交进仓库。

## 首次配置

> **备案，不是待办**：按上面的决定，本仓库不采用 OIDC 自动发布。
> 以下步骤只在"哪天决定改成自动发布"时才需要执行。

若要走 OIDC 自动发布，需要在 npm 中为上述每个包配置 GitHub Actions Trusted Publisher：

- Organization：`vobsjs`
- Repository：`vobs`
- Workflow filename：`publish.yml`

发布工作流使用 OIDC，不需要在 GitHub Secrets 中保存长期 npm token。

当前实际存在的工作流文件（两个）：

- `.github/workflows/ci.yml`：PR 和 `main` push 的质量门禁
- `.github/workflows/release.yml`：**推送 `v*` 标签时校验「标签版本 == 全部可发布包版本」**
  （只校验，不发布）。它拦的是「打了标签却忘了 bump 包版本」这类错位 ——
  历史上真的发生过（`v1.7.8` 指向的提交里版本没对齐）

注意 `ci.yml` **不构建也不校验**两个 DSH 插件包；它们的产物校验
（`packages/dsh-plugin/scripts/verify-client.mjs` 与
`packages/dsh-console/scripts/verify-console.mjs`）目前只在本地手动运行。

## 发布新版本（以 1.7.7 为例）

先统一 37 个包与**根** `package.json` 的版本，并更新 `CHANGELOG.md`：

```bash
pnpm run release:version 1.7.7      # 一次写入根 + 全部可发布包（--dry 可预览）
```

然后执行版本门禁。**不带标签参数时进入「一致性模式」** —— 校验包之间是否互相一致、
以及根版本是否同步（这一步不需要标签，随时可跑）：

```bash
pnpm run check:release
```

```text
[release] 版本一致：1.7.7（37 个包，根版本同步）
```

创建标签前再用标签形态校验一次（`release.yml` 在 CI 里跑的就是这条）：

```bash
pnpm run check:release -- v1.7.7
```

```text
[release] v1.7.7 matches 37 public packages（根版本同步）
```

提交版本变更并推送 `main`：

```bash
git add package.json packages CHANGELOG.md
git commit -m "release: v1.7.7"
git push origin main
```

创建并推送版本标签：

```bash
git tag v1.7.7
git push origin v1.7.7
```

## 手动发布

推送标签不会触发任何发布。发布前先确认质量门禁全绿：

```bash
pnpm install --frozen-lockfile
pnpm test:run
pnpm run build           # build:packages + typecheck + playground 构建
pnpm run verify:packages # 逐个 pack 并验证 ESM/CJS/子路径/source 入口
```

然后一条命令发布 37 个包（顺序与依赖大致一致，`workspace:*` 由 pnpm 在打包时
换成真实版本，所以必须用 `pnpm publish`，`npm publish` 不认这个协议）：

```bash
pnpm run publish:local
```

`publish:packages` 与 `publish:local` 的包列表完全相同，唯一差别是前者带
`--provenance`。**本地只能用 `publish:local`**，原因见下。

### 发布后核对：可见性滞后于接受

**不要在发布命令返回后立刻核对版本，否则必然看到「一半没发出去」的假象。**

实测（2026-09-30 发布 1.7.7 时）：注册表对上传返回 **202 Accepted**，写入即被接受，
但 packument 是**异步**更新的 —— 单个包从接受到在 `npm view` 里可见，实测约
**3～5 分钟**。在这段窗口内：

- `npm view <pkg> version` 仍是旧版本；
- 重新执行 publish 会返回
  `409 Conflict - Cannot publish over previously staged version "<x.y.z>"`。

**这条 409 不代表失败，只代表「已在途」**：不要重发、不要改版本号，等几分钟即可。
（npm 11.6.1 没有 `npm stage` 子命令，这个暂存状态在客户端侧查不到。）

因此核对要这样做：等 3–5 分钟 → 逐个 `npm view` → 把**请求异常**和**版本缺失**分开记，
不要用同一个 catch 把网络错误也算成「没发出去」。

```bash
for p in reactivity runtime dom vobs compiler; do
  echo -n "$p: "; npm view "@vobs/$p" version 2>/dev/null || echo "查询失败"
done
```

### 为什么本地不能用 `--provenance`

来源证明（provenance）要求运行在支持的 CI 环境里。npm 的
`libnpmpublish/lib/publish.js` 里 `ensureProvenanceGeneration()` 的判定是：

- GitHub Actions：要求 `id-token: write` 权限（即存在 `ACTIONS_ID_TOKEN_REQUEST_URL`）；
- GitLab CI：要求存在 `SIGSTORE_ID_TOKEN`；
- **其他环境（含本地终端）：直接抛错**
  `Automatic provenance generation not supported for provider: <name>`（`EUSAGE`）。

另外该检查只在**真实 publish** 里执行，所以 `pnpm publish --dry-run --provenance`
会正常通过 —— 靠 dry-run 是发现不了这个问题的。此外，`--provenance` 对**全新包**
还要求显式 `--access public`（我们的脚本已经带了）。

### 首次发布新包

`@vobs/dsh` 于 1.7.7 首次发布，需要：

1. `npm login`（`npm whoami` 确认身份）；
2. 账号对 `@vobs` scope 有发布权限；
3. 作用域包首次发布必须 `--access public`，否则默认按私有包处理。

若只补发个别包，可以单独过滤：

```bash
pnpm --filter @vobs/dsh --filter @vobs/cli publish --no-git-checks --access public
```

## 发布后检查

抽查 npm 版本：

```bash
npm view @vobs/vobs version
npm view @vobs/ui version
npm view @vobs/dsh version
```

也可以在一个临时目录中安装并验证：

```bash
pnpm add @vobs/vobs@1.7.7 @vobs/ui@1.7.7 @vobs/dsh@1.7.7
```

## 常见失败

- `check-release` 失败：标签版本与 37 个包版本不一致。
- `Automatic provenance generation not supported for provider: ...`：本地跑了带
  `--provenance` 的命令，改用 `pnpm run publish:local`。
- `409 Conflict - Cannot publish over previously staged version "x.y.z"`：
  **通常不是失败，而是发布已在途**（注册表返回 202 后 packument 异步更新）。
  等 3–5 分钟再核对；不要重发、不要改版本号。见上一节的「发布后核对」。
- `There are no new packages that should be published`：该版本已经存在于 npm，
  需要递增到新的版本号；npm 已发布版本不能覆盖。
- `EPUBLISHCONFLICT` / 403：账号没有该 scope 的发布权限，或包名已被他人占用。
- OIDC 或权限失败：只在补齐 `publish.yml` 之后才可能出现，检查对应 npm 包是否已
  配置 Trusted Publisher，以及仓库和组织名称是否为 `vobsjs/vobs`。
- 构建或 tarball 验证失败：不要强行发布，修复后重新提交新的版本。

已发布的 npm 版本不可原地覆盖；如果发布内容有问题，应修复后发布下一个
补丁版本，例如 `1.7.8`。

