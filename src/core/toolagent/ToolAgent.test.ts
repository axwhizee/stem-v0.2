import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createToolAgent, createInvokeTool } from './ToolAgent.ts'
import { FakeGateway, textEvents } from '../gateway/index.ts'
import { ToolCapabilityRegistry, allowAll, toolOk } from '../tools/index.ts'
import type { ToolCapability } from '../tools/index.ts'

const echo: ToolCapability = {
  name: 'echo',
  description: 'echo',
  kind: 'internal',
  parameters: { type: 'object', properties: { text: { type: 'string' } } },
  registerAccess: 'allow',
  execute: (input) => toolOk(JSON.stringify(input)),
}

describe('ToolAgent', () => {
  it('complete 纯文本轮', async () => {
    const gw = new FakeGateway(() => textEvents('hello'))
    const reg = new ToolCapabilityRegistry()
    await reg.drain([echo], {})
    const agent = createToolAgent(
      { model: 'p/m', tools: [] },
      {
        gateway: gw,
        registry: reg,
        access: allowAll(),
        parseModel: (s) => {
          const [provider, id] = s.split('/')
          return { provider: provider ?? '', id: id ?? '' }
        },
      },
    )
    const r = await agent.complete({
      messages: [{ kind: 'user', content: [{ type: 'text', text: 'hi' }] }],
    })
    assert.equal(r.text, 'hello')
    assert.equal(r.toolRounds, 0)
  })

  it('缺名工具创建期失败', async () => {
    const reg = new ToolCapabilityRegistry()
    await reg.drain([], {})
    assert.throws(() =>
      createToolAgent(
        { model: 'p/m', tools: ['ghost'] },
        {
          gateway: new FakeGateway(() => []),
          registry: reg,
          access: allowAll(),
          parseModel: (s) => ({ provider: 'p', id: s }),
        },
      ),
    )
  })

  it('invoke 包装', async () => {
    const gw = new FakeGateway(() => textEvents('out'))
    const reg = new ToolCapabilityRegistry()
    await reg.drain([echo], {})
    const agent = createToolAgent(
      { model: 'p/m', tools: [] },
      {
        gateway: gw,
        registry: reg,
        access: allowAll(),
        parseModel: (s) => ({ provider: 'p', id: s }),
      },
    )
    const tool = createInvokeTool(agent)
    const result = await tool.execute({ prompt: 'x' }, { agentId: '0' })
    assert.equal(result.kind, 'tool_ok')
  })
})
