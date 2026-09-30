/**
 * 校验 Vobs Console 的**已构建产物**在 DSH 客户端模块协议下的真实行为。
 *
 * 覆盖：
 *   1. dsh 清单与 exports 自洽
 *   2. Host 半侧是合法 cordis 插件
 *   3. lib/client.js 只注册 factory，执行它不产生副作用
 *   4. factory 物化后拿到插件；apply() 同时注册 main（keyed）与 sidebar.panellist
 *   5. 面板挂载：shadow root + 整页 vobs 渲染
 *   6. 真实交互：tab 切换、事件流过滤、暂停丢弃、工具聚合增量更新
 *   7. 清理：shadow root 清空、演示定时器停止
 *
 * 运行：node packages/dsh-console/scripts/verify-console.mjs
 */
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { JSDOM } from 'jsdom'

const here = path.dirname(fileURLToPath(import.meta.url))
const packageDir = path.resolve(here, '..')

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
const resolveFromPackage = relative => path.join(packageDir, String(relative).replace(/^\.\//u, ''))

/* ---------------------------------------------------------- 1. 包清单自洽 */

section('1. dsh 清单')
const manifest = JSON.parse(await readFile(path.join(packageDir, 'package.json'), 'utf8'))
const dsh = manifest.dsh ?? {}
check('包名合法', /^[a-z0-9][a-z0-9._~-]*$/u.test(manifest.name), manifest.name)
check('dsh.bundle.patch 已声明', typeof dsh.bundle?.patch === 'string')
check('dsh.client.platform 为 web', dsh.client?.platform === 'web')
check('没有安装期生命周期钩子', manifest.scripts?.prepare === undefined && manifest.scripts?.postinstall === undefined)
check(
  '没有 workspace: 协议依赖',
  !JSON.stringify({
    dependencies: manifest.dependencies,
    peerDependencies: manifest.peerDependencies,
    devDependencies: manifest.devDependencies
  }).includes('workspace:')
)

const patchText = await readFile(resolveFromPackage(dsh.bundle.patch), 'utf8')
check('patch 里 insert 了本包', patchText.includes('insert:') && patchText.includes(manifest.name))
check('patch 不做顶层 id 覆盖', !/^-\s*id:/mu.test(patchText))

const hostPath = resolveFromPackage(manifest.exports['.'])
const clientPath = resolveFromPackage(manifest.exports['./client'])
check('exports["."] 存在', await fileExists(hostPath))
check('exports["./client"] 存在', await fileExists(clientPath))

/* --------------------------------------------------------- 2. Host 半侧 */

section('2. Host 半侧')
const host = await import(pathToFileURL(hostPath).href)
check('导出非空 name', typeof host.name === 'string' && host.name.length > 0, String(host.name))
check('导出 apply 函数', typeof host.apply === 'function')
host.apply({})

/* ------------------------------------------------------- 3. bundle 形态 */

section('3. Client bundle')
const bundleCode = await readFile(clientPath, 'utf8')
check('只调用一次 __ModuleLoader__.load', (bundleCode.match(/__ModuleLoader__\.load\(/gu) ?? []).length === 1)
const requires = bundleCode.match(/require\((['"])[^'"]+\1\)/gu) ?? []
check('同步 require 只指向平台模块', requires.length > 0 && requires.every(call => call.includes('react')), requires.join(','))
check('没有动态 import', !bundleCode.includes('import('))

const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
  runScripts: 'outside-only',
  pretendToBeVisual: true,
  url: 'http://127.0.0.1/'
})

// 截获演示定时器，让校验可以确定性地推进时间轴，而不是等真实 900ms。
const intervals = []
dom.window.setInterval = (fn) => {
  intervals.push(fn)
  return intervals.length
}
dom.window.clearInterval = () => {}

const registry = new Map()
let loadCalls = 0
dom.window.__ModuleLoader__ = {
  load(entry) {
    loadCalls += 1
    registry.set(entry.id, entry.factory)
  }
}
dom.window.eval(bundleCode)

check('注册了 factory', registry.has(manifest.name), [...registry.keys()].join(','))
check('执行 bundle 不产生模块副作用', loadCalls === 1 && dom.window.document.body.childNodes.length === 0)

/* --------------------------------------------------- 4. 物化与 slot 注册 */

section('4. slot 注册')
const injectCalls = []
const hostEffects = []
const pluginEffects = []
const registered = []
const requireStub = id => {
  if (id === 'react') return createReactStub(hostEffects)
  throw new Error(`verify: 产物 require 了非平台模块 ${id}`)
}

const plugin = registry.get(manifest.name)(requireStub)
check('factory 直接返回插件对象', typeof plugin?.apply === 'function')
check('插件 inject 了 slots', Array.isArray(plugin.inject) && plugin.inject.includes('slots'))

plugin.apply({
  slots: {
    inject(name, callback) {
      injectCalls.push(name)
      callback()
    },
    register(options, component) {
      registered.push({ options, component })
      return () => {}
    }
  },
  effect(callback) {
    pluginEffects.push(callback)
  },
  get() {
    return undefined
  }
})

check('注册了两个 slot', injectCalls.join(',') === 'main,sidebar.panellist', injectCalls.join(','))
const panelReg = registered.find(item => item.options.name === 'main')
const entryReg = registered.find(item => item.options.name === 'sidebar.panellist')
check('main 用 key 认领', panelReg?.options.key === 'vobs-console', JSON.stringify(panelReg?.options))
check('sidebar.panellist 用同值 id 关联', entryReg?.options.id === 'vobs-console', JSON.stringify(entryReg?.options))
check('侧栏入口标签为 Vobs Console', entryReg?.options.label === 'Vobs Console', String(entryReg?.options.label))
check('侧栏入口标签与面板标题一致', entryReg?.options.label === panelReg?.options.label, `${entryReg?.options.label} / ${panelReg?.options.label}`)
check('同时注册了入口图标组件', typeof entryReg?.component === 'function')
check('演示定时器已启动', intervals.length === 1)

/* ------------------------------------------------------------ 5. 面板渲染 */

section('5. 面板渲染')
const tree = panelReg.component()
const hostElement = dom.window.document.createElement('div')
tree.props.ref.current = hostElement
dom.window.document.body.appendChild(hostElement)

// 跑宿主 effect（把 vobs 挂进 shadow root）
const hostCleanups = []
for (const effect of hostEffects) {
  const cleanup = effect()
  if (typeof cleanup === 'function') hostCleanups.push(cleanup)
}

const shadow = hostElement.shadowRoot
check('宿主元素上有 shadow root', !!shadow)
check('.vc 面板已挂载', !!shadow?.querySelector('.vc'))
check('渲染出标题', (shadow?.textContent ?? '').includes('Vobs Console'))
check('未探测到服务时标注为演示数据', (shadow?.textContent ?? '').includes('演示数据'))

const kpiValue = index => shadow.querySelectorAll('.vc-kpi__value')[index]?.textContent?.trim()
check('运行中会话数来自数据源', kpiValue(0) === '3', String(kpiValue(0)))
check('等待审批数正确', kpiValue(1) === '1', String(kpiValue(1)))
check('会话总数正确', kpiValue(2) === '8', String(kpiValue(2)))
check('没有工具事件时显示为 —', kpiValue(3) === '—', String(kpiValue(3)))
check('会话列表渲染了 8 行', shadow.querySelectorAll('.vc-session').length === 8, String(shadow.querySelectorAll('.vc-session').length))

/* ------------------------------------------------------ 6. 事件流与交互 */

section('6. 事件流入库与交互')
const advance = steps => {
  for (let index = 0; index < steps; index += 1) intervals[0]?.()
}

advance(60)
await tick()

const tabByText = label => [...shadow.querySelectorAll('.vc-tab')].find(tab => tab.textContent.trim().startsWith(label))
check('总览的最近事件有内容', shadow.querySelectorAll('.vc-ev').length > 0, String(shadow.querySelectorAll('.vc-ev').length))
check('工具 Top5 渲染了 5 条', shadow.querySelectorAll('.vc-bar').length === 5, String(shadow.querySelectorAll('.vc-bar').length))
check('工具调用 KPI 增长', Number(kpiValue(3)) > 0, String(kpiValue(3)))

// 切到事件流
tabByText('事件流').click()
await tick()
check('切到事件流后出现工具条', !!shadow.querySelector('.vc-toolbar'))
const streamRows = () => shadow.querySelectorAll('.vc-card .vc-ev').length
const before = streamRows()
check('事件流行数 > 0', before > 0, String(before))
check('流计数徽标存在', /事件流\s*\d+/u.test(shadow.textContent ?? ''))

// 过滤
const input = shadow.querySelector('.vc-input')
input.value = 'pwsh'
input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
await tick()
const filtered = streamRows()
check('过滤后行数减少且仍有内容', filtered > 0 && filtered < before, `${filtered} / ${before}`)
const filteredTexts = [...shadow.querySelectorAll('.vc-card .vc-ev')].map(row => row.textContent.toLowerCase())
check('过滤结果都含关键字', filteredTexts.length > 0 && filteredTexts.every(text => text.includes('pwsh')))

input.value = ''
input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
await tick()
check('清空过滤后行数恢复', streamRows() === before, `${streamRows()} / ${before}`)

// 暂停：暂停期间 tick 不再入库
const pauseButton = [...shadow.querySelectorAll('.vc-btn')].find(button => button.textContent.includes('暂停'))
pauseButton.click()
await tick()
const frozen = streamRows()
advance(40)
await tick()
check('暂停期间不新增行', streamRows() === frozen, `${streamRows()} / ${frozen}`)
check('界面报告被丢弃的条数', /已暂停 · 丢弃\s*[1-9]\d*\s*条/u.test(shadow.textContent ?? ''), shadow.textContent?.match(/已暂停[^，。]*/u)?.[0] ?? '')

const resumeButton = [...shadow.querySelectorAll('.vc-btn')].find(button => button.textContent.includes('继续'))
resumeButton.click()
await tick()
advance(1)
await tick()
check('继续后恢复入库', streamRows() > frozen, `${streamRows()} / ${frozen}`)

// 工具分析
tabByText('工具分析').click()
await tick()
const rows = shadow.querySelectorAll('.vc-table tbody tr').length
check('工具表有行', rows > 0, String(rows))
check('工具表出现 pwsh', (shadow.textContent ?? '').includes('pwsh'))
check('P95 KPI 已计算', (shadow.querySelectorAll('.vc-kpi__value')[3]?.textContent ?? '').trim().length > 0)
check('趋势线渲染为 path', shadow.querySelectorAll('.vc-spark path').length === rows, `${shadow.querySelectorAll('.vc-spark path').length} / ${rows}`)

// 产物
tabByText('产物').click()
await tick()
check('产物 tab 可渲染', !!shadow.querySelector('.vc-card'))

// 收起后回到总览
tabByText('总览').click()
await tick()
check('可以切回总览', shadow.querySelectorAll('.vc-kpi__value').length === 4)

/* ------------------------------------------------ 8. 切到 DSH 真实数据源 */

section('8. 切换到 DSH 真实数据源')
let listSnapshot = {
  ids: ['real-a', 'real-b'],
  byId: {
    'real-a': { sessionId: 'real-a', title: '真实会话 A', running: true, updatedAt: 9_000 },
    'real-b': { sessionId: 'real-b', title: '真实会话 B', running: false, updatedAt: 8_000 }
  }
}
let statusMap = new Map()
const listListeners = new Set()
const statusListeners = new Set()

const livePluginEffects = []
plugin.apply({
  slots: {
    inject(name, callback) {
      callback()
    },
    register() {
      return () => {}
    }
  },
  effect(callback) {
    livePluginEffects.push(callback)
  },
  get(name) {
    if (name === 'sessions') {
      return {
        list: {
          getSnapshot: () => listSnapshot,
          subscribe: listener => {
            listListeners.add(listener)
            return () => listListeners.delete(listener)
          }
        }
      }
    }
    if (name === 'uiSession') {
      return {
        sessionStatus: {
          getSnapshot: () => statusMap,
          subscribe: listener => {
            statusListeners.add(listener)
            return () => statusListeners.delete(listener)
          }
        }
      }
    }
    return undefined
  }
})
await tick()

check('插件注册了会话目录订阅', listListeners.size === 1 && statusListeners.size === 1, `${listListeners.size}/${statusListeners.size}`)
check('徽标切换为 DSH 实时数据', (shadow.textContent ?? '').includes('DSH 实时数据'))
check('演示数据的会话被真实列表替换', (shadow.textContent ?? '').includes('真实会话 A') && !(shadow.textContent ?? '').includes('KitSidebar 菜单钉靠'))
check('会话行数来自真实列表', shadow.querySelectorAll('.vc-session').length === 2, String(shadow.querySelectorAll('.vc-session').length))
check('运行中会话数来自真实状态', kpiValue(0) === '1', String(kpiValue(0)))
check('演示事件被清空', (shadow.textContent ?? '').includes('工具调用') && kpiValue(3) === '—', String(kpiValue(3)))

// 真实状态变化 → 事件流
tabByText('事件流').click()
await tick()
const liveBefore = streamRows()

statusMap = new Map([['real-b', { running: true }]])
for (const listener of statusListeners) listener()
await tick()

check('真实状态变化产生事件', streamRows() > liveBefore, `${streamRows()} / ${liveBefore}`)
check('事件类型是 turn/start', [...shadow.querySelectorAll('.vc-ev__kind')].some(node => node.textContent.includes('turn/start')))

// 清理真实源
for (const effect of livePluginEffects) {
  const disposer = effect()
  if (typeof disposer === 'function') disposer()
}
check('真实源清理后退订', listListeners.size === 0 && statusListeners.size === 0, `${listListeners.size}/${statusListeners.size}`)

/* ------------------------------------------------------------- 9. 清理 */

section('9. 清理')
for (const effect of pluginEffects) {
  const disposer = effect()
  if (typeof disposer === 'function') disposer()
}
for (const cleanup of hostCleanups) cleanup()
check('清理后 shadow root 已清空', (hostElement.shadowRoot?.childNodes.length ?? -1) === 0)

console.log(`\n${checks - failures}/${checks} 项通过`)
if (failures > 0) {
  console.error(`${failures} 项失败`)
  process.exitCode = 1
}

/** 极小的 React 桩：宿主组件只用 createElement / useRef / useEffect。 */
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
