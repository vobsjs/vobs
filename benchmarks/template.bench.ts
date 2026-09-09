// 静态模板提升基准：cloneTemplate vs 逐节点 createElement（旧编译产物形态）
// 运行：pnpm bench benchmarks/template.bench.ts（jsdom 环境）

// @vitest-environment jsdom
import { bench, describe } from 'vitest'
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

// 代表性静态子树：8 节点卡片
// <div class="card"><div class="head"><span class="icon">◆</span><h3 class="title">标题</h3></div><p class="desc">描述文本</p><footer><button class="action">查看</button></footer></div>

/** 旧产物形态：逐节点 createElement + setStaticProps + createText + insertBefore。 */
function buildCardOld(): Node {
  const card = createElement('div')
  setStaticProps(card, { class: 'card' })
  const head = createElement('div')
  setStaticProps(head, { class: 'head' })
  insertBefore(card, head, null)
  const icon = createElement('span')
  setStaticProps(icon, { class: 'icon' })
  insertBefore(head, icon, null)
  insertBefore(icon, createText('◆'), null)
  const title = createElement('h3')
  setStaticProps(title, { class: 'title' })
  insertBefore(head, title, null)
  insertBefore(title, createText('标题'), null)
  const desc = createElement('p')
  setStaticProps(desc, { class: 'desc' })
  insertBefore(card, desc, null)
  insertBefore(desc, createText('描述文本'), null)
  const footer = createElement('footer')
  insertBefore(card, footer, null)
  const button = createElement('button')
  setStaticProps(button, { class: 'action' })
  insertBefore(footer, button, null)
  insertBefore(button, createText('查看'), null)
  return card
}

/** 部分提升（实际最常见形态）：根节点带动态属性，静态子树按块提升为 3 个模板。 */
function buildCardPartial(): Node {
  const card = createElement('div')
  bindAttribute(card, 'class', () => 'card')
  insertBefore(card, cloneTemplate(headTemplate), null)
  insertBefore(card, cloneTemplate(descTemplate), null)
  insertBefore(card, cloneTemplate(footerTemplate), null)
  return card
}

// 模块级模板声明，与编译产物一致（模块加载时创建一次）
const cardTemplate = createTemplate('<div class="card"><div class="head"><span class="icon">◆</span><h3 class="title">标题</h3></div><p class="desc">描述文本</p><footer><button class="action">查看</button></footer></div>')
const headTemplate = createTemplate('<div class="head"><span class="icon">◆</span><h3 class="title">标题</h3></div>')
const descTemplate = createTemplate('<p class="desc">描述文本</p>')
const footerTemplate = createTemplate('<footer><button class="action">查看</button></footer>')

const MOUNT_OPTIONS = { iterations: 20, time: 20000 } as const

describe('template: 单个静态卡片（8 节点）', () => {
  bench('旧路径：逐节点 createElement', () => {
    buildCardOld()
  }, MOUNT_OPTIONS)

  bench('部分提升：动态根 + 3×cloneTemplate 子树', () => {
    buildCardPartial()
  }, MOUNT_OPTIONS)

  bench('全提升：cloneTemplate ×1', () => {
    cloneTemplate(cardTemplate)
  }, MOUNT_OPTIONS)
})

describe('template: 1000 张静态卡片列表挂载', () => {
  bench('旧路径：逐节点 createElement ×1000', () => {
    const container = document.createElement('div')
    for (let i = 0; i < 1000; i++) insertBefore(container, buildCardOld(), null)
    container.replaceChildren()
  }, MOUNT_OPTIONS)

  bench('部分提升：动态根 + 3×cloneTemplate ×1000', () => {
    const container = document.createElement('div')
    for (let i = 0; i < 1000; i++) insertBefore(container, buildCardPartial(), null)
    container.replaceChildren()
  }, MOUNT_OPTIONS)

  bench('全提升：cloneTemplate ×1000', () => {
    const container = document.createElement('div')
    for (let i = 0; i < 1000; i++) insertBefore(container, cloneTemplate(cardTemplate), null)
    container.replaceChildren()
  }, MOUNT_OPTIONS)
})
