/* Two-phase E2E for the Studio MCP server (sandbox cannot spawn cmd.exe, so `pnpm install`
 * runs between phases via the outer shell):
 *   node scripts/mcp-e2e.mjs scaffold  → phase 1: init/tools/design_check/scaffold
 *   (outer shell: pnpm install in the workspace project)
 *   node scripts/mcp-e2e.mjs preview   → phase 2: build + serve + manifest + skip + http checks
 */
import { spawn, execSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'

const phase = process.argv[2] ?? 'scaffold'
const stateFile = join(process.cwd(), '.artifacts', 'e2e-workspace.txt')

const workspace = phase === 'scaffold' ? mkdtempSync(join(tmpdir(), 'studio-mcp-')) : readFileSync(stateFile, 'utf8').trim()
if (phase === 'scaffold') writeFileSync(stateFile, workspace, 'utf8')
console.log('phase:', phase, '| workspace:', workspace)

const child = spawn(process.execPath, [join(process.cwd(), 'mcp', 'index.mjs')], { cwd: workspace, stdio: ['pipe', 'pipe', 'pipe'] })
child.stderr.on('data', d => process.stderr.write('[server] ' + d))

const pending = new Map()
let nextId = 1
child.stdout.on('data', chunk => {
  for (const line of chunk.toString().split('\n')) {
    if (line.trim() === '') continue
    const msg = JSON.parse(line)
    const resolve = pending.get(msg.id)
    if (resolve) { pending.delete(msg.id); resolve(msg) }
  }
})

function call(method, params) {
  const id = nextId++
  return new Promise((resolvePromise) => {
    pending.set(id, resolvePromise)
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  })
}
const tools = async (name, args) => {
  const res = await call('tools/call', { name, arguments: args })
  return res.result?.content?.[0]?.text ?? JSON.stringify(res.result)
}

let failures = 0
const check = (label, ok, detail = '') => {
  console.log((ok ? '  ok   ' : '  FAIL ') + label + (ok || detail === '' ? '' : ' — ' + detail))
  if (!ok) failures += 1
}

const init = await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } })
check('initialize returns serverInfo', init.result?.serverInfo?.name === 'vobs-studio-mcp', JSON.stringify(init.result?.serverInfo))

if (phase === 'scaffold') {
  const list = await call('tools/list', {})
  check('tools/list has 4 tools', list.result?.tools?.length === 4, String(list.result?.tools?.length))

  const contract = await tools('design_contract', { topic: 'rules' })
  check('design_contract returns the rules section', contract.includes('runs exactly once'), contract.slice(0, 80))
  const principles = await tools('design_contract', { topic: 'principles' })
  check('design_contract returns the principles section', principles.includes('Design principles'), principles.slice(0, 80))

  // design_check: a snippet with an unnamed state must report VOBS_C120; a clean one must pass
  const bad = await tools('design_check', { code: "import { state } from '@vobs/vobs'\nexport function C() { const n = state(0); return <div>{n.value}</div> }" })
  check('design_check flags VOBS_C120 on an unnamed state', bad.includes('VOBS_C120'), bad.slice(0, 160))
  const good = await tools('design_check', { code: "import { state } from '@vobs/vobs'\nexport function C() { const n = state(0, 'n'); return <div>{n.value}</div> }" })
  check('design_check passes a clean snippet', good.includes('0 diagnostics'), good.slice(0, 100))

  const scaffold = await tools('design_scaffold', { dir: 'my-app', name: 'my-app' })
  check('design_scaffold reports success', scaffold.includes('Scaffolded'), scaffold.slice(0, 100))
  check('package.json written with pinned deps', existsSync(join(workspace, 'my-app/package.json')) && readFileSync(join(workspace, 'my-app/package.json'), 'utf8').includes('"@vobs/vobs": "1.9.1"'))
  check('minimal proof page written (no layout opinions)', existsSync(join(workspace, 'my-app/src/pages/home.tsx')) && !existsSync(join(workspace, 'my-app/src/pages/_shared.tsx')))
  console.log('\nNEXT: run `pnpm install` inside ' + join(workspace, 'my-app') + ' then `node scripts/mcp-e2e.mjs preview`')
} else {
  const build1 = await tools('design_preview_build', { dir: 'my-app' })
  check('design_preview_build succeeded', build1.includes('Built'), build1.slice(0, 300))
  const build2 = await tools('design_preview_build', { dir: 'my-app' })
  check('second build skipped (sources unchanged)', build2.includes('skipped vite build'), build2.slice(0, 120))
  check('manifest written', existsSync(join(workspace, '.vobs/studio/preview.json')))
  const manifest = JSON.parse(readFileSync(join(workspace, '.vobs/studio/preview.json'), 'utf8'))
  check('manifest lists home page', manifest.pages?.some(p => p.id === 'home'), JSON.stringify(manifest.pages))

  const origin = manifest.server.origin
  const pageRoute = manifest.pages[0].route
  const res = await fetch(origin + pageRoute)
  const html = await res.text()
  check('static server serves the page', res.status === 200 && html.includes('<div id="root">'), `${pageRoute} → ${res.status}`)
  check('reload snippet injected', html.includes('__studio_reload'))
}

console.log(failures === 0 ? '\nPHASE PASSED' : `\n${failures} CHECKS FAILED`)
child.stdin.end()
setTimeout(() => process.exit(failures === 0 ? 0 : 1), 500)
