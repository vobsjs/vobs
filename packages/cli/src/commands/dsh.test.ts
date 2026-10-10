import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildInstallSpec, buildPreviewHtml, buildShellCommand, collectIssues, resolveExport } from './dsh.js'

/* ---------------------------------------------------------------- 夹具 */

const tempDirs: string[] = []

function makeProject(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'vobs-dsh-check-'))
  tempDirs.push(dir)
  for (const [relative, content] of Object.entries(files)) {
    const target = join(dir, relative)
    mkdirSync(join(target, '..'), { recursive: true })
    writeFileSync(target, content, 'utf8')
  }
  return dir
}

afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop() as string, { recursive: true, force: true })
})

/** 一个各处都合法的插件项目。 */
function healthyProject(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    'package.json': JSON.stringify(
      {
        name: 'dsh-plugin-demo',
        version: '0.1.0',
        type: 'module',
        main: './lib/index.js',
        exports: {
          '.': './lib/index.js',
          './client': './lib/client.js',
          './cordis.patch.yml': './cordis.patch.yml',
          './package.json': './package.json'
        },
        dsh: {
          manifestVersion: 1,
          bundle: { patch: './cordis.patch.yml' },
          client: { platform: 'web' }
        }
      },
      null,
      2
    ),
    'cordis.patch.yml': "- insert:\n    - id: dsh-plugin-demo\n      name: dsh-plugin-demo\n",
    'lib/index.js': 'export const name = "dsh-plugin-demo"\nexport function apply() {}\n',
    'lib/client.js':
      '// generated\nwindow.__ModuleLoader__.load({id:"dsh-plugin-demo",factory:function(require){\n' +
      '"use strict";var module={exports:{}};var exports=module.exports;\n' +
      'globalThis["__VOBS_DSH_REACT__"]=require("react");\nmodule.exports={};\n}});\n',
    ...overrides
  }
}

/* ------------------------------------------------------------ collectIssues */

describe('collectIssues', () => {
  it('健康项目零错误', () => {
    const result = collectIssues(makeProject(healthyProject()))
    expect(result.errors).toEqual([])
    expect(result.passed.length).toBeGreaterThan(4)
  })

  it('缺 dsh.bundle.patch 直接判错', () => {
    const dir = makeProject(
      healthyProject({
        'package.json': JSON.stringify({ name: 'p', version: '1.0.0', exports: {} })
      })
    )
    const result = collectIssues(dir)
    expect(result.errors.join('\n')).toContain('dsh.bundle.patch')
  })

  it('patch 文件不存在判错', () => {
    const manifest = JSON.parse(healthyProject()['package.json'] as string) as Record<string, unknown>
    ;(manifest.dsh as Record<string, unknown>).bundle = { patch: './missing.yml' }
    const result = collectIssues(makeProject(healthyProject({ 'package.json': JSON.stringify(manifest) })))
    expect(result.errors.join('\n')).toContain('missing.yml')
  })

  it('patch 里没有 insert 判错', () => {
    const result = collectIssues(makeProject(healthyProject({ 'cordis.patch.yml': '- id: other\n' })))
    expect(result.errors.join('\n')).toContain('insert')
  })

  it('platform 不是 web 判错', () => {
    const manifest = JSON.parse(healthyProject()['package.json'] as string) as Record<string, unknown>
    ;(manifest.dsh as Record<string, unknown>).client = { platform: 'node' }
    const result = collectIssues(makeProject(healthyProject({ 'package.json': JSON.stringify(manifest) })))
    expect(result.errors.join('\n')).toContain('web')
  })

  it('声明了 prepare 判错（DSH 安装时不构建）', () => {
    const manifest = JSON.parse(healthyProject()['package.json'] as string) as Record<string, unknown>
    manifest.scripts = { prepare: 'vite build' }
    const result = collectIssues(makeProject(healthyProject({ 'package.json': JSON.stringify(manifest) })))
    expect(result.errors.join('\n')).toContain('prepare')
  })

  it('依赖里出现 workspace: 判错（Git 子目录直装解析不了）', () => {
    const manifest = JSON.parse(healthyProject()['package.json'] as string) as Record<string, unknown>
    manifest.devDependencies = { '@vobs/vobs': 'workspace:*' }
    const result = collectIssues(makeProject(healthyProject({ 'package.json': JSON.stringify(manifest) })))
    expect(result.errors.join('\n')).toContain('workspace:')
  })

  it('客户端产物缺失判错', () => {
    const files = healthyProject()
    delete files['lib/client.js']
    const result = collectIssues(makeProject(files))
    expect(result.errors.join('\n')).toContain('客户端产物')
  })

  it('产物里出现动态 import 判错', () => {
    const code = `${healthyProject()['lib/client.js'] as string}\nconst load = () => import("./chunk.js")\n`
    const result = collectIssues(makeProject(healthyProject({ 'lib/client.js': code })))
    expect(result.errors.join('\n')).toContain('动态 import')
  })

  it('产物 require 了非平台模块判错', () => {
    const code = (healthyProject()['lib/client.js'] as string).replace('require("react")', 'require("lodash")')
    const result = collectIssues(makeProject(healthyProject({ 'lib/client.js': code })))
    expect(result.errors.join('\n')).toContain('lodash')
  })

  it('__ModuleLoader__.load 出现多次判错', () => {
    const code = `${healthyProject()['lib/client.js'] as string}\nwindow.__ModuleLoader__.load({id:"x",factory(){}});\n`
    const result = collectIssues(makeProject(healthyProject({ 'lib/client.js': code })))
    expect(result.errors.join('\n')).toContain('2 次')
  })

  it('模块 id 与包名不一致只给警告', () => {
    const code = (healthyProject()['lib/client.js'] as string).replace(/"dsh-plugin-demo"/u, '"wrong-id"')
    const result = collectIssues(makeProject(healthyProject({ 'lib/client.js': code })))
    expect(result.errors).toEqual([])
    expect(result.warnings.join('\n')).toContain('模块 id')
  })

  it('package.json 语法错误时给出明确错误', () => {
    const result = collectIssues(makeProject({ 'package.json': '{ not json' }))
    expect(result.errors[0]).toContain('package.json')
  })
})

/* --------------------------------------------------------- buildInstallSpec */

describe('buildInstallSpec', () => {
  it('显式 spec 原样透传', () => {
    expect(buildInstallSpec({ spec: 'github:a/b#v1&path:/x' }).spec).toBe('github:a/b#v1&path:/x')
  })

  it('repo 无 tag 无子目录', () => {
    expect(buildInstallSpec({ repo: 'vobsjs/vobs' }).spec).toBe('github:vobsjs/vobs')
  })

  it('repo + tag', () => {
    expect(buildInstallSpec({ repo: 'vobsjs/vobs', tag: 'v1.7.6' }).spec).toBe('github:vobsjs/vobs#v1.7.6')
  })

  it('repo + tag + 子目录用 & 连接', () => {
    expect(buildInstallSpec({ repo: 'vobsjs/vobs', tag: 'v1.7.6', subpath: '/packages/dsh-console' }).spec).toBe(
      'github:vobsjs/vobs#v1.7.6&path:/packages/dsh-console'
    )
  })

  it('repo + 只有子目录时用 # 起头', () => {
    expect(buildInstallSpec({ repo: 'vobsjs/vobs', subpath: '/packages/dsh-plugin' }).spec).toBe(
      'github:vobsjs/vobs#path:/packages/dsh-plugin'
    )
  })

  it('--from 解析成绝对路径', () => {
    const result = buildInstallSpec({ from: '.' })
    expect(result.error).toBeUndefined()
    // 原来断言 spec 含冒号 —— 那是**Windows 盘符**的代理，在 POSIX 上必然失败
    // （/home/runner/... 没有冒号）。换成真正要断言的事：它是绝对路径。
    expect(path.isAbsolute(result.spec as string)).toBe(true)
  })

  it('--from 指向不存在的路径时报错', () => {
    const result = buildInstallSpec({ from: './definitely-not-here-xyz' })
    expect(result.error).toContain('不存在')
  })

  it('什么都不给时报错并说明可选参数', () => {
    const result = buildInstallSpec({})
    expect(result.error).toContain('--spec')
  })
})

/* ---------------------------------------------------------- buildShellCommand */

describe('buildShellCommand', () => {
  it('给含 & 的 spec 加引号，否则 cmd 会把它当命令分隔符', () => {
    const command = buildShellCommand('dsh', [
      'plugin',
      '--profile',
      'desktop',
      'add',
      'github:vobsjs/vobs#v1.7.6&path:/packages/dsh-console'
    ])
    expect(command).toBe(
      'dsh plugin --profile desktop add "github:vobsjs/vobs#v1.7.6&path:/packages/dsh-console"'
    )
  })

  it('普通参数不加多余引号', () => {
    expect(buildShellCommand('dsh', ['plugin', '--profile', 'desktop'])).toBe('dsh plugin --profile desktop')
  })

  it('含空格的参数加引号', () => {
    expect(buildShellCommand('dsh', ['add', 'C:/my plugins/demo'])).toBe('dsh add "C:/my plugins/demo"')
  })

  it('参数内的双引号按 cmd 规则翻倍', () => {
    expect(buildShellCommand('dsh', ['add', 'a"b'])).toBe('dsh add "a""b"')
  })
})

/* ------------------------------------------------------------ dev 预览页 */

describe('buildPreviewHtml', () => {
  const html = buildPreviewHtml({ packageName: 'dsh-plugin-demo' })

  it('在插件 bundle 之前装 __ModuleLoader__ 垫片', () => {
    const shimAt = html.indexOf('window.__ModuleLoader__')
    const bundleAt = html.indexOf('<script src="/client.js">')
    expect(shimAt).toBeGreaterThan(-1)
    expect(bundleAt).toBeGreaterThan(shimAt)
  })

  it('垫片把 factory 收进注册表而不是执行它', () => {
    expect(html).toContain('factories.set(entry.id, entry.factory)')
  })

  it('用 startPreview 启动并传入包名', () => {
    expect(html).toContain("from '/preview.js'")
    expect(html).toContain('packageName: "dsh-plugin-demo"')
  })

  it('订阅 SSE 以便重建后自动刷新', () => {
    expect(html).toContain("new EventSource('/events')")
    expect(html).toContain('location.reload()')
  })

  it('包名被转义，含 </script> 也不会突破 script 标签', () => {
    const injected = buildPreviewHtml({ packageName: '</script><script>alert(1)</script>' })
    expect(injected).toContain('packageName: "\\u003c/script>')
    expect(injected).not.toContain('</script><script>alert(1)')
  })

  it('标题里的 HTML 元字符被剔除', () => {
    const html = buildPreviewHtml({ packageName: 'p', title: '<img src=x onerror=alert(1)>' })
    expect(html).toContain('<title>vobs preview · img src=x onerror=alert(1)</title>')
    expect(html).not.toContain('<img')
  })
})

describe('resolveExport', () => {
  it('字符串写法直接返回', () => {
    expect(resolveExport({ exports: { './client': './lib/client.js' } }, './client')).toBe('./lib/client.js')
  })

  it('条件对象按 default / import / require 顺序取', () => {
    expect(resolveExport({ exports: { './client': { import: './lib/client.mjs' } } }, './client')).toBe('./lib/client.mjs')
    expect(resolveExport({ exports: { './client': { require: './lib/client.cjs' } } }, './client')).toBe('./lib/client.cjs')
    expect(
      resolveExport({ exports: { './client': { types: './x.d.ts', default: './lib/client.js' } } }, './client')
    ).toBe('./lib/client.js')
  })

  it('缺失时返回 undefined', () => {
    expect(resolveExport({ exports: {} }, './client')).toBeUndefined()
    expect(resolveExport({}, './client')).toBeUndefined()
  })
})
