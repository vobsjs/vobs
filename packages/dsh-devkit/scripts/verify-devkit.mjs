/**
 * 校验 Vobs 开发台的**已构建产物**在 DSH 客户端模块协议下的真实行为。
 *
 * 覆盖：
 *   1. dsh 清单与 exports 自洽
 *   2. Host 半侧是合法 cordis 插件
 *   3. lib/client.js 只注册 factory，执行它不产生副作用
 *   4. factory 物化后拿到插件；apply() 注册 main（keyed）与 sidebar.panellist
 *   5. 面板挂载：shadow root + 整页 vobs 渲染 + 五个 tab
 *   6. 「项目」页：没有服务时如实说明；接上假服务后真的渲染出报告内容
 *   7. 其余页面与真实交互：切 tab、切 API 条目
 *   8. 侧栏图标自带尺寸
 *   9. 清理：effect 清理后 shadow root 被清空
 *
 * 运行：node packages/dsh-devkit/scripts/verify-devkit.mjs
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
const settle = async (times = 3) => { for (let i = 0; i < times; i += 1) await tick() }
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
check('不声明任何依赖（产物必须自包含）', manifest.dependencies === undefined)

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
check('样式已内联进产物', bundleCode.includes('.vk-root'))

const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
  runScripts: 'outside-only',
  pretendToBeVisual: true,
  url: 'http://127.0.0.1/'
})

// 拦下定时器：轮询不该在校验期间真的跑，但节拍要能手动推进
const intervals = []
dom.window.setInterval = fn => {
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
const registered = []
const requireStub = id => {
  if (id === 'react') return createReactStub(hostEffects)
  throw new Error(`verify: 产物 require 了非平台模块 ${id}`)
}

const plugin = registry.get(manifest.name)(requireStub)
check('factory 直接返回插件对象', typeof plugin?.apply === 'function')
check('inject 了 slots', Array.isArray(plugin.inject) && plugin.inject.includes('slots'))
check(
  '还 inject 了 sessions 与 remote（读工作区要用）',
  plugin.inject.includes('sessions') && plugin.inject.includes('remote'),
  plugin.inject.join(',')
)

/** 第一轮：什么服务都没有 —— 面板应当如实说明，而不是假装有数据。 */
const cleanups = []
const applyWith = ctx => {
  const dispose = plugin.apply(ctx)
  if (typeof dispose === 'function') cleanups.push(dispose)
}
applyWith({
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
  effect() {},
  get() {
    return undefined
  }
})

check('注册了两个 slot', injectCalls.join(',') === 'main,sidebar.panellist', injectCalls.join(','))
const panelReg = registered.find(item => item.options.name === 'main')
const entryReg = registered.find(item => item.options.name === 'sidebar.panellist')
check('main 用 key 认领', panelReg?.options.key === 'vobs-devkit', JSON.stringify(panelReg?.options))
check('sidebar.panellist 用同值 id 关联', entryReg?.options.id === 'vobs-devkit', JSON.stringify(entryReg?.options))
check('侧栏标签为 Vobs 开发台', entryReg?.options.label === 'Vobs 开发台', String(entryReg?.options.label))
check('侧栏标签与面板标签一致', entryReg?.options.label === panelReg?.options.label, `${entryReg?.options.label} / ${panelReg?.options.label}`)
check('同时注册了入口图标组件', typeof entryReg?.component === 'function')

/* ------------------------------------------------------------ 5. 面板渲染 */

section('5. 面板渲染')
const tree = panelReg.component()
const hostElement = dom.window.document.createElement('div')
tree.props.ref.current = hostElement
dom.window.document.body.appendChild(hostElement)

const hostCleanups = []
for (const effect of hostEffects) {
  const cleanup = effect()
  if (typeof cleanup === 'function') hostCleanups.push(cleanup)
}

const shadow = hostElement.shadowRoot
check('宿主元素上有 shadow root', !!shadow)
/*
 * 挂载容器必须填满宿主 —— 否则 `height: 100%` 的父级是 auto 高度，percent 高度退化成
 * auto，面板内部的滚动容器（`.vk-body { overflow: auto }`）永远不触发：长页面被外层裁掉，
 * 现象就是「示例页不能滚动」。
 */
const rootDiv = shadow?.querySelector('.vobs-dsh-root')
check(
  '挂载容器填满宿主（height: 100%）',
  rootDiv?.style.height === '100%' && rootDiv?.style.width === '100%',
  rootDiv?.getAttribute('style') ?? '(无 style)'
)
check('.vk-root 已挂载', !!shadow?.querySelector('.vk-root'))
check('渲染出标题', (shadow?.textContent ?? '').includes('Vobs 开发台'))
check('标签标记了 vobs 渲染', (shadow?.textContent ?? '').includes('vobs 渲染'))

const tabLabels = () => [...shadow.querySelectorAll('.vk-tab')].map(node => node.textContent.trim())
check('渲染了五个 tab', shadow.querySelectorAll('.vk-tab').length === 5, tabLabels().join(','))
check('tab 名称正确', tabLabels().join(',') === '项目,护栏,API,示例,状态', tabLabels().join(','))
check('默认停在项目页', shadow.querySelector('.vk-tab--active')?.textContent.trim() === '项目')

/* -------------------------------------------------------------- 6. 项目页 */

section('6. 项目页')
const text = () => shadow.textContent ?? ''
await settle()
check('没有服务时如实说明（不假装有数据）', text().includes('读不到'), text().slice(0, 120))

// 接上假服务：一个会话 + 一个能读工作区文件的 remote
const report = {
  root: 'C:/demo',
  files: 12,
  skippedTests: 1,
  diagnostics: [
    {
      code: 'VOBS_C210',
      severity: 'error',
      message: 'effect 写入了它自己依赖的信号 "count"',
      fix: '把这次写入包进 untrack',
      file: 'src/components/Counter.tsx',
      line: 12,
      column: 5,
      snippet: 'count.value++'
    }
  ]
}
let fileVersion = 1
let readCount = 0
const workspaceFiles = {
  async stat() {
    return { version: fileVersion }
  },
  async readBytes(_sessionId, target) {
    readCount += 1
    if (target !== '.vobs/check.json') throw new Error('lookup-not-found')
    return new TextEncoder().encode(JSON.stringify(report))
  }
}

const secondRegistered = []
applyWith({
  slots: {
    inject(_name, callback) { callback() },
    register(options, component) {
      secondRegistered.push({ options, component })
      return () => {}
    }
  },
  effect() {},
  get(name) {
    if (name === 'sessions') {
      return {
        list: {
          getSnapshot: () => ({
            byId: {
              s1: { sessionId: 's1', title: 'demo', cwd: 'C:/demo', updatedAt: 100 },
              s2: { sessionId: 's2', title: '旧会话', cwd: 'C:/old', updatedAt: 1 }
            }
          })
        }
      }
    }
    if (name === 'remote') return { workspaceFiles }
    return undefined
  }
})
await settle()

check('读到了报告（真的走了 remote.workspaceFiles）', readCount > 0, String(readCount))
check('显示了会话的工作区', text().includes('C:/demo'), text().slice(0, 160))
check('渲染出问题条目的错误码', text().includes('VOBS_C210'))
check('渲染出问题描述', text().includes('effect 写入了它自己依赖的信号'))
check('渲染出 文件:行:列', text().includes('src/components/Counter.tsx:12:5'))
check('渲染出出错行原文', text().includes('count.value++'))
check('渲染出修复建议', text().includes('untrack'))
check('汇总显示文件数与错误数', text().includes('12 个文件') && text().includes('1 个错误'))
check('汇总显示跳过的测试文件', text().includes('跳过 1 个测试文件'))

// 轮询：版本变了才重读
const before = readCount
fileVersion = 2
const poll = intervals.at(-1)
check('轮询定时器已注册', typeof poll === 'function')
await poll?.()
await settle()
check('文件版本变化会重读', readCount > before, `${before} -> ${readCount}`)

const stable = readCount
await poll?.()
await settle()
check('版本没变就不重读（轮询是廉价的）', readCount === stable, `${stable} -> ${readCount}`)

/* --------------------------------------------------- 7. 其余页面与交互 */

section('7. 其余页面与交互')
const clickTab = async label => {
  const tab = [...shadow.querySelectorAll('.vk-tab')].find(node => node.textContent.includes(label))
  tab.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  await settle(2)
}

await clickTab('护栏')
check('护栏页列出 VOBS_C210', text().includes('VOBS_C210'))
check('护栏页给出正确写法', text().includes('untrack'))
check('护栏页含前后写法对照', shadow.querySelectorAll('.vk-code--bad').length === 2 && shadow.querySelectorAll('.vk-code--good').length === 2)
check('声明了「只报告、不中断」', text().includes('只报告、不中断'))

await clickTab('API')
check('API 页列出分组', ['响应式', 'DSH 插件', '编译器', '开发期护栏'].every(group => text().includes(group)))
check('默认展示 state 的签名', text().includes('state<T>(initialValue: T'))
const target = [...shadow.querySelectorAll('.vk-api__item')].find(node => node.textContent.trim() === 'defineDshPanel')
target.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
await settle(2)
check('点击后详情切到 defineDshPanel', text().includes('defineDshPanel(options: DshPanelOptions'))
check('详情带所属包', text().includes('@vobs/dsh'))

await clickTab('示例')
check('示例页有写法卡片', shadow.querySelectorAll('.vk-pattern').length >= 6, String(shadow.querySelectorAll('.vk-pattern').length))
check('示例代码是真实可复制的 vobs 写法', text().includes("import { state } from '@vobs/vobs'"))

await clickTab('状态')
check('状态页如实标注未做项', text().includes('未做'))
check('状态页说明面板为何是静态的', text().includes('不是同一个页面'))

await clickTab('项目')
check('切回项目页仍是刚读到的报告', text().includes('VOBS_C210'))

/* ----------------------------------------------------------- 8. 侧栏图标 */

section('8. 侧栏图标')
const iconEffectsFrom = hostEffects.length
const iconTree = entryReg.component()
const iconElement = dom.window.document.createElement('div')
iconTree.props.ref.current = iconElement
dom.window.document.body.appendChild(iconElement)
for (const effect of hostEffects.slice(iconEffectsFrom)) {
  const cleanup = effect()
  if (typeof cleanup === 'function') hostCleanups.push(cleanup)
}
const iconSvg = iconElement.shadowRoot?.querySelector('svg')
check('侧栏图标渲染出 svg', !!iconSvg)
check(
  'svg 自带 width/height（否则图标是空的）',
  iconSvg?.getAttribute('width') !== null && iconSvg?.getAttribute('height') !== null,
  `${iconSvg?.getAttribute('width')} x ${iconSvg?.getAttribute('height')}`
)
check('图标有实际尺寸', Number(iconSvg?.getAttribute('width') ?? 0) > 0 && Number(iconSvg?.getAttribute('height') ?? 0) > 0)

/* ------------------------------------------------------------- 9. 清理 */

section('9. 清理')
for (const dispose of cleanups) dispose()
for (const cleanup of hostCleanups) cleanup()
check('清理后 shadow root 已清空', (hostElement.shadowRoot?.childNodes.length ?? -1) === 0)

/* ------------------------------------------------------------- 结果 */

console.log(`\n${checks - failures}/${checks} 项通过`)
if (failures > 0) {
  console.error(`${failures} 项失败`)
  process.exit(1)
}

/* ------------------------------------------------------- React 桩 */

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
