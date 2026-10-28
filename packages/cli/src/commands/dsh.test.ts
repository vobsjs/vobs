import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildInstallSpec, buildPreviewHtml, buildShellCommand, collectIssues, resolveExport } from './dsh.js'

/* ---------------------------------------------------------------- fixtures */

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

/** A plugin project that is valid in every respect. */
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
  it('a healthy project yields zero errors', () => {
    const result = collectIssues(makeProject(healthyProject()))
    expect(result.errors).toEqual([])
    expect(result.passed.length).toBeGreaterThan(4)
  })

  it('a missing dsh.bundle.patch is an error', () => {
    const dir = makeProject(
      healthyProject({
        'package.json': JSON.stringify({ name: 'p', version: '1.0.0', exports: {} })
      })
    )
    const result = collectIssues(dir)
    expect(result.errors.join('\n')).toContain('dsh.bundle.patch')
  })

  it('a missing patch file is an error', () => {
    const manifest = JSON.parse(healthyProject()['package.json'] as string) as Record<string, unknown>
    ;(manifest.dsh as Record<string, unknown>).bundle = { patch: './missing.yml' }
    const result = collectIssues(makeProject(healthyProject({ 'package.json': JSON.stringify(manifest) })))
    expect(result.errors.join('\n')).toContain('missing.yml')
  })

  it('a patch without insert is an error', () => {
    const result = collectIssues(makeProject(healthyProject({ 'cordis.patch.yml': '- id: other\n' })))
    expect(result.errors.join('\n')).toContain('insert')
  })

  it('a platform other than web is an error', () => {
    const manifest = JSON.parse(healthyProject()['package.json'] as string) as Record<string, unknown>
    ;(manifest.dsh as Record<string, unknown>).client = { platform: 'node' }
    const result = collectIssues(makeProject(healthyProject({ 'package.json': JSON.stringify(manifest) })))
    expect(result.errors.join('\n')).toContain('web')
  })

  it('declaring prepare is an error (DSH does not build at install time)', () => {
    const manifest = JSON.parse(healthyProject()['package.json'] as string) as Record<string, unknown>
    manifest.scripts = { prepare: 'vite build' }
    const result = collectIssues(makeProject(healthyProject({ 'package.json': JSON.stringify(manifest) })))
    expect(result.errors.join('\n')).toContain('prepare')
  })

  it('workspace: in dependencies is an error (unresolvable by direct Git subdirectory install)', () => {
    const manifest = JSON.parse(healthyProject()['package.json'] as string) as Record<string, unknown>
    manifest.devDependencies = { '@vobs/vobs': 'workspace:*' }
    const result = collectIssues(makeProject(healthyProject({ 'package.json': JSON.stringify(manifest) })))
    expect(result.errors.join('\n')).toContain('workspace:')
  })

  it('a missing client bundle is an error', () => {
    const files = healthyProject()
    delete files['lib/client.js']
    const result = collectIssues(makeProject(files))
    expect(result.errors.join('\n')).toContain('client bundle')
  })

  it('a dynamic import in the bundle is an error', () => {
    const code = `${healthyProject()['lib/client.js'] as string}\nconst load = () => import("./chunk.js")\n`
    const result = collectIssues(makeProject(healthyProject({ 'lib/client.js': code })))
    expect(result.errors.join('\n')).toContain('dynamic import')
  })

  it('requiring a non-platform module is an error', () => {
    const code = (healthyProject()['lib/client.js'] as string).replace('require("react")', 'require("lodash")')
    const result = collectIssues(makeProject(healthyProject({ 'lib/client.js': code })))
    expect(result.errors.join('\n')).toContain('lodash')
  })

  it('multiple __ModuleLoader__.load occurrences are an error', () => {
    const code = `${healthyProject()['lib/client.js'] as string}\nwindow.__ModuleLoader__.load({id:"x",factory(){}});\n`
    const result = collectIssues(makeProject(healthyProject({ 'lib/client.js': code })))
    expect(result.errors.join('\n')).toContain('2 times')
  })

  it('a module id mismatching the package name yields only a warning', () => {
    const code = (healthyProject()['lib/client.js'] as string).replace(/"dsh-plugin-demo"/u, '"wrong-id"')
    const result = collectIssues(makeProject(healthyProject({ 'lib/client.js': code })))
    expect(result.errors).toEqual([])
    expect(result.warnings.join('\n')).toContain('module id')
  })

  it('a malformed package.json produces a clear error', () => {
    const result = collectIssues(makeProject({ 'package.json': '{ not json' }))
    expect(result.errors[0]).toContain('package.json')
  })
})

/* --------------------------------------------------------- buildInstallSpec */

describe('buildInstallSpec', () => {
  it('an explicit spec is passed through verbatim', () => {
    expect(buildInstallSpec({ spec: 'github:a/b#v1&path:/x' }).spec).toBe('github:a/b#v1&path:/x')
  })

  it('repo without tag or subdirectory', () => {
    expect(buildInstallSpec({ repo: 'vobsjs/vobs' }).spec).toBe('github:vobsjs/vobs')
  })

  it('repo + tag', () => {
    expect(buildInstallSpec({ repo: 'vobsjs/vobs', tag: 'v1.7.6' }).spec).toBe('github:vobsjs/vobs#v1.7.6')
  })

  it('repo + tag + subdirectory joined with &', () => {
    expect(buildInstallSpec({ repo: 'vobsjs/vobs', tag: 'v1.7.6', subpath: '/packages/dsh-console' }).spec).toBe(
      'github:vobsjs/vobs#v1.7.6&path:/packages/dsh-console'
    )
  })

  it('repo + subdirectory only starts with #', () => {
    expect(buildInstallSpec({ repo: 'vobsjs/vobs', subpath: '/packages/dsh-plugin' }).spec).toBe(
      'github:vobsjs/vobs#path:/packages/dsh-plugin'
    )
  })

  it('--from resolves to an absolute path', () => {
    const result = buildInstallSpec({ from: '.' })
    expect(result.error).toBeUndefined()
    // This used to assert that spec contains a colon — a **Windows drive letter** proxy,
    // guaranteed to fail on POSIX (/home/runner/... has no colon). Replaced with the real
    // assertion: it is an absolute path.
    expect(path.isAbsolute(result.spec as string)).toBe(true)
  })

  it('errors when --from points at a nonexistent path', () => {
    const result = buildInstallSpec({ from: './definitely-not-here-xyz' })
    expect(result.error).toContain('does not exist')
  })

  it('errors with the available options when nothing is given', () => {
    const result = buildInstallSpec({})
    expect(result.error).toContain('--spec')
  })
})

/* ---------------------------------------------------------- buildShellCommand */

describe('buildShellCommand', () => {
  it('quotes a spec containing &, otherwise cmd treats it as a command separator', () => {
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

  it('plain arguments get no extra quotes', () => {
    expect(buildShellCommand('dsh', ['plugin', '--profile', 'desktop'])).toBe('dsh plugin --profile desktop')
  })

  it('arguments with spaces are quoted', () => {
    expect(buildShellCommand('dsh', ['add', 'C:/my plugins/demo'])).toBe('dsh add "C:/my plugins/demo"')
  })

  it('double quotes inside an argument are doubled per cmd rules', () => {
    expect(buildShellCommand('dsh', ['add', 'a"b'])).toBe('dsh add "a""b"')
  })
})

/* ------------------------------------------------------------ dev preview page */

describe('buildPreviewHtml', () => {
  const html = buildPreviewHtml({ packageName: 'dsh-plugin-demo' })

  it('installs the __ModuleLoader__ shim before the plugin bundle', () => {
    const shimAt = html.indexOf('window.__ModuleLoader__')
    const bundleAt = html.indexOf('<script src="/client.js">')
    expect(shimAt).toBeGreaterThan(-1)
    expect(bundleAt).toBeGreaterThan(shimAt)
  })

  it('the shim collects factories into a registry instead of executing them', () => {
    expect(html).toContain('factories.set(entry.id, entry.factory)')
  })

  it('boots via startPreview and passes the package name', () => {
    expect(html).toContain("from '/preview.js'")
    expect(html).toContain('packageName: "dsh-plugin-demo"')
  })

  it('subscribes to SSE so rebuilds auto-refresh', () => {
    expect(html).toContain("new EventSource('/events')")
    expect(html).toContain('location.reload()')
  })

  it('the package name is escaped; a </script> cannot break out of the script tag', () => {
    const injected = buildPreviewHtml({ packageName: '</script><script>alert(1)</script>' })
    expect(injected).toContain('packageName: "\\u003c/script>')
    expect(injected).not.toContain('</script><script>alert(1)')
  })

  it('HTML metacharacters are stripped from the title', () => {
    const html = buildPreviewHtml({ packageName: 'p', title: '<img src=x onerror=alert(1)>' })
    expect(html).toContain('<title>vobs preview · img src=x onerror=alert(1)</title>')
    expect(html).not.toContain('<img')
  })
})

describe('resolveExport', () => {
  it('returns the string form directly', () => {
    expect(resolveExport({ exports: { './client': './lib/client.js' } }, './client')).toBe('./lib/client.js')
  })

  it('conditions objects are read in default / import / require order', () => {
    expect(resolveExport({ exports: { './client': { import: './lib/client.mjs' } } }, './client')).toBe('./lib/client.mjs')
    expect(resolveExport({ exports: { './client': { require: './lib/client.cjs' } } }, './client')).toBe('./lib/client.cjs')
    expect(
      resolveExport({ exports: { './client': { types: './x.d.ts', default: './lib/client.js' } } }, './client')
    ).toBe('./lib/client.js')
  })

  it('returns undefined when missing', () => {
    expect(resolveExport({ exports: {} }, './client')).toBeUndefined()
    expect(resolveExport({}, './client')).toBeUndefined()
  })
})
