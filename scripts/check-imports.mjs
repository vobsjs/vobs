/**
 * 校验「包源码里 import 的 @vobs/* 都在自己 package.json 里声明了」。
 *
 * 为什么必须单独查：`pnpm run verify:packages` 把 37 个包装进同一个临时工程，
 * 于是「A 用了 B 却没声明」在那里**永远能解析成功** —— 结构性发现不了。
 * 实测查出 3 处真幻影依赖（captcha / devtools-ui / test-utils 直接用 @vobs/reactivity
 * 但没声明），另有一处是**误报**：vite-plugin 把 `import ... from '@vobs/vobs'` 写在
 * 注入浏览器的模板字符串里，正则扫描会把它当真 import。
 * 所以这里用 TypeScript 的 AST 取真实 import，不做文本匹配。
 *
 * 包清单直接枚举 packages/ 下的 package.json —— 不再多一份硬编码名单。
 *
 * 例外：**打包型**包（manifest 里有 `dsh` 字段）。它们的源码 import 全部在构建期被
 * 内联进自包含产物，而 manifest 必须**任何地方都不出现 `workspace:`** —— 它们是从
 * `github:…#path:` 直接安装的，工作区协议在仓库外解析不了（三个插件包的校验脚本各有一条
 * 断言把守这个不变量）。所以这类包整包跳过，而不是给它们补 devDependencies：
 * 试过补 `workspace:*`，立刻把那条断言打红了。
 */
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = fileURLToPath(new URL('..', import.meta.url))
const packagesDir = path.join(root, 'packages')

/** 收集一个文件里真实的模块说明符（含动态 import 与 re-export）。 */
function collectSpecifiers(fileName, source) {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const specifiers = []
  const visit = node => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      specifiers.push(node.moduleSpecifier.text)
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      specifiers.push(node.moduleSpecifier.text)
    } else if (ts.isCallExpression(node)
      && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments.length > 0
      && ts.isStringLiteral(node.arguments[0])) {
      specifiers.push(node.arguments[0].text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return specifiers
}

/** `@vobs/runtime/error` → `@vobs/runtime`。 */
function packageNameOf(specifier) {
  const parts = specifier.split('/')
  return parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0]
}

async function sourceFiles(directory) {
  const found = []
  const walk = async current => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
        continue
      }
      if (!/\.tsx?$/u.test(entry.name)) continue
      // 测试文件用的是 devDependencies，不在本门禁范围内（本门禁只保证可发布源码自洽）
      if (/\.test\.tsx?$/u.test(entry.name)) continue
      found.push(full)
    }
  }
  await walk(directory)
  return found
}

const problems = []
const skipped = []
let checked = 0

const entries = await readdir(packagesDir, { withFileTypes: true })
for (const entry of entries) {
  if (!entry.isDirectory()) continue
  const directory = path.join(packagesDir, entry.name)
  let manifest
  try {
    manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'))
  } catch {
    continue
  }
  const declared = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {})
  ])
  // 打包型包整包跳过（见文件头说明）
  if (manifest.dsh !== undefined) {
    skipped.push(manifest.name)
    continue
  }

  const srcDir = path.join(directory, 'src')
  let files
  try {
    files = await sourceFiles(srcDir)
  } catch {
    continue
  }

  const missing = new Map()
  for (const file of files) {
    const source = await readFile(file, 'utf8')
    for (const specifier of collectSpecifiers(file, source)) {
      if (!specifier.startsWith('@vobs/')) continue
      const name = packageNameOf(specifier)
      if (name === manifest.name) continue
      if (declared.has(name)) continue
      // 同一个缺失依赖只报一次，附第一个出现的位置
      if (!missing.has(name)) {
        missing.set(name, `${path.relative(root, file).split(path.sep).join('/')} (imports ${specifier})`)
      }
    }
  }

  checked += 1
  for (const [name, where] of missing) {
    problems.push(`${manifest.name}: 使用了 ${name} 但未在 dependencies / peerDependencies 中声明 — ${where}`)
  }
}

if (problems.length > 0) {
  console.error(`\n发现 ${problems.length} 处未声明的依赖：\n`)
  for (const problem of problems) console.error(`  ${problem}`)
  console.error('\n声明它们（通常用 workspace:*），否则严格 node_modules 布局下解析会失败。\n')
  process.exit(1)
}

const skipNote = skipped.length > 0 ? `（跳过 ${skipped.length} 个打包型包：${skipped.join(', ')}）` : ''
console.log(`✔ 依赖声明自洽 —— 检查了 ${checked} 个包的源码 import${skipNote}`)
