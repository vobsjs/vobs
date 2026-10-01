/**
 * 校验 Vobs 开发台的**已构建产物**在 DSH 客户端模块协议下的真实行为。
 *
 * 覆盖：
 *   1. dsh 清单与 exports 自洽
 *   2. Host 半侧是合法 cordis 插件
 *   3. lib/client.js 只注册 factory，执行它不产生副作用
 *   4. factory 物化后拿到插件；apply() 同时注册 main（keyed）与 sidebar.panellist
 *   5. 面板挂载：shadow root + 整页 vobs 渲染 + 四个 tab
 *   6. 真实交互：切 tab、切 API 条目（内容是构建期打进来的，没有网络）
 *   7. 清理：effect 清理后 shadow root 被清空
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
// 样式必须内联进产物（DSH 只接受单文件 bundle，不能有独立 CSS 资源）
check('样式已内联进产物', bundleCode.includes('.vk-root'))

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
check('.vk-root 已挂载', !!shadow?.querySelector('.vk-root'))
check('渲染出标题', (shadow?.textContent ?? '').includes('Vobs 开发台'))
check('标签标记了 vobs 渲染', (shadow?.textContent ?? '').includes('vobs 渲染'))

const tabLabels = () => [...shadow.querySelectorAll('.vk-tab')].map(node => node.textContent.replace(/\d+$/u, '').trim())
check('渲染了四个 tab', shadow.querySelectorAll('.vk-tab').length === 4, tabLabels().join(','))
check('tab 名称正确', tabLabels().join(',') === '护栏,API,示例,状态', tabLabels().join(','))
check('默认停在护栏页', tabLabels()[0] !== undefined && !!shadow.querySelector('.vk-tab--active')?.textContent.includes('护栏'))

/*
 * 侧栏图标。图标宿主的默认样式是 `width:100%; height:100%`，内联 svg 没有固有尺寸
 * 时不会被撑开 —— 现象是「侧栏条目出现了，图标却是空的」。这条断言就是为它加的。
 */
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

/* --------------------------------------------------------------- 6. 内容 */

section('6. 内容与交互')
const text = () => shadow.textContent ?? ''
check('护栏页列出 VOBS_C210', text().includes('VOBS_C210'))
check('护栏页列出 VOBS_C211', text().includes('VOBS_C211'))
check('护栏页给出正确写法', text().includes('untrack'))
check('护栏页含前后写法对照', shadow.querySelectorAll('.vk-code--bad').length === 2 && shadow.querySelectorAll('.vk-code--good').length === 2)
check('声明了「只报告、不中断」', text().includes('只报告、不中断'))

const clickTab = async label => {
  const tab = [...shadow.querySelectorAll('.vk-tab')].find(node => node.textContent.includes(label))
  tab.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  await tick()
}

await clickTab('API')
check('切到 API 页', shadow.querySelectorAll('.vk-api__item').length > 0, String(shadow.querySelectorAll('.vk-api__item').length))
check('API 页列出分组', ['响应式', 'DSH 插件', '编译器', '开发期护栏'].every(group => text().includes(group)))
check('默认展示 state 的签名', text().includes('state<T>(initialValue: T'))

const target = [...shadow.querySelectorAll('.vk-api__item')].find(node => node.textContent.trim() === 'defineDshPanel')
check('API 树里有 defineDshPanel', !!target)
target.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
await tick()
check('点击后详情切到 defineDshPanel', text().includes('defineDshPanel(options: DshPanelOptions'))
check('详情带所属包', text().includes('@vobs/dsh'))

await clickTab('示例')
check('示例页有写法卡片', shadow.querySelectorAll('.vk-pattern').length >= 6, String(shadow.querySelectorAll('.vk-pattern').length))
check('示例里提到 keyed 列表', text().includes('keyed 列表'))
check('示例代码是真实可复制的 vobs 写法', text().includes("import { state } from '@vobs/vobs'"))

await clickTab('状态')
check('状态页列出能力', text().includes('开发期护栏') && text().includes('vobs check'))
check('状态页如实标注未做项', text().includes('未做'))
check('状态页说明面板为何是静态的', text().includes('不是同一个页面'))

// 切回护栏页，确认状态是信号驱动的（组件体没重跑）
await clickTab('护栏')
check('切回护栏页仍正确', text().includes('VOBS_C210'))

/* ------------------------------------------------------------- 7. 清理 */

section('7. 清理')
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
