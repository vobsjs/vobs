#!/usr/bin/env node
/*
 * `vobs check --runtime` 的运行时护栏检查。
 *
 * 为什么需要它（.artifacts/B-direction.md 的实测证据）：
 * 静态分析（VOBS_C210）对**本仓库真实修过的 4 个自订阅**只抓到 **1 个** ——
 * 漏掉的三个都是"读或写跨过了函数边界"，而静态**无法知道调用上下文**
 * （`setBrand(v){ overrides.value = … }` 自己读+写同一信号并不构成自订阅，
 * 只有从 effect 内被调用时才是）。放宽规则会把合法 setter 全部误报。
 *
 * 运行时护栏则**真的知道**哪个 effect 在读哪个信号 —— 那 4 个案子全是它抓出来的。
 * 所以这里把护栏接进检查：起一个把收集器注入页面的 dev server，
 * 用真实 Chrome 逐路由打开，收回护栏报错，以退出码表达结论。
 *
 * 用法：
 *   node scripts/check-runtime.mjs [--root <dir>] [--routes <a,b,c>] [--port 5390] [--ignore <a,b>]
 *
 * `--ignore` 用于**已记录在案的已知问题**（例如 `.artifacts/KNOWN-BUGS.md` 里搁置的
 * `/devtools` 循环）。它必须是一条条显式写出来的路由，而不是"整体放宽" ——
 * 这样新出现的问题仍然会让检查变红，而已知问题不会淹没信号。
 *
 * 设计要点（都是本轮踩坑换来的，别改）：
 * - **必须把收集器注入被服务的页面**，不能从 file:// 父页用 iframe 读 contentWindow
 *   （父页 origin 为 null，同源策略会挡住）
 * - Chrome 必须给**独立 --user-data-dir**（否则命令被转交给已运行实例、静默不做我们的事）
 * - Chrome 参数必须拼成**单个字符串**（`Start-Process -ArgumentList @(数组)` 会拆散参数）
 */
import { createServer } from 'vite'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback
}

const root = resolve(flag('root', 'playground/basic'))
const port = Number(flag('port', '5390'))
const waitMs = Number(flag('wait', '2500'))

/** 默认从 playground 的路由文件里取路径；取不到就用首页。 */
function defaultRoutes() {
  const explicit = flag('routes', null)
  if (explicit) return explicit.split(',').map(route => route.trim()).filter(Boolean)
  const routerFile = join(root, 'src/router.ts')
  if (!existsSync(routerFile)) return ['/']
  const source = readFileSync(routerFile, 'utf8')
  const routes = [...source.matchAll(/path:\s*'([^']+)'/gu)].map(match => match[1])
  return routes.length > 0 ? [...new Set(routes)] : ['/']
}

const COLLECTOR = `<script>
(function () {
  var errors = [];
  function pub() {
    document.documentElement.setAttribute('data-guard-errors', JSON.stringify(errors.slice(0, 10)));
    document.documentElement.setAttribute('data-guard-stage', 'done');
  }
  function rec(kind, text) {
    errors.push(kind + ': ' + String(text).slice(0, 400));
    pub();
  }
  window.addEventListener('error', function (e) {
    rec('error', (e.message || '') + ' @ ' + String(e.filename || '').split('/').pop() + ':' + (e.lineno || 0));
  });
  window.addEventListener('unhandledrejection', function (e) {
    rec('rejection', (e.reason && (e.reason.message || e.reason)) || 'unknown');
  });
  var oe = console.error;
  console.error = function () {
    var p = [];
    for (var i = 0; i < arguments.length; i++) { var a = arguments[i]; p.push(a && a.message ? a.message : String(a)); }
    rec('console-error', p.join(' '));
    return oe.apply(console, arguments);
  };
  pub();
})();
</script>`

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ].filter(Boolean)
  return candidates.find(candidate => existsSync(candidate))
}

/** 用真实 Chrome 打开一个路由，取回注入收集器写进 DOM 的结果。 */
function openRoute(chrome, url, userDataDir) {
  return new Promise(resolvePromise => {
    // 参数拼成单个字符串：数组形式会被拆散（见文件头说明）
    const argLine = [
      '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
      `--user-data-dir=${userDataDir}`, '--virtual-time-budget=8000', '--dump-dom', url
    ].join(' ')
    const child = spawn(chrome, argLine.split(' '), { stdio: ['ignore', 'pipe', 'ignore'] })
    let out = ''
    child.stdout.on('data', chunk => { out += chunk })
    child.on('close', () => resolvePromise(out))
    child.on('error', () => resolvePromise(''))
  })
}

function decode(value) {
  return value.replace(/&quot;/gu, '"').replace(/&amp;/gu, '&').replace(/&lt;/gu, '<').replace(/&gt;/gu, '>')
}

const chrome = findChrome()
if (!chrome) {
  console.error('vobs check --runtime: 找不到 Chrome。设置 CHROME_PATH 环境变量指向可执行文件。')
  process.exit(2)
}

const routes = defaultRoutes()
const server = await createServer({
  root,
  server: { port, strictPort: true },
  logLevel: 'silent',
  plugins: [{
    name: 'vobs-check-runtime-collector',
    transformIndexHtml: {
      order: 'pre',
      handler: html => html.replace('</head>', COLLECTOR + '</head>')
    }
  }]
})
await server.listen()

const userDataDir = mkdtempSync(join(tmpdir(), 'vobs-check-'))
const failures = []
const ignored = new Set(
  flag('ignore', '').split(',').map(route => route.trim()).filter(Boolean)
)
const acknowledged = []
try {
  for (const route of routes) {
    const dom = await openRoute(chrome, `http://localhost:${port}${route}`, userDataDir)
    const stage = /data-guard-stage="([^"]*)"/u.exec(dom)
    const raw = /data-guard-errors="([^"]*)"/u.exec(dom)
    if (!stage) {
      failures.push({ route, errors: ['页面未就绪（收集器没跑起来；检查 dev server 是否正常）'] })
      continue
    }
    const errors = raw ? JSON.parse(decode(raw[1])) : []
    if (errors.length === 0) continue
    if (ignored.has(route)) acknowledged.push({ route, errors })
    else failures.push({ route, errors })
  }
} finally {
  await server.close()
  try { rmSync(userDataDir, { recursive: true, force: true }) } catch { /* 临时目录清理失败不影响结论 */ }
}

if (failures.length === 0) {
  const suffix = acknowledged.length > 0
    ? `（另有 ${acknowledged.length} 条已记录的已知问题被 --ignore 放行：${acknowledged.map(item => item.route).join(', ')}）`
    : ''
  console.log(`vobs check --runtime: ${routes.length} 条路由无护栏报错${suffix}`)
  process.exit(0)
}

console.error(`vobs check --runtime: ${failures.length}/${routes.length} 条路由有护栏报错\n`)
for (const failure of failures) {
  console.error(`  ${failure.route}`)
  for (const error of failure.errors) console.error(`    ${error}`)
}
console.error('\n这些是**运行期**才能观察到的问题（自订阅 / 循环 / 未捕获异常）。')
console.error('静态分析看不到它们：读或写跨过函数边界时，调用上下文只有运行期才知道。')
process.exit(1)
