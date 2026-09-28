// MCP 客户端：配置解析、env 替换、stdio 投影与转发。

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseMcpConfig, resolveEnvRefs, loadMcpTools } from './mcp.ts'
import type { ToolResult } from '../../src/core/tools/index.ts'

describe('mcp', () => {
  it('解析 mcpServers；缺 mcpServers 报错', () => {
    const ok = parseMcpConfig('{"mcpServers":{"a":{"command":"x"}}}')
    assert.ok(!('kind' in ok))
    assert.equal(ok.mcpServers.a?.command, 'x')
    const bad = parseMcpConfig('{}')
    assert.ok('kind' in bad)
  })

  it('resolveEnvRefs 替换 {env:NAME}', () => {
    assert.equal(resolveEnvRefs('Bearer {env:TOK}', { TOK: 'secret' }), 'Bearer secret')
    assert.equal(resolveEnvRefs('keep {env:MISSING}', {}), 'keep {env:MISSING}')
  })

  it('stdio 投影 tools/list 并转发 tools/call', async () => {
    const server = `
      let buf = ''
      process.stdin.setEncoding('utf8')
      process.stdin.on('data', (c) => {
        buf += c
        let i = buf.indexOf('\\n')
        while (i >= 0) {
          const line = buf.slice(0, i)
          buf = buf.slice(i + 1)
          i = buf.indexOf('\\n')
          if (!line.trim()) continue
          const msg = JSON.parse(line)
          const reply = (result) =>
            process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }) + '\\n')
          if (msg.method === 'initialize') reply({})
          else if (msg.method === 'tools/list')
            reply({ tools: [{ name: 'echo', description: 'echo args', inputSchema: { type: 'object' } }] })
          else if (msg.method === 'tools/call')
            reply('echoed:' + JSON.stringify(msg.params?.arguments ?? {}))
        }
      })
    `
    const loaded = await loadMcpTools({
      local: {
        command: process.execPath,
        args: ['-e', server],
      },
    })
    assert.equal(loaded.issues.length, 0)
    assert.equal(loaded.tools.length, 1)
    const tool = loaded.tools[0]!
    assert.equal(tool.name, 'echo')
    assert.equal(tool.registerAccess, 'hidden')
    const r = (await tool.execute({ n: 1 }, { agentId: '0' } as never)) as ToolResult
    assert.equal(r.kind, 'tool_ok')
    assert.ok(r.kind === 'tool_ok' && String(r.content).includes('echoed'))
    await loaded.dispose()
  })

  it('连接失败 issue 留痕不抛', async () => {
    const loaded = await loadMcpTools({
      bad: { command: 'definitely-not-a-command-xyz' },
    })
    assert.equal(loaded.tools.length, 0)
    assert.equal(loaded.issues.length, 1)
    await loaded.dispose()
  })
})
