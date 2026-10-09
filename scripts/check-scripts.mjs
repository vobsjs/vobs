/*
 * `.mjs` 脚本里不该出现 TypeScript 类型标注。
 *
 * ## 唯一的检查项（刻意只留这一条）
 *
 * 事故：我**连续三次**在生成改动的 `.mjs` 脚本里写了 `const x: string[] = []`
 * —— `.mjs` 是 JS，脚本**直接语法错误、一处改动都没生效**，每次都浪费一个来回
 * （而且还得重新核对"到底改没改"）。
 *
 * ## 为什么原来叫 check-invariants、还带一条依赖检查
 *
 * 我最初写了两条：① workspace 依赖声明 ② `.mjs` 注解。
 * 提交前才发现 `scripts/check-imports.mjs` **早就在做①**，而且做得更好：
 *
 * | | 已有的 `check:imports` | 我写的① |
 * |---|---|---|
 * | 取 import | **TypeScript AST**（真实 import） | 正则文本匹配 |
 * | 注释 / 模板字符串 | **天然免疫** | 要自己剥注释（我中途才补上） |
 * | 打包型包（有 `dsh` 字段） | **整包跳过**（manifest 不能出现 `workspace:`） | 我误报并"修复"了它们 |
 *
 * **更糟的是我按自己的检查去"修"了：** 给 3 个 dsh 插件包补了 `workspace:*` ——
 * 而 `check-imports` 的文件头明确写着「试过补 `workspace:*`，立刻把那条断言打红了」。
 * 已全部 `git checkout` 回退。
 *
 * 所以①整条删除，只留②（`check-imports` 不管这个）。
 *
 * **这是同一个失败模式第 4 次**：重复实现一个已经存在的能力
 * （前三次：`inferStateDebugName`、`onDestroy` 的命名、`vobs check` 的全仓扫描）。
 * 也说明「先查有没有」应该成为动手前的固定动作。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const failures = []

/**
 * 一行里是否有**明确的** TS 类型标注（窄检测，目标是零误报）。
 *
 * 第一版还检测"形参注解"和"对象属性"，实测**全是误报**：
 *   scripts/build-packages.mjs  entry: entryFor(ts), dts: true, clean: true
 *                                          ↑ ", dts: true," 被当成形参注解
 *   scripts/check-release.mjs   { name: x, version: manifest.version, ... }
 *                                          ↑ 对象字面量属性也匹配
 * **那两个脚本是能正常跑的** —— 所以是检查本身错了，而误报会拦门禁。
 *
 * 收紧后只认：`const NAME: <像类型的> =`
 * 类型须大写开头（或 TS 关键字 string/number/boolean/unknown/any/never/void），
 * 可带 `[]` / `<>`；`true`、`manifest.version` 都不符合。
 */
function looksLikeTypeAnnotation(line) {
  const text = line.trim()
  if (text.startsWith('//') || text.startsWith('*') || text.startsWith('/*')) return false
  return /\b(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*:\s*(?:string|number|boolean|unknown|any|never|void|[A-Z][\w$.]*)\s*(?:\[\]|<[^>]*>)?\s*=[^=]/.test(text)
}

function checkScripts() {
  const scriptsDir = path.join(ROOT, 'scripts')
  if (!existsSync(scriptsDir)) return
  const walk = (dir, depth) => {
    if (depth > 4) return
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) { walk(full, depth + 1); continue }
      if (!entry.name.endsWith('.mjs')) continue
      let text
      try { text = readFileSync(full, 'utf8') } catch { continue }
      const relative = path.relative(ROOT, full).split(path.sep).join('/')
      text.split(/\r?\n/).forEach((line, index) => {
        if (!looksLikeTypeAnnotation(line)) return
        failures.push(
          `${relative}:${index + 1} 在 .mjs 里写了 TypeScript 类型标注：\n`
          + `    ${line.trim().slice(0, 90)}\n`
          + `    → .mjs 是 JS：脚本会**直接语法错误**，改动一处都不会生效（踩过三次）。\n`
          + `    → 去掉注解，或把脚本改成 .ts 由 tsx 运行。`
        )
      })
    }
  }
  walk(scriptsDir, 0)
}

checkScripts()

if (failures.length > 0) {
  console.error(`vobs check:scripts —— ${failures.length} 处 .mjs 写法问题\n`)
  for (const item of failures) console.error(`  ✖ ${item}\n`)
  process.exitCode = 1
} else {
  console.log(`vobs check:scripts —— scripts/ 下 ${readdirSync(path.join(ROOT, 'scripts')).length} 项通过 ✓`)
}
