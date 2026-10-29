// Static template hoisting benchmark: cloneTemplate vs per-node createElement (old
// compiled output shape)
// Run: pnpm bench benchmarks/template.bench.ts (jsdom environment)

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

// vitest 5's module runner wraps module exports in getters; calling module imports
// directly inside hot loops repeatedly goes through the getter and skews benchmarks
// (benchmarking#module-runner-overhead), so hot paths take local references first.
const _createTemplate = createTemplate
const _cloneTemplate = cloneTemplate
const _createElement = createElement
const _createText = createText
const _setStaticProps = setStaticProps
const _bindAttribute = bindAttribute
const _insertBefore = insertBefore

// Representative static subtree: an 8-node card
// <div class="card"><div class="head"><span class="icon">◆</span><h3 class="title">Title</h3></div><p class="desc">Description text</p><footer><button class="action">View</button></footer></div>

/** Old output shape: per-node createElement + setStaticProps + createText + insertBefore. */
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
  _insertBefore(title, _createText('Title'), null)
  const desc = _createElement('p')
  _setStaticProps(desc, { class: 'desc' })
  _insertBefore(card, desc, null)
  _insertBefore(desc, _createText('Description text'), null)
  const footer = _createElement('footer')
  _insertBefore(card, footer, null)
  const button = _createElement('button')
  _setStaticProps(button, { class: 'action' })
  _insertBefore(footer, button, null)
  _insertBefore(button, _createText('View'), null)
  return card
}

/** Partial hoisting (the most common shape in practice): dynamic props on the root; the static subtree hoisted block-wise into 3 templates. */
function buildCardPartial(): Node {
  const card = _createElement('div')
  _bindAttribute(card, 'class', () => 'card')
  _insertBefore(card, _cloneTemplate(headTemplate), null)
  _insertBefore(card, _cloneTemplate(descTemplate), null)
  _insertBefore(card, _cloneTemplate(footerTemplate), null)
  return card
}

// Module-level template declarations, matching compiled output (created once at module load)
const cardTemplate = _createTemplate('<div class="card"><div class="head"><span class="icon">◆</span><h3 class="title">Title</h3></div><p class="desc">Description text</p><footer><button class="action">View</button></footer></div>')
const headTemplate = _createTemplate('<div class="head"><span class="icon">◆</span><h3 class="title">Title</h3></div>')
const descTemplate = _createTemplate('<p class="desc">Description text</p>')
const footerTemplate = _createTemplate('<footer><button class="action">View</button></footer>')

const MOUNT_OPTIONS = { iterations: 20, time: 20000 } as const

describe('template: single static card (8 nodes)', () => {
  test('old path', async ({ bench }) => {
    await bench('old path: per-node createElement', () => {
      buildCardOld()
    }).run(MOUNT_OPTIONS)
  })

  test('partial hoist', async ({ bench }) => {
    await bench('partial hoist: dynamic root + 3×cloneTemplate subtrees', () => {
      buildCardPartial()
    }).run(MOUNT_OPTIONS)
  })

  test('full hoist', async ({ bench }) => {
    await bench('full hoist: cloneTemplate ×1', () => {
      _cloneTemplate(cardTemplate)
    }).run(MOUNT_OPTIONS)
  })
})

describe('template: mounting a list of 1000 static cards', () => {
  test('old path ×1000', async ({ bench }) => {
    await bench('old path: per-node createElement ×1000', () => {
      const container = document.createElement('div')
      for (let i = 0; i < 1000; i++) _insertBefore(container, buildCardOld(), null)
      container.replaceChildren()
    }).run(MOUNT_OPTIONS)
  })

  test('partial hoist ×1000', async ({ bench }) => {
    await bench('partial hoist: dynamic root + 3×cloneTemplate ×1000', () => {
      const container = document.createElement('div')
      for (let i = 0; i < 1000; i++) _insertBefore(container, buildCardPartial(), null)
      container.replaceChildren()
    }).run(MOUNT_OPTIONS)
  })

  test('full hoist ×1000', async ({ bench }) => {
    await bench('full hoist: cloneTemplate ×1000', () => {
      const container = document.createElement('div')
      for (let i = 0; i < 1000; i++) _insertBefore(container, _cloneTemplate(cardTemplate), null)
      container.replaceChildren()
    }).run(MOUNT_OPTIONS)
  })
})
