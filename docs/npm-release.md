# vobs npm 发布流程

本文档记录 vobs 双轨 npm 包的版本发布流程。当前发布由 GitHub Actions
通过版本标签触发，不会因为普通的 `main` 分支推送自动发布。

## 发布范围

当前自动发布名单为以下 36 个已完成产物构建与发布验证的公共包：

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
```

根目录项目是 private workspace，不参与发布；其他尚未进入名单的包也不会被
自动发布。

`@vobs/cli` 和 `@vobs/payment` 现已加入公共打包、版本一致性校验和 GitHub Actions
自动发布清单；两者继续保留 `dist/` 与 `/source` 双轨入口。

## 首次配置

需要在 npm 中为上述每个包配置 GitHub Actions Trusted Publisher：

- Organization：`vobsjs`
- Repository：`vobs`
- Workflow filename：`publish.yml`

发布工作流使用 OIDC，不需要在 GitHub Secrets 中保存长期 npm token。

对应工作流文件为：

- `.github/workflows/ci.yml`：PR 和 `main` push 的质量门禁
- `.github/workflows/publish.yml`：版本标签触发的发布流程

## 发布 1.2.0

当前仓库的发布包版本为 `1.1.0`。发布下一版时，先把上面 36 个包的
`package.json` 版本统一改为 `1.2.0`，并更新 `CHANGELOG.md`。

然后执行版本门禁：

```bash
pnpm run check:release -- v1.2.0
```

看到以下结果后，才能创建标签：

```text
[release] v1.2.0 matches 36 public packages
```

提交版本变更并推送 `main`：

```bash
git add packages CHANGELOG.md
git commit -m "release: v1.2.0"
git push origin main
```

创建并推送版本标签：

```bash
git tag v1.2.0
git push origin v1.2.0
```

推送标签后，GitHub Actions 会按以下顺序执行：

```text
校验标签与包版本
  -> 安装依赖
  -> 运行单测
  -> 验证 ESM/CJS/类型声明/source tarball
  -> 构建框架和 Playground
  -> 发布 36 个公共包
```

不需要在本地直接执行 `pnpm publish`。

## 发布后检查

在 GitHub Actions 的 `Publish packages` 工作流成功后，抽查 npm 版本：

```bash
npm view @vobs/vobs version
npm view @vobs/ui version
npm view @vobs/kit version
```

也可以在一个临时目录中安装并验证：

```bash
pnpm add @vobs/vobs@1.2.0 @vobs/ui@1.2.0 @vobs/kit@1.2.0
```

## 常见失败

- `check-release` 失败：标签版本与 36 个包版本不一致。
- `There are no new packages that should be published`：该版本已经存在于 npm，
  需要递增到新的版本号；npm 已发布版本不能覆盖。
- OIDC 或权限失败：检查对应 npm 包是否已配置 `publish.yml` Trusted Publisher，
  以及仓库和组织名称是否为 `vobsjs/vobs`。
- 构建或 tarball 验证失败：不要强行发布，修复后重新提交新的版本。

已发布的 npm 版本不可原地覆盖；如果发布内容有问题，应修复后发布下一个
补丁版本，例如 `1.2.1`。
