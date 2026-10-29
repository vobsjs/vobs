#!/usr/bin/env node
/**
 * Vobs Studio MCP server (stdio, newline-delimited JSON-RPC — same transport as `vobs mcp`).
 *
 * Register this in the DSH agent session's mcpServers. Tools:
 *   - design_contract       — the design contract (framework rules, tokens, components, principles)
 *   - design_scaffold       — write a neutral vobs+Tailwind project baseline into the workspace
 *   - design_check          — static-check a vobs component snippet BEFORE writing it (C-diagnostics)
 *   - design_preview_build  — build the project, serve dist/ on 127.0.0.1, write the Studio
 *                             preview manifest (.vobs/studio/preview.json); skipped when
 *                             sources are unchanged since the last build
 *
 * Runtime dependency: @vobs/compiler (design_check). Everything else is node builtins.
 *
 * Workspace resolution: a globally registered stdio server serves ALL sessions, so every
 * filesystem tool takes an explicit `workspace` argument (the agent's session cwd). When
 * omitted it falls back to process.cwd() — direct-CLI use and legacy cwd-pinned configs.
 */
import { createServer } from 'node:http'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { analyzeSource } from '@vobs/compiler'

const here = dirname(fileURLToPath(import.meta.url))
const PROTOCOL_VERSION = '2025-06-18'
const SERVER_INFO = { name: 'vobs-studio-mcp', version: '0.1.0' }
const DEFAULT_PORT = 5218
const MANIFEST_PATH = '.vobs/studio/preview.json'
const CONTRACT = readFileSync(join(here, 'design-contract.md'), 'utf8')

/**
 * Shared `workspace` argument for every tool that touches the filesystem.
 *
 * A globally registered stdio MCP server has ONE process for ALL sessions — it cannot
 * know which session's workspace a call belongs to. The agent (which always knows its
 * own cwd) passes it per call; process.cwd() remains as the fallback for direct CLI
 * use and for the old registration style (cwd pinned in the patch config).
 */
const WORKSPACE_PARAM = {
  type: 'string',
  description: "Absolute path of the current session's workspace (the session cwd). Pass it on every call."
}

function resolveWorkspace(args) {
  const raw = String(args.workspace ?? '').trim()
  if (raw === '') return process.cwd()
  const resolved = resolve(raw)
  if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
    throw new Error(`workspace is not a directory: ${resolved}`)
  }
  return resolved
}

/* ------------------------------------------------------------------ tools */

const TOOLS = [
  {
    name: 'design_contract',
    description:
      'Return the Vobs Studio design contract: framework rules, design tokens, the @vobs/ui component inventory, design principles, the preview manifest contract and the forbidden list. Call this FIRST, before generating any page code.',
    inputSchema: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          enum: ['all', 'rules', 'tokens', 'components', 'principles', 'pages', 'preview', 'forbidden'],
          description: 'Section to return. "all" returns everything (default).'
        }
      }
    }
  },
  {
    name: 'design_scaffold',
    description:
      'Write a NEUTRAL vobs + Tailwind project baseline (package.json pinned to @vobs 1.9.1, vite MPA config, theme wiring, one empty proof page, DESIGN.md template — no layout opinions) into <dir> under <workspace>. Run once per project; then `pnpm install` inside it. Fill DESIGN.md per contract §0.5 (design direction) BEFORE writing any page — layout and architecture are YOUR decision per the design contract.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: WORKSPACE_PARAM,
        dir: { type: 'string', description: 'Project directory relative to the workspace root, e.g. "my-app".' },
        name: { type: 'string', description: 'npm package name (defaults to the dir name).' }
      },
      required: ['dir']
    }
  },
  {
    name: 'design_check',
    description:
      'Two modes. SNIPPET MODE (pass `code`): static-check a vobs component WITHOUT writing it — returns all VOBS_C* diagnostics (compile + analyze) with verified rewrites; run on EVERY new or changed .tsx BEFORE writing it, zero diagnostics is the bar. PROJECT MODE (pass `workspace` + `dir`, no code): run tsc --noEmit over the scaffolded project — returns type errors to fix; run after writing files and BEFORE design_preview_build (static C diagnostics do NOT cover TypeScript types).',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'SNIPPET MODE: the complete .tsx snippet to check.' },
        filename: { type: 'string', description: 'Snippet mode: virtual filename for diagnostics (default snippet.tsx).' },
        workspace: WORKSPACE_PARAM,
        dir: { type: 'string', description: 'PROJECT MODE: project directory relative to the workspace root; runs tsc --noEmit over it.' }
      }
    }
  },
  {
    name: 'design_preview_build',
    description:
      'Build the project (vite build), serve its dist/ on http://127.0.0.1:<port> with live-reload injection, and write .vobs/studio/preview.json so the Vobs Studio panel lists every page. Skips the build when sources are unchanged. Call after every batch of page changes.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: WORKSPACE_PARAM,
        dir: { type: 'string', description: 'Project directory relative to the workspace root.' },
        port: { type: 'number', description: 'Static server port (default 5218).' }
      },
      required: ['dir']
    }
  }
]

const CONTRACT_SECTIONS = {
  rules: /## 1\.[\s\S]*?(?=\n## 2\.)/u,
  tokens: /## 2\.[\s\S]*?(?=\n## 3\.)/u,
  components: /## 3\.[\s\S]*?(?=\n## 3\.5|## 4\.)/u,
  principles: /## 3\.5[\s\S]*?(?=\n## 4\.)/u,
  pages: /## 4\.[\s\S]*?(?=\n## 5\.)/u,
  preview: /## 5\.[\s\S]*?(?=\n## 6\.)/u,
  forbidden: /## 7\.[\s\S]*$/u
}

function contractText(topic) {
  if (topic === undefined || topic === 'all') return CONTRACT
  const re = CONTRACT_SECTIONS[topic]
  const match = re?.exec(CONTRACT)
  return match !== null && match !== undefined && match[0] !== undefined ? match[0].trim() : CONTRACT
}

/* --------------------------------------------------------------- scaffold */

function listFiles(dir, base = '') {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const rel = base === '' ? entry : `${base}/${entry}`
    if (statSync(full).isDirectory()) out.push(...listFiles(full, rel))
    else out.push(rel)
  }
  return out
}

function doScaffold(workspace, request) {
  const dir = String(request.dir ?? '').replace(/^[\\/]+/u, '')
  if (dir === '') throw new Error('dir is required')
  if (dir.includes('..')) throw new Error('dir must stay inside the workspace')
  const name = String(request.name ?? dir.replace(/[^\w.-]+/gu, '-'))
  const target = resolve(workspace, dir)
  if (existsSync(resolve(target, 'package.json'))) return `Project already scaffolded at ${dir}/ (package.json exists) — skip.`

  const sourceDir = join(here, 'scaffold')
  let count = 0
  for (const rel of listFiles(sourceDir)) {
    const from = join(sourceDir, rel)
    const to = join(target, rel.replace(/\.tmpl$/u, ''))
    mkdirSync(dirname(to), { recursive: true })
    let content = readFileSync(from, 'utf8')
    if (rel.endsWith('.tmpl')) content = content.replaceAll('{{NAME}}', name).replaceAll('{{TITLE}}', 'Dashboard')
    writeFileSync(to, content, 'utf8')
    count += 1
  }
  return [
    `Scaffolded ${count} files into ${dir}/ (vobs + Tailwind, @vobs deps pinned to 1.9.1).`,
    'Next: fill DESIGN.md (contract §0.5 — archetype / typography / color story / signature) before writing any page, then run `pnpm install` inside it.',
    'Reference the design_contract sections "rules", "components" and "pages" before writing page code.'
  ].join('\n')
}

/* ------------------------------------------------------- preview build+serve */

let server = null
let serverPort = 0
let serverRoot = ''
let serverFirstPage = '/home.html'
let manifestVersion = 0
const sseClients = new Set()

const RELOAD_SNIPPET = `<script>try{new EventSource('/__studio_reload').onmessage=function(m){if(m.data==='reload')location.reload()}}catch(e){}</script>`

function startServer(root, port) {
  if (server !== null && serverPort === port && serverRoot === root) return Promise.resolve(serverPort)
  if (server !== null) {
    server.close()
    server = null
  }
  serverRoot = root
  const htmls = listFiles(root).filter(f => f.endsWith('.html')).sort()
  serverFirstPage = '/' + (htmls.find(f => f.endsWith('home.html')) ?? htmls[0] ?? 'home.html').replace(/\\/gu, '/')

  /**
   * Bind through a promise and walk upwards on EADDRINUSE: a global stdio registration
   * means several Studio MCP server processes can coexist (one per DSH host/session), and
   * an unhandled 'error' event on listen() would CRASH this whole MCP server process.
   * The caller reports the actually bound port.
   */
  return new Promise((resolveListen, rejectListen) => {
    const tryBind = (candidate, attemptsLeft) => {
      const candidateServer = createServer(handleRequest)
      candidateServer.once('error', (error) => {
        if (error !== null && error?.code === 'EADDRINUSE' && attemptsLeft > 0) tryBind(candidate + 1, attemptsLeft - 1)
        else rejectListen(error ?? new Error('static server could not bind'))
      })
      candidateServer.listen(candidate, '127.0.0.1', () => {
        server = candidateServer
        serverPort = candidate
        resolveListen(candidate)
      })
    }
    tryBind(port, 10)
  })
}

function handleRequest(req, res) {
  {
    let url = (req.url ?? '/').split('?')[0]
    if (url === '/') {
      res.writeHead(302, { Location: serverFirstPage })
      res.end()
      return
    }
    if (url === '/__studio_reload') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
      res.write('retry: 2000\n\n')
      sseClients.add(res)
      req.on('close', () => sseClients.delete(res))
      return
    }
    const safe = url === '/' ? '/home.html' : url
    const file = resolve(serverRoot, '.' + safe)
    if (!file.startsWith(resolve(serverRoot)) || !existsSync(file) || statSync(file).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('not found')
      return
    }
    const ext = file.endsWith('.html') ? 'text/html; charset=utf-8'
      : file.endsWith('.js') ? 'text/javascript'
      : file.endsWith('.css') ? 'text/css'
      : 'application/octet-stream'
    let body = readFileSync(file)
    if (ext.startsWith('text/html')) {
      body = Buffer.from(body.toString('utf8').replace('</body>', `${RELOAD_SNIPPET}</body>`), 'utf8')
    }
    res.writeHead(200, { 'Content-Type': ext, 'Cache-Control': 'no-cache' })
    res.end(body)
  }
}

function buildProject(project) {
  // Prefer the local vite entry via this Node binary — no shell, no pnpm dependency.
  const viteJs = resolve(project, 'node_modules', 'vite', 'bin', 'vite.js')
  if (existsSync(viteJs)) {
    execFileSync(process.execPath, [viteJs, 'build'], { cwd: project, stdio: 'pipe', timeout: 180_000 })
    return
  }
  // Fallback: let the package manager resolve vite (project without a local install).
  execFileSync('pnpm', ['exec', 'vite', 'build'], { cwd: project, stdio: 'pipe', shell: true, timeout: 180_000 })
}

/** Newest mtime across everything that affects the build output. */
function sourcesFingerprint(project) {
  let newest = 0
  const scan = dir => {
    if (!existsSync(dir)) return
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue
      const full = join(dir, entry)
      const s = statSync(full)
      if (s.isDirectory()) scan(full)
      else if (s.mtimeMs > newest) newest = s.mtimeMs
    }
  }
  scan(project)
  return newest
}

const lastBuildFingerprints = new Map()

async function doPreviewBuild(workspace, request) {
  const dir = String(request.dir ?? '').replace(/^[\\/]+/u, '')
  if (dir === '') throw new Error('dir is required')
  if (dir.includes('..')) throw new Error('dir must stay inside the workspace')
  const project = resolve(workspace, dir)
  if (!existsSync(resolve(project, 'package.json'))) throw new Error(`no package.json in ${dir}/ — run design_scaffold first`)

  const dist = resolve(project, 'dist')
  const fingerprint = sourcesFingerprint(project)
  const unchanged = lastBuildFingerprints.get(dir) === fingerprint && existsSync(dist) && existsSync(resolve(workspace, MANIFEST_PATH))
  if (unchanged) {
    // Sources untouched since the last build: only make sure the server is up and the
    // manifest is fresh — a rebuild would produce byte-identical output.
    const port = await startServer(dist, Number(request.port ?? DEFAULT_PORT))
    const pages = collectPages(dist, dir)
    const manifest = {
      version: manifestVersion,
      server: { origin: `http://127.0.0.1:${port}` },
      project: { name: dir, dir },
      pages
    }
    writeManifest(workspace, manifest)
    return `Sources unchanged since the last build — skipped vite build. Serving ${pages.length} page(s) at http://127.0.0.1:${port} (manifest version ${manifestVersion}).`
  }

  buildProject(project)

  if (!existsSync(dist)) throw new Error('vite build produced no dist/ — check the build output')
  lastBuildFingerprints.set(dir, fingerprint)

  const port = await startServer(dist, Number(request.port ?? DEFAULT_PORT))
  const pages = collectPages(dist, dir)
  manifestVersion += 1
  const manifest = {
    version: manifestVersion,
    server: { origin: `http://127.0.0.1:${port}` },
    project: { name: dir, dir },
    pages
  }
  writeManifest(workspace, manifest)

  for (const client of sseClients) client.write('data: reload\n\n')
  return [
    `Built ${pages.length} page(s); serving ${dir}/dist at http://127.0.0.1:${port}.`,
    `Manifest written to ${MANIFEST_PATH} (version ${manifestVersion}) — the Studio panel picks it up within ~2.5s.`,
    `Pages: ${pages.map(p => p.id).join(', ')}`
  ].join('\n')
}

/** vite preserves the input's directory structure under root (pages/home.html → dist/pages/home.html),
 *  so walk dist recursively for HTML entries. */
function collectPages(dist, dir) {
  return listFiles(dist)
    .filter(f => f.endsWith('.html'))
    .map(f => {
      const html = readFileSync(join(dist, f), 'utf8')
      const title = /<title>([^<]*)<\/title>/u.exec(html)?.[1] ?? f.replace(/\.html$/u, '')
      // `file` is resolved by the Studio panel as `server.origin + '/' + file`, and the
      // static server's root IS dist/ — so it must be dist-relative, not workspace-relative.
      return { id: f.replace(/^pages\//u, '').replace(/\.html$/u, ''), title, route: `/${f}`, file: f.replace(/\\/gu, '/') }
    })
}

function writeManifest(workspace, manifest) {
  const manifestFile = resolve(workspace, MANIFEST_PATH)
  mkdirSync(dirname(manifestFile), { recursive: true })
  writeFileSync(manifestFile, JSON.stringify(manifest, null, 2), 'utf8')
}

/* ------------------------------------------------------------------ stdio */

const respond = (result) => ({ jsonrpc: '2.0', id: currentId, result })
let currentId = null
const writeMessage = (message) => {
  process.stdout.write(JSON.stringify(message) + '\n')
}

function handle(request) {
  currentId = request.id
  if (request.method === 'initialize') {
    return respond({ protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: SERVER_INFO })
  }
  if (request.method === 'tools/list') {
    return respond({ tools: TOOLS })
  }
  if (request.method === 'tools/call') {
    const { name, arguments: args } = request.params ?? {}
    // design_preview_build awaits a server bind, so the whole call path is async; the
    // response is written when it settles (handle() itself returns null for this method).
    void (async () => {
      try {
        let text
        if (name === 'design_contract') text = contractText(args?.topic)
        else if (name === 'design_scaffold') text = doScaffold(resolveWorkspace(args ?? {}), args ?? {})
        else if (name === 'design_check') text = args?.dir !== undefined
          ? doProjectTypes(resolveWorkspace(args ?? {}), args ?? {})
          : doDesignCheck(args ?? {})
        else if (name === 'design_preview_build') text = await doPreviewBuild(resolveWorkspace(args ?? {}), args ?? {})
        else return writeMessage(respond({ content: [{ type: 'text', text: `unknown tool ${name}` }], isError: true }))
        writeMessage(respond({ content: [{ type: 'text', text }] }))
      } catch (error) {
        const message = error instanceof Error ? `${error.message}\n${error.stderr ?? ''}` : String(error)
        writeMessage(respond({ content: [{ type: 'text', text: message }], isError: true }))
      }
    })()
    return null
  }
  if (request.method === 'notifications/initialized') return null
  return respond({ content: [{ type: 'text', text: `unknown method ${request.method}` }], isError: true })
}

/* ------------------------------------------------------------ design check */

function doDesignCheck(request) {
  const code = String(request.code ?? '')
  if (code.trim() === '') throw new Error('code is required')
  const filename = String(request.filename ?? 'snippet.tsx')
  const diagnostics = analyzeSource(code, filename)
  if (diagnostics.length === 0) {
    return `✓ 0 diagnostics — ${filename} is clean. Safe to write into the project.`
  }
  return [
    `✗ ${diagnostics.length} diagnostic(s) in ${filename} — fix BEFORE writing:`,
    '',
    ...diagnostics.map(d => [
      `[${d.code}] ${d.severity} — ${d.message}`,
      `  at ${d.file}:${d.line}:${d.column}`,
      d.fix !== undefined && d.fix !== '' ? `  fix: ${d.fix.split('\n')[0]}` : ''
    ].filter(line => line !== '').join('\n'))
  ].join('\n')
}

const TSC_OUTPUT_CAP = 40

/**
 * PROJECT MODE: `tsc --noEmit` over the scaffolded project, via the local typescript
 * the project itself installs (no global dependency). Non-zero exit IS the expected
 * "has errors" signal — the output is the result, not a failure of the tool.
 */
function doProjectTypes(workspace, request) {
  const dir = String(request.dir ?? '').replace(/^[\\/]+/u, '')
  if (dir === '') throw new Error('dir is required (project mode)')
  if (dir.includes('..')) throw new Error('dir must stay inside the workspace')
  const project = resolve(workspace, dir)
  if (!existsSync(resolve(project, 'package.json'))) throw new Error(`no package.json in ${dir}/ — run design_scaffold first`)
  const tscJs = resolve(project, 'node_modules', 'typescript', 'bin', 'tsc')
  if (!existsSync(tscJs)) throw new Error(`typescript is not installed in ${dir}/ — run pnpm install first`)

  let output = ''
  try {
    output = execFileSync(process.execPath, [tscJs, '--noEmit'], { cwd: project, stdio: 'pipe', timeout: 180_000 }).toString()
  } catch (error) {
    output = `${error.stdout ?? ''}\n${error.stderr ?? ''}`
  }
  const errorLines = output.split('\n').filter(line => /error TS\d+/u.test(line))
  if (errorLines.length === 0) return `✓ tsc --noEmit: 0 type errors in ${dir}/.`
  return [
    `✗ tsc --noEmit: ${errorLines.length} type error(s) in ${dir}/ — fix BEFORE design_preview_build:`,
    '',
    ...errorLines.slice(0, TSC_OUTPUT_CAP),
    ...(errorLines.length > TSC_OUTPUT_CAP ? [`… ${errorLines.length - TSC_OUTPUT_CAP} more`] : [])
  ].join('\n')
}

import { createInterface } from 'node:readline'
const rl = createInterface({ input: process.stdin })
rl.on('line', line => {
  const trimmed = line.trim()
  if (trimmed === '') return
  let request
  try {
    request = JSON.parse(trimmed)
  } catch {
    return
  }
  const response = handle(request)
  if (response !== null && response !== undefined) writeMessage(response)
})
rl.on('close', () => {
  const finish = () => {
    if (server !== null) server.close(() => process.exit(0))
    else process.exit(0)
  }
  for (const client of sseClients) client.end()
  sseClients.clear()
  finish()
})
