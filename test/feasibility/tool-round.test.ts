// 实景：FakeGateway 触发工具调用，验证注册表执行与回写。

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { DefaultRuntime } from '../../src/core/runtime/index.ts'
import { FakeGateway, type LLMEvent } from '../../src/core/gateway/index.ts'
import {
  ToolCapabilityRegistry,
  allowAll,
  toolOk,
  type ToolCapability,
} from '../../src/core/tools/index.ts'
import { PostOffice, type TimerPort } from '../../src/core/post/index.ts'
import { EventHub } from '../../src/core/events/index.ts'
import { makeAgentID, makeTextMessage, ROOT_AGENT_ID, type Message } from '../../src/core/model/index.ts'

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

const bash: ToolCapability = {
  name: 'bash',
  description: 'echo via fake bash',
  kind: 'extension',
  parameters: { type: 'object', properties: { command: { type: 'string' } } },
  registerAccess: 'allow',
  execute: (input) => toolOk(`ran ${String((input as { command?: string }).command)}`),
}

describe('实景工具轮', () => {
  it('模型 tool-call → 执行 → tool 结果回写', async () => {
    let round = 0
    const gw = new FakeGateway(() => {
      round++
      if (round === 1) {
        return [
          { type: 'tool-call', id: 'c1', name: 'ping', input: {} },
          { type: 'tool-call', id: 'c2', name: 'bash', input: { command: 'echo hi' } },
          { type: 'finish', reason: 'tool_calls' },
        ]
      }
      return [
        { type: 'text-delta', text: 'done' },
        { type: 'finish', reason: 'stop' },
      ]
    })
    const tools = new ToolCapabilityRegistry()
    await tools.drain([ping, bash], {})
    const post = new PostOffice(timer(), { onDelivery: () => {} })
    const messages: Message[] = [makeTextMessage('user', '用工具')]
    const seen: string[] = []
    const rt = new DefaultRuntime({
      gateway: gw,
      tools,
      access: allowAll(),
      post,
      events: new EventHub(),
      snapshotOf: () => messages,
      materializeTools: () => tools.materialize('0', allowAll()),
      parseModel: (s) => ({ provider: 'p', id: s }),
      modelOf: () => 'p/m',
      systemOf: () => undefined,
      maxStepsOf: () => 6,
    })
    post // keep
    void seen
    await rt.processDelivery({
      agentId: ROOT_AGENT_ID,
      reason: 'user_prompt',
      envelopes: [],
    })
    const box = post.boxOf(ROOT_AGENT_ID)
    const kinds = box.map((e) => e.message.kind)
    assert.ok(kinds.includes('assistant'))
    assert.ok(kinds.includes('tool'))
    const toolsOut = box.filter((e) => e.message.kind === 'tool')
    assert.equal(toolsOut.length, 2)
    assert.ok(toolsOut.some((e) => e.message.toolCallId === 'c1'))
    assert.ok(toolsOut.some((e) => e.message.toolCallId === 'c2'))
  })
})
