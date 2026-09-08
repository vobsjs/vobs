import { describe, expect, it } from 'vitest'
import { state, createId } from '@vobs/vobs'
import { createDict } from '@vobs/dict'
import { createI18n } from '../../i18n/src/index'
import { createResourceClient, resourcePlugin } from '@vobs/resource'
import { createHTTPClient, httpPlugin } from '@vobs/http'
import { createTheme } from '../../theme/src/index'
import {
  addEventListener,
  bindText,
  createElement,
  createFragment,
  createText,
  insertBefore,
  setAttribute,
  setProperty
} from '@vobs/dom'
import { insertDynamic, insertList } from '@vobs/dom'
import { hydrate, renderToString, renderToStringAsync, serializeState } from './index'

describe('SSR', () => {
  it('为每个 SSR 请求生成稳定且隔离的 ID', () => {
    const render = () => {
      const input = createElement('input')
      setAttribute(input, 'id', createId('field'))
      return input
    }
    expect(renderToString(render)).toBe('<input id="field-1">')
    expect(renderToString(render)).toBe('<input id="field-1">')
  })
  it('输出静态 HTML', () => {
    const html = renderToString(() => {
      const heading = createElement('h1')
      insertBefore(heading, createText('Vobs'), null)
      return heading
    })

    expect(html).toBe('<h1>Vobs</h1>')
  })

  it('异步 SSR 可显式返回服务端请求诊断 side-channel', async () => {
    const http = createHTTPClient({
      adapter: async config => new Response(JSON.stringify({ url: config.url }), {
        headers: { 'content-type': 'application/json' }
      })
    })
    const resources = createResourceClient()
    const result = await renderToStringAsync(() => {
      const users = resources.resource({
        key: ['ssr-users'],
        fetcher: signal => http.get<{ url: string }>('/users', { signal }).then(response => response.data)
      })
      const text = createText('')
      bindText(text, () => users.data.value?.url ?? 'loading')
      return text
    }, {
      resourceClient: resources,
      plugins: [resourcePlugin({ client: resources }), httpPlugin({ client: http })],
      debug: { captureRequests: true }
    })
    expect(result.debug).toMatchObject({ version: 1, environment: 'server', requests: expect.any(Array) })
    expect(result.debug?.requests).toEqual(expect.arrayContaining([
      expect.objectContaining({ phase: 'end', status: 'success', context: expect.objectContaining({ environment: 'server' }) })
    ]))
  })

  it('转义文本、属性并省略事件', () => {
    const html = renderToString(() => {
      const input = createElement('input')
      setAttribute(input, 'title', 'A "quoted" <value>')
      return input
    })

    expect(html).toBe('<input title="A &quot;quoted&quot; &lt;value&gt;">')
  })

  it('将 DOM property 序列化为可 Hydration 的 HTML 属性', () => {
    const html = renderToString(() => {
      const input = createElement('input')
      setProperty(input, 'value', 'Ada & <Lin>')
      setProperty(input, 'checked', true)
      setProperty(input, 'disabled', false)
      setProperty(input, 'tabIndex', 2)
      return input
    })

    expect(html).toBe('<input value="Ada &amp; &lt;Lin&gt;" checked="" tabindex="2">')
  })

  it('输出 state 初始值、条件块和 keyed 列表', () => {
    const html = renderToString(() => {
      const count = state('<safe>')
      const visible = state(true)
      const users = state([{ id: 1, name: 'Ada' }, { id: 2, name: 'Lin' }])
      const root = createElement('div')
      const text = createText('')
      insertBefore(root, text, null)
      bindText(text, () => `count: ${count.value}`)
      insertDynamic(root, null, () => {
        if (!visible.value) return null
        const detail = createElement('span')
        insertBefore(detail, createText('visible'), null)
        return detail
      })
      const list = createElement('ul')
      insertBefore(root, list, null)
      insertList(
        list,
        null,
        () => users.value,
        user => {
          const item = createElement('li')
          const itemText = createText('')
          insertBefore(item, itemText, null)
          bindText(itemText, () => user.name)
          return item
        },
        user => user.id
      )
      return root
    })

    expect(html).toBe('<div>count: &lt;safe&gt;<span>visible</span><!--vobs:dynamic--><ul><li>Ada</li><li>Lin</li><!--vobs:list--></ul></div>')
  })

  it('Hydration 复用服务端 DOM 并重新绑定 state 和事件', () => {
    const count = state(0)
    const render = () => {
      const button = createElement('button')
      const text = createText('')
      insertBefore(button, text, null)
      bindText(text, () => `count: ${count.value}`)
      addEventListener(button, 'click', () => { count.value++ })
      return button
    }

    document.body.innerHTML = renderToString(render)
    const button = document.body.querySelector('button')!
    const text = button.firstChild
    const app = hydrate(render, document.body)

    expect(document.body.querySelector('button')).toBe(button)
    expect(button.firstChild).toBe(text)

    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    app.update()
    expect(button.textContent).toBe('count: 1')

    app.destroy()
  })

  it('SSR 与 Hydration 复用 Fragment 的范围锚点', () => {
    const render = () => createFragment((parent, anchor) => {
      insertBefore(parent, createElement('span'), anchor)
      insertBefore(parent, createText('tail'), anchor)
    })
    const html = renderToString(render)
    expect(html).toBe('<!--vobs:fragment:start--><span></span>tail<!--vobs:fragment:end-->')

    document.body.innerHTML = html
    const start = document.body.childNodes[0]
    const span = document.body.querySelector('span')
    const app = hydrate(render, document.body)
    expect(document.body.childNodes[0]).toBe(start)
    expect(document.body.querySelector('span')).toBe(span)
    app.destroy()
  })

  it('Hydration 复用动态锚点并支持后续条件块更新', () => {
    const visible = state(true)
    const render = () => {
      const root = createElement('div')
      insertDynamic(root, null, () => {
        if (!visible.value) return null
        const detail = createElement('p')
        insertBefore(detail, createText('visible'), null)
        return detail
      })
      return root
    }

    document.body.innerHTML = renderToString(render)
    const detail = document.body.querySelector('p')!
    const app = hydrate(render, document.body)

    expect(document.body.querySelector('p')).toBe(detail)
    visible.value = false
    app.update()
    expect(document.body.querySelector('p')).toBeNull()

    app.destroy()
  })

  it('Hydration 在结构不匹配时保留服务端 DOM 并抛错', () => {
    document.body.innerHTML = renderToString(() => createElement('h1'))
    const serverNode = document.body.firstChild

    expect(() => hydrate(() => createElement('p'), document.body)).toThrow('hydration')
    expect(document.body.firstChild).toBe(serverNode)
  })

  it('异步 SSR 等待 Resource，并返回可恢复的缓存快照', async () => {
    const client = createResourceClient()
    const fetcher = async () => [{ id: 1, name: 'Ada' }]
    const result = await renderToStringAsync(() => {
      const users = client.resource({ key: ['users'], fetcher, staleTime: 10_000 })
      const text = createText('')
      bindText(text, () => users.data.value?.[0]?.name ?? 'loading')
      return text
    }, {
      resourceClient: client,
      plugins: [resourcePlugin({ client })]
    })

    expect(result.html).toBe('Ada')
    expect(result.resources?.entries).toHaveLength(1)
    client.clear()
  })

  it('客户端恢复 Resource 后初次创建不重复请求', async () => {
    const serverClient = createResourceClient()
    const serverResource = serverClient.resource({
      key: ['users'],
      fetcher: () => Promise.resolve([{ id: 1 }]),
      staleTime: 10_000
    })
    await serverResource.refetch()
    const snapshot = serverClient.dehydrate()

    const client = createResourceClient()
    client.hydrate(snapshot)
    let calls = 0
    const users = client.resource({
      key: ['users'],
      fetcher: () => {
        calls++
        return Promise.resolve([{ id: 2 }])
      },
      staleTime: 10_000
    })
    await users.prefetch()

    expect(calls).toBe(0)
    expect(users.data.value).toEqual([{ id: 1 }])
    serverClient.clear()
    client.clear()
  })

  it('序列化并在首次 Hydration 前恢复 Resource、i18n 和 Theme 状态', async () => {
    const serverI18n = createI18n({
      defaultLocale: 'en-US',
        messages: { 'en-US': { title: 'English' }, 'zh-CN': { title: '中文' } }
    })
    serverI18n.setLocale('zh-CN')
    const serverTheme = createTheme({ defaultMode: 'light' })
    serverTheme.setMode('dark')
    serverTheme.setTheme({ '--app-state': 'server' })

    const render = () => {
      const text = createText('')
      bindText(text, () => `${serverI18n.t('title')}-${serverTheme.mode.value}-${serverTheme.theme.value['--app-state'] ?? ''}`)
      return text
    }
    const result = await renderToStringAsync(render, { i18n: serverI18n, theme: serverTheme })
    const serialized = serializeState(result.state!)

    const clientI18n = createI18n({
      defaultLocale: 'en-US',
      messages: { 'en-US': { title: 'English' }, 'zh-CN': { title: '中文' } }
    })
    const clientTheme = createTheme({ defaultMode: 'light' })
    document.body.innerHTML = result.html
    const app = hydrate(() => {
      const text = createText('')
      bindText(text, () => `${clientI18n.t('title')}-${clientTheme.mode.value}-${clientTheme.theme.value['--app-state'] ?? ''}`)
      return text
    }, document.body, { state: serialized, i18n: clientI18n, theme: clientTheme })

    expect(document.body.textContent).toBe('中文-dark-server')
    expect(clientI18n.locale.value).toBe('zh-CN')
    expect(clientTheme.mode.value).toBe('dark')
    app.destroy()
    serverI18n.dispose()
    serverTheme.dispose()
    clientI18n.dispose()
    clientTheme.dispose()
  })

  it('序列化并在首次 Hydration 前恢复 Dict 状态', async () => {
    const serverDict = createDict({
      data: {
        user_status: [{ value: 'active', label: '活跃' }]
      }
    })
    const renderServer = () => {
      const text = createText('')
      bindText(text, () => serverDict.label('user_status', 'active'))
      return text
    }

    const result = await renderToStringAsync(renderServer, { dict: serverDict })

    expect(result.html).toBe('活跃')
    expect(result.dict?.entries).toHaveLength(1)
    expect(result.state?.dict).toEqual(result.dict)

    let calls = 0
    const clientDict = createDict({
      loader: () => {
        calls++
        return [{ value: 'active', label: '客户端加载' }]
      }
    })
    document.body.innerHTML = result.html
    const app = hydrate(() => {
      const text = createText('')
      bindText(text, () => clientDict.label('user_status', 'active'))
      return text
    }, document.body, {
      state: serializeState(result.state!),
      dict: clientDict
    })

    expect(document.body.textContent).toBe('活跃')
    expect(clientDict.get('user_status')).toEqual([{ value: 'active', label: '活跃' }])
    await clientDict.load('user_status')
    expect(calls).toBe(0)

    app.destroy()
    serverDict.dispose()
    clientDict.dispose()
  })

  it('SSR 状态序列化会转义脚本边界字符', () => {
    const serialized = serializeState({
      version: 1,
      i18n: {
        version: 1,
        locale: 'en-US',
        messages: { 'en-US': { html: '</script><script>alert(1)</script>' } }
      }
    })

    expect(serialized).not.toContain('</script>')
    expect(serialized).toContain('\\u003c/script\\u003e')
  })

  it('拒绝结构无效的 i18n SSR 快照', () => {
    expect(() => hydrate(() => createText(''), document.body, {
      state: JSON.stringify({ version: 1, i18n: { version: 1, locale: 'en-US', messages: { 'en-US': { bad: 1 } } } })
    })).toThrow('i18n')
  })
})
