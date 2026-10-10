# 仓库能力索引

> **本文件由 `pnpm run checks -- --write` 生成，不要手改。**
>
> 动手写新的脚本 / 检查 / 工具之前**先看这里** ——
> 实测有 4 次「重复造轮子」，其中一次还按错误结论改坏了 3 个包。
> 要查**导出符号**用 `vobs api <关键词>`；要查**诊断规则**用 `vobs explain`。

## `build:dsh`

构建仓库内的 DSH 插件包。

- 运行：`pnpm run build:dsh`
- 实现：`scripts/build-dsh-plugins.mjs`

## `build:dsh-console`

构建仓库内的 DSH 插件包。

- 运行：`pnpm run build:dsh-console`
- 实现：`scripts/build-dsh-plugins.mjs`

## `build:dsh-devkit`

构建仓库内的 DSH 插件包。

- 运行：`pnpm run build:dsh-devkit`
- 实现：`scripts/build-dsh-plugins.mjs`

## `build:dsh-plugin`

构建仓库内的 DSH 插件包。

- 运行：`pnpm run build:dsh-plugin`
- 实现：`scripts/build-dsh-plugins.mjs`

## `build:packages`

（该脚本没有头注释摘要）

- 运行：`pnpm run build:packages`
- 实现：`scripts/build-packages.mjs`

## `check:imports`

校验「包源码里 import 的 @vobs/* 都在自己 package.json 里声明了」。

- 运行：`pnpm run check:imports`
- 实现：`scripts/check-imports.mjs`

## `check:packages`

（该脚本没有头注释摘要）

- 运行：`pnpm run check:packages`
- 实现：`scripts/check-packages.mjs`

## `check:release`

（该脚本没有头注释摘要）

- 运行：`pnpm run check:release`
- 实现：`scripts/check-release.mjs`

## `check:runtime`

（该脚本没有头注释摘要）

- 运行：`pnpm run check:runtime`
- 实现：`scripts/check-runtime.mjs`

## `check:runtime:interact`

（该脚本没有头注释摘要）

- 运行：`pnpm run check:runtime:interact`
- 实现：`scripts/check-runtime.mjs`

## `check:scripts`

（该脚本没有头注释摘要）

- 运行：`pnpm run check:scripts`
- 实现：`scripts/check-scripts.mjs`

## `check:source`

（该脚本没有头注释摘要）

- 运行：`pnpm run check:source`

## `checks`

（该脚本没有头注释摘要）

- 运行：`pnpm run checks`
- 实现：`scripts/checks-catalog.mjs`

## `release:version`

（该脚本没有头注释摘要）

- 运行：`pnpm run release:version`
- 实现：`scripts/set-version.mjs`

## `test`

（该脚本没有头注释摘要）

- 运行：`pnpm run test`

## `test:run`

（该脚本没有头注释摘要）

- 运行：`pnpm run test:run`

## `verify:packages`

（该脚本没有头注释摘要）

- 运行：`pnpm run verify:packages`
- 实现：`scripts/verify-packages.mjs`
