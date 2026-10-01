/**
 * 可发布包的**唯一清单**。
 *
 * 这份 37 个名字此前硬编码在四处（build-packages / check-packages / verify-packages /
 * check-release），另外还以 `pnpm --filter @vobs/x` 的形式重复了三遍
 * （package.json 的 pack:packages / publish:packages / publish:local）——
 * 加一个包要改七处，漏一处就是「某个包没被构建/没被发布」这种静默事故。
 *
 * 这里收成一份。package.json 里那三条 filter 链**故意保留**（重写发布命令的风险
 * 大于收益：出错就是真发 npm），但 `assertPackageScriptsMatch` 会校验它们与本清单一致 ——
 * 重复变成「被检查的重复」，而不是自由漂移。
 *
 * 排除项：三个 DSH 插件包（`packages/dsh-plugin|dsh-console|dsh-devkit`）。
 * 它们不发布到 npm，靠 Git 标签 + #path: 子目录分发。
 */
export const PUBLISHED_PACKAGES = [
  'reactivity',
  'runtime',
  'dom',
  'vobs',
  'compiler',
  'icon-core',
  'notification',
  'auth',
  'i18n',
  'layout',
  'resource',
  'theme',
  'ui',
  'kit',
  'router',
  'forms',
  'table',
  'captcha',
  'devtools',
  'devtools-ui',
  'dict',
  'http',
  'jwt-auth',
  'logger',
  'preferences',
  'queue',
  'ssr',
  'storage',
  'sync',
  'tailwind',
  'test-utils',
  'transition',
  'upload',
  'vite-plugin',
  'cli',
  'payment',
  'dsh'
]

/** 从 package.json 的 script 里抽出 `--filter @vobs/x` 的 x 集合。 */
export function filtersInScript(command) {
  const names = []
  for (const match of command.matchAll(/--filter\s+@vobs\/([a-z0-9-]+)/gu)) names.push(match[1])
  return names
}

/**
 * 校验 package.json 的发布/打包脚本与 PUBLISHED_PACKAGES 一致。
 * @returns 不一致的描述列表（空数组 = 一致）
 */
export function findPackageScriptDrift(manifest, scriptNames = ['pack:packages', 'publish:packages', 'publish:local']) {
  const problems = []
  const expected = new Set(PUBLISHED_PACKAGES)
  for (const script of scriptNames) {
    const command = manifest.scripts?.[script]
    if (typeof command !== 'string') {
      problems.push(`package.json 缺少 ${script} 脚本`)
      continue
    }
    const actual = new Set(filtersInScript(command))
    for (const name of expected) {
      if (!actual.has(name)) problems.push(`${script} 少了 @vobs/${name}`)
    }
    for (const name of actual) {
      if (!expected.has(name)) problems.push(`${script} 多了 @vobs/${name}（不在可发布清单里）`)
    }
  }
  return problems
}
