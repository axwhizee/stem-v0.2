// pilot —— 扮演接口。

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createPilot } from './Pilot.ts'
import { ROOT_AGENT_ID } from '../model/index.ts'

describe('pilot.callTool', () => {
  it('以被扮演实例身份调用完整工具面', async () => {
    const calls: Array<{ as: string; name: string; input: unknown }> = []
    const pilot = createPilot({
      send: async () => {},
      peek: () => [],
      callTool: async (as, name, input) => {
        calls.push({ as: String(as), name, input })
        return { kind: 'tool_ok', content: 'ok' }
      },
    })
    const r = await pilot.callTool('bash', { command: 'echo hi' })
    assert.equal(r.kind, 'tool_ok')
    assert.equal(calls[0]?.as, ROOT_AGENT_ID)
    assert.equal(calls[0]?.name, 'bash')

    const asChild = pilot.play('1' as never)
    await asChild.callTool('read', { path: 'x' })
    assert.equal(calls[1]?.as, '1')
    assert.equal(calls[1]?.name, 'read')
  })
})
