/*
 * `vobs mcp` — **protocol-layer** tests for the MCP stdio server.
 *
 * Goes through the `handleMcpMessage` pure function (not stdio): the AI agent's integration
 * surface is message-in / message-out, so protocol behavior can be asserted case by case.
 * `check_runtime` depends on Chrome + a dev server (slow), so the protocol layer only tests
 * "the clear error when the script is missing"; real execution is covered by the manual
 * `check:runtime` channel.
 */
import { describe, expect, it } from 'vitest'
import { createMcpState, handleMcpMessage } from './mcp'

const state = (): ReturnType<typeof createMcpState> => createMcpState(process.cwd())

describe('vobs mcp · protocol layer', () => {
  it('initialize returns the protocol version + tools capability + serverInfo', () => {
    const response = handleMcpMessage(state(), { jsonrpc: '2.0', id: 1, method: 'initialize' }) as {
      result: { protocolVersion: string; capabilities: { tools: object }; serverInfo: { name: string } }
    }
    expect(response.result.protocolVersion).toBe('2024-11-05')
    expect(response.result.capabilities.tools).toEqual({})
    expect(response.result.serverInfo.name).toBe('vobs-mcp')
  })

  it('notifications/initialized is a notification — no response is produced', () => {
    expect(handleMcpMessage(state(), { jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull()
  })

  it('tools/list exposes four tools, each with an inputSchema and a description', () => {
    const response = handleMcpMessage(state(), { jsonrpc: '2.0', id: 2, method: 'tools/list' }) as {
      result: { tools: { name: string; description: string; inputSchema: object }[] }
    }
    const names = response.result.tools.map(tool => tool.name)
    expect(names).toEqual(['check_source_snippet', 'check_runtime', 'explain_diagnostic', 'contract_status'])
    for (const tool of response.result.tools) expect(tool.description.length).toBeGreaterThan(20)
  })

  it('tools/call check_source_snippet: pre-write self-check without touching disk — a violating snippet returns C118 + fix', () => {
    const response = handleMcpMessage(state(), {
      jsonrpc: '2.0', id: 3,
      method: 'tools/call',
      params: {
        name: 'check_source_snippet',
        arguments: {
          code: "import { state } from '@vobs/vobs'\nexport function P() {\n  const count = state(0)\n  const snapshot = count.value\n  return <div>{snapshot}</div>\n}"
        }
      }
    }) as { result: { content: { text: string }[] } }
    const verdict = JSON.parse(response.result.content[0]!.text) as {
      pass: boolean; diagnostics: { code: string; fix: string }[]
    }
    expect(verdict.pass).toBe(false)
    expect(verdict.diagnostics.map(item => item.code)).toContain('VOBS_C118')
    for (const item of verdict.diagnostics) expect(item.fix.length).toBeGreaterThan(0)
  })

  it('tools/call check_source_snippet: a clean snippet yields zero diagnostics, with a hint pointing at runtime verification', () => {
    const response = handleMcpMessage(state(), {
      jsonrpc: '2.0', id: 4,
      method: 'tools/call',
      params: {
        name: 'check_source_snippet',
        arguments: {
          code: "import { state } from '@vobs/vobs'\nexport function P() {\n  const count = state(0, 'count')\n  return <div>{count.value}</div>\n}"
        }
      }
    }) as { result: { content: { text: string }[] } }
    const verdict = JSON.parse(response.result.content[0]!.text) as { pass: boolean; hint: string }
    expect(verdict.pass).toBe(true)
    expect(verdict.hint).toContain('check_runtime')
  })

  it('tools/call explain_diagnostic returns full metadata including rewrites (the code arrives with its rewrite instructions)', () => {
    const response = handleMcpMessage(state(), {
      jsonrpc: '2.0', id: 3,
      method: 'tools/call',
      params: { name: 'explain_diagnostic', arguments: { code: 'C233' } }
    }) as { result: { content: { type: string; text: string }[] } }
    const text = response.result.content[0]!.text
    expect(text).toContain('VOBS_C233')
    expect(text).toContain('"rewrites"')
    expect(text).toContain('correct')
    // Short codes get their prefix completed automatically
    expect(text).not.toContain('No entry for VOBS_C233')
  })

  it('explain_diagnostic for an unknown code — states plainly that there is no entry and lists covered codes (no inventing)', () => {
    const response = handleMcpMessage(state(), {
      jsonrpc: '2.0', id: 4,
      method: 'tools/call',
      params: { name: 'explain_diagnostic', arguments: { code: 'VOBS_C999' } }
    }) as { result: { isError: boolean; content: { text: string }[] } }
    expect(response.result.isError).toBe(true)
    expect(response.result.content[0]!.text).toContain('No entry for VOBS_C999')
    expect(response.result.content[0]!.text).toContain('VOBS_C234')
  })

  it('contract_status returns one of the four states (this repo has a hand-written AGENTS.md with no marker block → no-block)', () => {
    const response = handleMcpMessage(state(), {
      jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'contract_status', arguments: {} }
    }) as { result: { content: { text: string }[] } }
    const parsed = JSON.parse(response.result.content[0]!.text) as { status: string }
    expect(['synced', 'missing', 'no-block', 'drifted']).toContain(parsed.status)
  })

  it('an unknown method returns the JSON-RPC error -32601', () => {
    const response = handleMcpMessage(state(), { jsonrpc: '2.0', id: 6, method: 'resources/list' }) as {
      error: { code: number; message: string }
    }
    expect(response.error.code).toBe(-32601)
    expect(response.error.message).toContain('resources/list')
  })

  it('check_runtime outside a monorepo layout returns a clear unavailability notice (instead of crashing)', () => {
    const emptyState = createMcpState('\\\\.\\nonexistent-root')
    const response = handleMcpMessage(emptyState, {
      jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'check_runtime', arguments: {} }
    }) as { result: { isError: boolean; content: { text: string }[] } }
    expect(response.result.isError).toBe(true)
    expect(response.result.content[0]!.text).toContain('check-runtime.mjs')
    expect(response.result.content[0]!.text).toContain('not found')
  })
})
