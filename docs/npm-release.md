# vobs npm 发布流程

本文档记录 vobs 双轨 npm 包的版本发布流程。

> **现状（2026-09-30 核对）**
>
> 本文档此前描述「推送版本标签后由 `.github/workflows/publish.yml` 自动发布」。
> 实际仓库里**没有** `publish.yml` —— `.github/workflows/` 下只有 `ci.yml`
> （PR 与 `main` push 的质量门禁）。因此**推送标签不会自动发布**，发布是本地手动执行的。
> 下面的「手动发布」一节给出当前实际可用的命令；「首次配置」里关于 Trusted Publisher
> 的内容只有在补上 `publish.yml` 之后才适用。
>
> 另需知道：Git 标签在本仓库承担**两个**用途 —— npm 发版，以及 DSH 插件包的安装引用
> （`github:vobsjs/vobs#<tag>&path:/packages/<name>`）。`v1.7.6` 是**只用后者**的标签：
> 它指向插件提交，当时 37 个包的版本仍是 `1.7.5`，`check:release` 对它是失败的，
> npm 上也没有对应版本。发版时不要复用已推送的标签。

## 发布范围

当前自动发布名单为以下 37 个已完成产物构建与发布验证的公共包：

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

根目录项目是 private workspace，不参与发布；其他尚未进入名单的包也不会被
自动发布。

`@vobs/cli` 和 `@vobs/payment` 现已加入公共打包、版本一致性校验和发布清单；
两者继续保留 `dist/` 与 `/source` 双轨入口。

`@vobs/dsh`（1.7.7 新增）同样保留 `dist/` 与 `/source` 双轨入口，并额外导出
`./react`、`./vite`、`./types`、`./preview` 四个子路径；它的 `vite` 是
`peerDependencies` 且标记为 optional（只有 `./vite` 入口需要）。

`packages/dsh-plugin` 与 `packages/dsh-console` **不在**发布名单里：它们不是
`@vobs/*` 包，版本独立（`0.1.0`），通过 Git 标签 + `#path:` 子目录安装，
产物 `lib/` 提交进仓库。

## 首次配置

若日后补上 `publish.yml` 走 OIDC 自动发布，需要在 npm 中为上述每个包配置
GitHub Actions Trusted Publisher：

- Organization：`vobsjs`
- Repository：`vobs`
- Workflow filename：`publish.yml`

发布工作流使用 OIDC，不需要在 GitHub Secrets 中保存长期 npm token。

当前实际存在的工作流文件只有：

- `.github/workflows/ci.yml`：PR 和 `main` push 的质量门禁

注意 `ci.yml` **不构建也不校验**两个 DSH 插件包；它们的产物校验
（`packages/dsh-plugin/scripts/verify-client.mjs` 与
`packages/dsh-console/scripts/verify-console.mjs`）目前只在本地手动运行。

## 发布新版本（以 1.7.7 为例）

先确认 37 个包的 `package.json` 版本已统一，并更新 `CHANGELOG.md`。

然后执行版本门禁：

```bash
pnpm run check:release -- v1.7.7
```

看到以下结果后，才能创建标签：

```text
[release] v1.7.7 matches 37 public packages
```

提交版本变更并推送 `main`：

```bash
git add packages CHANGELOG.md
git commit -m "release: v1.7.7"
git push origin main
```

创建并推送版本标签：

```bash
git tag v1.7.7
git push origin v1.7.7
```

## 手动发布

推送标签不会触发任何发布。本地发布前先确认质量门禁全绿：

```bash
pnpm install --frozen-lockfile
pnpm test:run
pnpm run build          # build:packages + typecheck + playground 构建
pnpm run verify:packages # 逐个 pack 并验证 ESM/CJS/类型/source 入口
```

然后逐包发布。**必须去掉 `--provenance`** —— 该参数只在受支持的 CI 环境中才能
生成来源证明，本地执行会直接失败：

```bash
pnpm --filter @vobs/vobs --filter @vobs/ui --filter @vobs/dsh \
  publish --no-git-checks --access public
```

`package.json` 里的 `publish:packages` 脚本保留了 `--provenance`，它是为
GitHub Actions 那条链路准备的，**本地不要直接用**。

`@vobs/dsh` 是首次发布，需要先 `npm login` 且账号对 `@vobs` scope 有发布权限。

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
- `--provenance` 报错：本地环境不支持生成来源证明，去掉该参数。
- `There are no new packages that should be published`：该版本已经存在于 npm，
  需要递增到新的版本号；npm 已发布版本不能覆盖。
- OIDC 或权限失败：只在补齐 `publish.yml` 之后才可能出现，检查对应 npm 包是否已
  配置 Trusted Publisher，以及仓库和组织名称是否为 `vobsjs/vobs`。
- 构建或 tarball 验证失败：不要强行发布，修复后重新提交新的版本。

已发布的 npm 版本不可原地覆盖；如果发布内容有问题，应修复后发布下一个
补丁版本，例如 `1.7.8`。

