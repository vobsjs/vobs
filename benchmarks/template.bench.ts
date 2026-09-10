// 静态模板提升基准：cloneTemplate vs 逐节点 createElement（旧编译产物形态）
// 运行：pnpm bench benchmarks/template.bench.ts（jsdom 环境）

// @vitest-environment jsdom
import { describe, test } from 'vitest'
import {
  createDOMRenderer,
  setRenderer,
  createText,
  createElement,
  setStaticProps,
  bindAttribute,
  insertBefore,
  createTemplate,
  cloneTemplate
} from '@vobs/vobs'

setRenderer(createDOMRenderer())

// vitest 5 的 module runner 把模块导出包装为 getter；热循环内直接调用
// 模块导入会反复穿透 getter 拖慢基准（benchmarking#module-runner-overhead），
// 因此热路径先取本地引用。
const _createTemplate = createTemplate
const _cloneTemplate = cloneTemplate
const _createElement = createElement
const _createText = createText
const _setStaticProps = setStaticProps
const _bindAttribute = bindAttribute
const _insertBefore = insertBefore

// 代表性静态子树：8 节点卡片
// <div class="card"><div class="head"><span class="icon">◆</span><h3 class="title">标题</h3></div><p class="desc">描述文本</p><footer><button class="action">查看</button></footer></div>

/** 旧产物形态：逐节点 createElement + setStaticProps + createText + insertBefore。 */
function buildCardOld(): Node {
  const card = _createElement('div')
  _setStaticProps(card, { class: 'card' })
  const head = _createElement('div')
  _setStaticProps(head, { class: 'head' })
  _insertBefore(card, head, null)
  const icon = _createElement('span')
  _setStaticProps(icon, { class: 'icon' })
  _insertBefore(head, icon, null)
  _insertBefore(icon, _createText('◆'), null)
  const title = _createElement('h3')
  _setStaticProps(title, { class: 'title' })
  _insertBefore(head, title, null)
  _insertBefore(title, _createText('标题'), null)
  const desc = _createElement('p')
  _setStaticProps(desc, { class: 'desc' })
  _insertBefore(card, desc, null)
  _insertBefore(desc, _createText('描述文本'), null)
  const footer = _createElement('footer')
  _insertBefore(card, footer, null)
  const button = _createElement('button')
  _setStaticProps(button, { class: 'action' })
  _insertBefore(footer, button, null)
  _insertBefore(button, _createText('查看'), null)
  return card
}

/** 部分提升（实际最常见形态）：根节点带动态属性，静态子树按块提升为 3 个模板。 */
function buildCardPartial(): Node {
  const card = _createElement('div')
  _bindAttribute(card, 'class', () => 'card')
  _insertBefore(card, _cloneTemplate(headTemplate), null)
  _insertBefore(card, _cloneTemplate(descTemplate), null)
  _insertBefore(card, _cloneTemplate(footerTemplate), null)
  return card
}

// 模块级模板声明，与编译产物一致（模块加载时创建一次）
const cardTemplate = _createTemplate('<div class="card"><div class="head"><span class="icon">◆</span><h3 class="title">标题</h3></div><p class="desc">描述文本</p><footer><button class="action">查看</button></footer></div>')
const headTemplate = _createTemplate('<div class="head"><span class="icon">◆</span><h3 class="title">标题</h3></div>')
const descTemplate = _createTemplate('<p class="desc">描述文本</p>')
const footerTemplate = _createTemplate('<footer><button class="action">查看</button></footer>')

const MOUNT_OPTIONS = { iterations: 20, time: 20000 } as const

describe('template: 单个静态卡片（8 节点）', () => {
  test('旧路径', async ({ bench }) => {
    await bench('旧路径：逐节点 createElement', () => {
      buildCardOld()
    }).run(MOUNT_OPTIONS)
  })

  test('部分提升', async ({ bench }) => {
    await bench('部分提升：动态根 + 3×cloneTemplate 子树', () => {
      buildCardPartial()
    }).run(MOUNT_OPTIONS)
  })

  test('全提升', async ({ bench }) => {
    await bench('全提升：cloneTemplate ×1', () => {
      _cloneTemplate(cardTemplate)
    }).run(MOUNT_OPTIONS)
  })
})

describe('template: 1000 张静态卡片列表挂载', () => {
  test('旧路径 ×1000', async ({ bench }) => {
    await bench('旧路径：逐节点 createElement ×1000', () => {
      const container = document.createElement('div')
      for (let i = 0; i < 1000; i++) _insertBefore(container, buildCardOld(), null)
      container.replaceChildren()
    }).run(MOUNT_OPTIONS)
  })

  test('部分提升 ×1000', async ({ bench }) => {
    await bench('部分提升：动态根 + 3×cloneTemplate ×1000', () => {
      const container = document.createElement('div')
      for (let i = 0; i < 1000; i++) _insertBefore(container, buildCardPartial(), null)
      container.replaceChildren()
    }).run(MOUNT_OPTIONS)
  })

  test('全提升 ×1000', async ({ bench }) => {
    await bench('全提升：cloneTemplate ×1000', () => {
      const container = document.createElement('div')
      for (let i = 0; i < 1000; i++) _insertBefore(container, _cloneTemplate(cardTemplate), null)
      container.replaceChildren()
    }).run(MOUNT_OPTIONS)
  })
})
