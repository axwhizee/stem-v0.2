import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { DefaultRuntime } from './DefaultRuntime.ts'
import { FakeGateway, textEvents, type ToolDefinition } from '../gateway/index.ts'
import { ToolCapabilityRegistry, allowAll, toolOk, type ToolCapability } from '../tools/index.ts'
import { PostOffice, type TimerPort } from '../post/index.ts'
import { EventHub } from '../events/index.ts'
import { makeAgentID, makeTextMessage, ROOT_AGENT_ID, type Message } from '../model/index.ts'

function timer(): TimerPort {
  return { set: () => () => {} }
}

const ping: ToolCapability = {
  name: 'ping',
  description: 'ping',
  kind: 'internal',
  parameters: { type: 'object', properties: {} },
  registerAccess: 'allow',
  execute: () => toolOk('pong'),
}

describe('DefaultRuntime', () => {
  it('纯文本轮写回 assistant', async () => {
    const gw = new FakeGateway(() => textEvents('hello'))
    const tools = new ToolCapabilityRegistry()
    await tools.drain([], {})
    const post = new PostOffice(timer(), { onDelivery: () => {} })
    const messages: Message[] = [makeTextMessage('user', 'hi')]
    const rt = new DefaultRuntime({
      gateway: gw,
      tools,
      access: allowAll(),
      post,
      events: new EventHub(),
      snapshotOf: () => messages,
      materializeTools: (): ToolDefinition[] => [],
      parseModel: (s) => ({ provider: 'p', id: s }),
      modelOf: () => 'p/m',
      systemOf: () => undefined,
      maxStepsOf: () => 4,
    })
    await rt.processDelivery({ agentId: ROOT_AGENT_ID, reason: 'user_prompt', envelopes: [] })
    assert.equal(post.boxOf(ROOT_AGENT_ID).length, 1)
    assert.equal(post.boxOf(ROOT_AGENT_ID)[0]?.message.kind, 'assistant')
  })

  it('工具轮：assistant(calls) + tool 结果入库', async () => {
    const gw = new FakeGateway(() => [
      {
        type: 'tool-call',
        id: 'c1',
        name: 'ping',
        input: {},
      },
      { type: 'finish', reason: 'tool_calls' },
      ...textEvents('done'),
    ])
    const tools = new ToolCapabilityRegistry()
    await tools.drain([ping], {})
    const post = new PostOffice(timer(), { onDelivery: () => {} })
    const messages: Message[] = [makeTextMessage('user', 'go')]
    const rt = new DefaultRuntime({
      gateway: gw,
      tools,
      access: allowAll(),
      post,
      events: new EventHub(),
      snapshotOf: () => messages,
      materializeTools: () => [
        { name: 'ping', description: 'ping', parameters: {} },
      ],
      parseModel: (s) => ({ provider: 'p', id: s }),
      modelOf: () => 'p/m',
      systemOf: () => undefined,
      maxStepsOf: () => 4,
    })
    await rt.processDelivery({
      agentId: makeAgentID('0.0'),
      reason: 'user_prompt',
      envelopes: [],
    })
    const box = post.boxOf(makeAgentID('0.0'))
    assert.ok(box.some((e) => e.message.kind === 'assistant'))
    assert.ok(box.some((e) => e.message.kind === 'tool'))
  })
})
