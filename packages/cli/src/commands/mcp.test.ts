/*
 * `vobs mcp` —— MCP stdio server 的**协议层**测试。
 *
 * 走 `handleMcpMessage` 纯函数（不走 stdio）：AI Agent 的接入面就是消息进/消息出，
 * 协议行为可以逐条断言。`check_runtime` 依赖 Chrome + dev server（慢），协议层只测
 * 「脚本缺失时的明确报错」；真实执行由 `check:runtime` 手动通道覆盖。
 */
import { describe, expect, it } from 'vitest'
import { createMcpState, handleMcpMessage } from './mcp'

const state = (): ReturnType<typeof createMcpState> => createMcpState(process.cwd())

describe('vobs mcp · 协议层', () => {
  it('initialize 返回协议版本 + tools capability + serverInfo', () => {
    const response = handleMcpMessage(state(), { jsonrpc: '2.0', id: 1, method: 'initialize' }) as {
      result: { protocolVersion: string; capabilities: { tools: object }; serverInfo: { name: string } }
    }
    expect(response.result.protocolVersion).toBe('2024-11-05')
    expect(response.result.capabilities.tools).toEqual({})
    expect(response.result.serverInfo.name).toBe('vobs-mcp')
  })

  it('notifications/initialized 是通知 —— 不产生响应', () => {
    expect(handleMcpMessage(state(), { jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull()
  })

  it('tools/list 暴露四个工具，每个都带 inputSchema 与描述', () => {
    const response = handleMcpMessage(state(), { jsonrpc: '2.0', id: 2, method: 'tools/list' }) as {
      result: { tools: { name: string; description: string; inputSchema: object }[] }
    }
    const names = response.result.tools.map(tool => tool.name)
    expect(names).toEqual(['check_source_snippet', 'check_runtime', 'explain_diagnostic', 'contract_status'])
    for (const tool of response.result.tools) expect(tool.description.length).toBeGreaterThan(20)
  })

  it('tools/call check_source_snippet：不写盘的写前自检 —— 违规片段返回 C118 + fix', () => {
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

  it('tools/call check_source_snippet：干净片段零诊断，hint 指向运行时验证', () => {
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

  it('tools/call explain_diagnostic 返回含 rewrites 的完整元数据（AI 拿到码即拿到改写指令）', () => {
    const response = handleMcpMessage(state(), {
      jsonrpc: '2.0', id: 3,
      method: 'tools/call',
      params: { name: 'explain_diagnostic', arguments: { code: 'C233' } }
    }) as { result: { content: { type: string; text: string }[] } }
    const text = response.result.content[0]!.text
    expect(text).toContain('VOBS_C233')
    expect(text).toContain('"rewrites"')
    expect(text).toContain('correct')
    // 短码自动补全前缀
    expect(text).not.toContain('No entry for VOBS_C233')
  })

  it('explain_diagnostic 查不存在的码 —— 明确说没有并列出已收录（不编）', () => {
    const response = handleMcpMessage(state(), {
      jsonrpc: '2.0', id: 4,
      method: 'tools/call',
      params: { name: 'explain_diagnostic', arguments: { code: 'VOBS_C999' } }
    }) as { result: { isError: boolean; content: { text: string }[] } }
    expect(response.result.isError).toBe(true)
    expect(response.result.content[0]!.text).toContain('No entry for VOBS_C999')
    expect(response.result.content[0]!.text).toContain('VOBS_C234')
  })

  it('contract_status 返回四态之一（本仓库手写 AGENTS.md 无标记块 → no-block）', () => {
    const response = handleMcpMessage(state(), {
      jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'contract_status', arguments: {} }
    }) as { result: { content: { text: string }[] } }
    const parsed = JSON.parse(response.result.content[0]!.text) as { status: string }
    expect(['synced', 'missing', 'no-block', 'drifted']).toContain(parsed.status)
  })

  it('未知 method 返回 JSON-RPC 错误 -32601', () => {
    const response = handleMcpMessage(state(), { jsonrpc: '2.0', id: 6, method: 'resources/list' }) as {
      error: { code: number; message: string }
    }
    expect(response.error.code).toBe(-32601)
    expect(response.error.message).toContain('resources/list')
  })

  it('check_runtime 在非 monorepo 目录返回明确的不可用说明（而不是崩溃）', () => {
    const emptyState = createMcpState('\\\\.\\nonexistent-root')
    const response = handleMcpMessage(emptyState, {
      jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'check_runtime', arguments: {} }
    }) as { result: { isError: boolean; content: { text: string }[] } }
    expect(response.result.isError).toBe(true)
    expect(response.result.content[0]!.text).toContain('check-runtime.mjs')
    expect(response.result.content[0]!.text).toContain('not found')
  })
})
