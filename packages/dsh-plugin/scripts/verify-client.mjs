/**
 * 校验**已构建产物**（不是源码）在 DSH 客户端模块系统下的真实行为。
 *
 * 覆盖链路：
 *   1. package.json 的 dsh 清单（bundle.patch / client.platform / exports 指向的文件都在）
 *   2. cordis.patch.yml 插入了指向本包的行，且不覆盖官方行
 *   3. lib/index.js 是合法的 Host 侧 cordis 插件
 *   4. lib/client.js 只注册 factory，执行 bundle 本身不产生副作用
 *   5. factory 物化后拿到插件对象，apply() 把组件注册进 shell.overlay slot
 *   6. React 宿主挂载后：shadow root 里有 vobs 渲染的面板
 *   7. vobs 的响应式行为：组件体只执行一次、信号驱动更新、insertList 增删行
 *   8. effect 清理后 shadow root 被清空
 *
 * 运行：node scripts/verify-client.mjs（或 pnpm --filter dsh-plugin verify）
 */
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { JSDOM } from 'jsdom'

const here = path.dirname(fileURLToPath(import.meta.url))
const pluginDir = path.resolve(here, '..')

let failures = 0
let checks = 0

const check = (label, condition, detail = '') => {
  checks += 1
  if (condition) console.log(`  ok   ${label}`)
  else {
    failures += 1
    console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const section = title => console.log(`\n${title}`)
const tick = () => new Promise(resolve => setTimeout(resolve, 0))

const fileExists = async target => {
  try {
    await stat(target)
    return true
  } catch {
    return false
  }
}

const resolveFromPackage = relative => path.join(pluginDir, String(relative).replace(/^\.\//u, ''))

/* ------------------------------------------------- 1. 包清单与 patch 层自洽 */

section('1. dsh 清单')
const manifest = JSON.parse(await readFile(path.join(pluginDir, 'package.json'), 'utf8'))
const dsh = manifest.dsh ?? {}

check('包名合法', /^[a-z0-9][a-z0-9._~-]*$/u.test(manifest.name), manifest.name)
check('dsh.bundle.patch 已声明', typeof dsh.bundle?.patch === 'string', JSON.stringify(dsh.bundle))
check('dsh.client.platform 为 web', dsh.client?.platform === 'web', String(dsh.client?.platform))
check(
  'dsh.client 只用官方字段',
  Object.keys(dsh.client ?? {}).every(key => ['platform', 'inject', 'external', 'immediately'].includes(key)),
  Object.keys(dsh.client ?? {}).join(',')
)

const patchPath = resolveFromPackage(dsh.bundle.patch)
check('patch 文件存在', await fileExists(patchPath), path.relative(pluginDir, patchPath))

const patchText = await readFile(patchPath, 'utf8')
check('patch 里 insert 了本包', patchText.includes('insert:') && patchText.includes(manifest.name))
check('patch 不做顶层 id 覆盖（只追加自己的行）', !/^-\s*id:/mu.test(patchText))

const hostPath = resolveFromPackage(manifest.exports['.'])
const clientPath = resolveFromPackage(manifest.exports['./client'])
check('exports["."] 指向的文件存在', await fileExists(hostPath), path.relative(pluginDir, hostPath))
check('exports["./client"] 指向的文件存在', await fileExists(clientPath), path.relative(pluginDir, clientPath))
check(
  '没有安装期生命周期钩子（DSH 不做构建）',
  manifest.scripts?.prepare === undefined && manifest.scripts?.postinstall === undefined
)
check(
  '没有 workspace: 协议依赖（GitHub path: 直装必须自包含）',
  !JSON.stringify({
    dependencies: manifest.dependencies,
    peerDependencies: manifest.peerDependencies,
    devDependencies: manifest.devDependencies
  }).includes('workspace:')
)

/* ------------------------------------------------------- 2. Host 侧插件可加载 */

section('2. Host 半侧')
const host = await import(pathToFileURL(hostPath).href)
check('导出非空 name', typeof host.name === 'string' && host.name.length > 0, String(host.name))
check('导出 apply 函数', typeof host.apply === 'function')
check('inject 是数组', Array.isArray(host.inject))
host.apply({})

/* ----------------------------------------------- 3. Client 侧 bundle 与运行时 */

section('3. Client 半侧：factory 注册')
const bundleCode = await readFile(clientPath, 'utf8')
check(
  '只调用一次 __ModuleLoader__.load',
  (bundleCode.match(/__ModuleLoader__\.load\(/gu) ?? []).length === 1
)
check('react 保持外置', bundleCode.includes('require("react")') && !bundleCode.includes('react-dom'))
const requires = bundleCode.match(/require\((['"])[^'"]+\1\)/gu) ?? []
check('同步 require 只指向平台模块', requires.length > 0 && requires.every(call => call.includes('react')), requires.join(','))
check('没有动态 import（DSH 只支持自包含 chunk）', !bundleCode.includes('import('))

const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
  runScripts: 'outside-only',
  pretendToBeVisual: true,
  url: 'http://127.0.0.1/'
})

const registry = new Map()
let loadCalls = 0
dom.window.__ModuleLoader__ = {
  load(entry) {
    loadCalls += 1
    registry.set(entry.id, entry.factory)
  }
}

// 直接在 jsdom realm 内执行 bundle：window / document / getComputedStyle 都是原生的。
dom.window.eval(bundleCode)

check('注册了 factory', registry.has(manifest.name), [...registry.keys()].join(','))
check(
  '执行 bundle 只注册 factory，不产生模块副作用',
  loadCalls === 1 && dom.window.document.body.childNodes.length === 0,
  `loadCalls=${loadCalls} body=${dom.window.document.body.childNodes.length}`
)

section('4. Client 半侧：物化与 slot 注册')
const injectCalls = []
const reactEffects = []
let slotRegistration = null
const requireStub = id => {
  if (id === 'react') return createReactStub(reactEffects)
  throw new Error(`verify: 产物 require 了非平台模块 ${id}`)
}

const plugin = registry.get(manifest.name)(requireStub)
check('factory 直接返回插件对象', typeof plugin === 'object' && plugin !== null && typeof plugin.apply === 'function')
check('插件 inject 了 slots', Array.isArray(plugin.inject) && plugin.inject.includes('slots'))

plugin.apply({
  slots: {
    inject(name, callback) {
      injectCalls.push(name)
      return callback()
    },
    register(options, component) {
      slotRegistration = { options, component }
      return () => {}
    }
  }
})

check('注册到了 shell.overlay', injectCalls[0] === 'shell.overlay', injectCalls.join(','))
check(
  'slot 选项正确',
  slotRegistration?.options?.name === 'shell.overlay' && slotRegistration?.options?.id === 'vobs-panel',
  JSON.stringify(slotRegistration?.options)
)
check('注册的是组件', typeof slotRegistration?.component === 'function')

section('5. React 宿主 + vobs 渲染')
const tree = slotRegistration.component()
const hostElement = dom.window.document.createElement('div')
tree.props.ref.current = hostElement
dom.window.document.body.appendChild(hostElement)

const cleanups = []
for (const effect of reactEffects) {
  const cleanup = effect()
  if (typeof cleanup === 'function') cleanups.push(cleanup)
}

const shadow = hostElement.shadowRoot
check('宿主元素上有 shadow root', !!shadow)
check('shadow root 里有 <style> 与面板根', !!shadow?.querySelector('style') && !!shadow?.querySelector('.vobs-dsh-root'))
check('.vobs-panel 已渲染', !!shadow?.querySelector('.vobs-panel'))

const text = shadow?.textContent ?? ''
// 版本号由构建期的 define 注入，每次发版都会变 —— 从产物里读出它自己内嵌的值来断言，
// 而不是在脚本里写死一个版本（写死会在 bump 版本时变成假失败）。
const embeddedVersion = /VOBS_VERSION\s*=\s*`v\$\{("([^"]+)")\}`/u.exec(bundleCode)?.[2]
check('产物里带构建期注入的版本号', typeof embeddedVersion === 'string' && /^\d+\.\d+\.\d+/u.test(embeddedVersion), String(embeddedVersion))
check('界面渲染出这个版本号', embeddedVersion !== undefined && text.includes(`v${embeddedVersion}`), text.slice(0, 140))
check('渲染出标语', text.includes('Signals First'))

const statValue = index => shadow.querySelectorAll('.vobs-stat__value')[index]?.textContent?.trim()
const byText = (selector, label) =>
  [...shadow.querySelectorAll(selector)].find(node => node.textContent.trim() === label)

check('组件体执行次数 = 1（run-once）', statValue(0) === '1', String(statValue(0)))
check('初始 count = 0', statValue(2) === '0', String(statValue(2)))
check('初始 memo 派生值 = 0', statValue(3) === '0', String(statValue(3)))

section('6. 响应式：信号更新不重跑组件体')
shadow.querySelector('.vobs-btn--primary').click()
shadow.querySelector('.vobs-btn--primary').click()
await tick()

check('count 累加到 2', statValue(2) === '2', String(statValue(2)))
check('memo ×2 跟随到 4', statValue(3) === '4', String(statValue(3)))
check(
  '同一 tick 内两次写入被合并，effect 只重跑 1 次（脏值去重 + 微任务批刷新）',
  statValue(1) === '2',
  `effect 执行 ${statValue(1)} 次`
)
check('组件体执行次数仍是 1', statValue(0) === '1', String(statValue(0)))

byText('.vobs-btn', '−1').click()
await tick()
check('−1 生效，count 回到 1', statValue(2) === '1', String(statValue(2)))
check('memo 回到 2', statValue(3) === '2', String(statValue(3)))
check('新 tick 的写入独立触发一次 effect', statValue(1) === '3', String(statValue(1)))

section('7. insertList：标签列表增删')
const input = shadow.querySelector('.vobs-input')
input.value = 'dsh'
input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
await tick()
byText('.vobs-btn', '添加').click()
await tick()

const chipTexts = () => [...shadow.querySelectorAll('.vobs-chip')].map(chip => chip.firstChild.textContent.trim())
check('新增标签进入列表', chipTexts().includes('dsh'), chipTexts().join('|'))
check('原有两项仍在', chipTexts().includes('signals') && chipTexts().includes('run-once'), chipTexts().join('|'))
check('输入框已清空', input.value === '', input.value)
check('组件体执行次数仍是 1', statValue(0) === '1', String(statValue(0)))

const dshChip = [...shadow.querySelectorAll('.vobs-chip')].find(chip => chip.textContent.includes('dsh'))
dshChip.querySelector('.vobs-chip__remove').click()
await tick()
check('移除标签生效', !chipTexts().includes('dsh'), chipTexts().join('|'))

for (const chip of [...shadow.querySelectorAll('.vobs-chip')]) {
  chip.querySelector('.vobs-chip__remove').click()
  await tick()
}
check('清空后走空态分支', !!shadow.querySelector('.vobs-empty'), shadow.querySelector('.vobs-chips')?.innerHTML ?? '')

section('8. 交互与清理')
byText('.vobs-btn--icon', '–').click()
await tick()
check('收起后 body 消失', !shadow.querySelector('.vobs-panel__body'))

byText('.vobs-btn--icon', '+').click()
await tick()
check('展开后 body 回来', !!shadow.querySelector('.vobs-panel__body'))

shadow.querySelector('[title="收起为角标"]').click()
await tick()
check('隐藏后只剩角标', !shadow.querySelector('.vobs-panel') && !!shadow.querySelector('.vobs-badge'))

shadow.querySelector('.vobs-badge').click()
await tick()
check('角标点击可恢复面板', !!shadow.querySelector('.vobs-panel'))
check('整段交互后组件体仍未重跑', statValue(0) === '1', String(statValue(0)))

for (const cleanup of cleanups) cleanup()
check('清理后 shadow root 已清空', (hostElement.shadowRoot?.childNodes.length ?? -1) === 0)

/* ------------------------------------------------------------------- 结果 */

console.log(`\n${checks - failures}/${checks} 项通过`)
if (failures > 0) {
  console.error(`${failures} 项失败`)
  process.exitCode = 1
}

/**
 * 极小的 React 桩：本插件的宿主组件只用 createElement / useRef / useEffect。
 * 校验脚本按 React 的 commit 顺序手动执行 effect（ref 赋值之后）。
 */
function createReactStub(effects) {
  return {
    createElement(type, props) {
      return { type, props: props ?? {} }
    },
    useRef(initial) {
      return { current: initial }
    },
    useEffect(effect) {
      effects.push(effect)
    }
  }
}
