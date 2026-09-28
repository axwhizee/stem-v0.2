// skill 与 MCP 实景：真实 SKILL.md 读取；mcp.jsonc 投影 websearch 样工具。

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bootStem } from '../../shell/host/index.ts'
import { allowAll, type ToolResult } from '../../src/core/tools/index.ts'

function asOk(r: unknown): ToolResult {
  assert.ok(typeof r === 'object' && r !== null && 'kind' in r)
  return r as ToolResult
}

const SKILL_BODY = `# demo-skill

## Steps
1. Ask the goal
2. Produce a short plan
3. Execute one step and report
`

describe('skill 与 MCP 实景', () => {
  let space = ''
  let boot: Awaited<ReturnType<typeof bootStem>>

  before(async () => {
    space = mkdtempSync(join(tmpdir(), 'stem-skill-mcp-'))
    mkdirSync(join(space, '.stem', 'skills', 'demo-skill'), { recursive: true })
    writeFileSync(
      join(space, '.stem', 'skills', 'demo-skill', 'SKILL.md'),
      `---\nname: demo-skill\ndescription: "List steps, execute one, report."\nicon: "🧪"\n---\n${SKILL_BODY}`,
      'utf8',
    )
    // websearch 样 MCP 服务器：tools/list 投影 + tools/call 回检索结果
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
            reply({
              tools: [
                {
                  name: 'websearch',
                  description: 'Search the web',
                  inputSchema: {
                    type: 'object',
                    properties: { query: { type: 'string' } },
                    required: ['query'],
                  },
                },
              ],
            })
          else if (msg.method === 'tools/call')
            reply({ hits: ['https://example.com/' + encodeURIComponent(msg.params?.arguments?.query ?? '')] })
        }
      })
    `
    writeFileSync(
      join(space, '.stem', 'mcp.jsonc'),
      JSON.stringify(
        {
          mcpServers: {
            search: {
              command: process.execPath,
              args: ['-e', server],
              access: 'allow',
            },
          },
        },
        null,
        2,
      ),
      'utf8',
    )
    // 点名 skill；websearch 由 MCP 投影提供，不点名 extension 桩
    writeFileSync(
      join(space, '.stem', 'stem.jsonc'),
      JSON.stringify(
        {
          user: { model: 'opencode-go/deepseek-v4.1-flash' },
          extensions: {
            tools: { skill: 'allow' },
            strategy: {},
          },
        },
        null,
        2,
      ),
      'utf8',
    )
    boot = await bootStem({
      projectRoot: space,
      stateStore: false,
      fakeGateway: true,
      timer: {
        set: (_m, fn) => {
          const t = setTimeout(fn, 10)
          return () => clearTimeout(t)
        },
      },
    })
  })

  after(async () => {
    await boot.close()
  })

  it('skill 列表与正文装载', async () => {
    const sys = boot.system
    const list = asOk(await sys.tools.execute('0', 'skill', {}, allowAll(), {}))
    assert.equal(list.kind, 'tool_ok')
    assert.ok(list.kind === 'tool_ok' && list.content.includes('demo-skill'))

    const body = asOk(await sys.tools.execute('0', 'skill', { name: 'demo-skill' }, allowAll(), {}))
    assert.equal(body.kind, 'tool_ok')
    assert.ok(body.kind === 'tool_ok' && body.content.includes('Produce a short plan'))
    assert.ok(body.kind === 'tool_ok' && body.content.includes('demo-skill'))
  })

  it('mcp 投影 websearch 并转发检索', async () => {
    const sys = boot.system
    assert.ok(sys.tools.names().includes('websearch'))
    const r = asOk(
      await sys.tools.execute('0', 'websearch', { query: 'stem agent' }, allowAll(), {}),
    )
    assert.equal(r.kind, 'tool_ok')
    assert.ok(r.kind === 'tool_ok' && r.content.includes('https://example.com/stem%20agent'))
  })
})
