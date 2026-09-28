import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createSystem } from './createSystem.ts'
import { FakeGateway, textEvents } from '../gateway/index.ts'
import { allowAll, toolOk } from '../tools/index.ts'
import type { ToolCapability } from '../tools/index.ts'
import type { TimerPort } from '../post/index.ts'
import { makeAgentID } from '../model/index.ts'

function timer(): TimerPort {
  return { set: (_ms, fn) => {
    // 同步触发便于测试
    fn()
    return () => {}
  } }
}

const ping: ToolCapability = {
  name: 'ping',
  description: 'ping',
  kind: 'internal',
  parameters: { type: 'object', properties: {} },
  registerAccess: 'allow',
  execute: () => toolOk('pong'),
}

describe('createSystem', () => {
  it('boot 建立 user#0，pilot 可发送', async () => {
    const gw = new FakeGateway(() => textEvents('hi'))
    const sys = await createSystem({
      gateway: gw,
      timer: timer(),
      access: allowAll(),
      tools: [ping],
    })
    assert.deepEqual(sys.init.issues, [])
    assert.equal(sys.lineage.has(makeAgentID('0')), true)
    await sys.pilot.send('hello')
    assert.ok(sys.post.boxOf(makeAgentID('0')).length >= 1)
    const tools = sys.tools.materialize('0', allowAll())
    assert.ok(tools.some((t) => t.name === 'ping'))
    const call = await sys.pilot.callTool('ping', {})
    assert.equal(call.kind, 'tool_ok')
    await sys.dispose()
  })

  it('实例化子节点并收敛', async () => {
    const sys = await createSystem({
      gateway: new FakeGateway(() => textEvents('x')),
      timer: timer(),
      access: allowAll(),
    })
    sys.kernel.registerClass({
      name: 'worker',
      genes: { classRef: 'worker', model: 'm1', tools: { ping: 'allow' } },
    })
    const child = await sys.kernel.instantiate({
      className: 'worker',
      userPrompt: 'go',
      parentId: makeAgentID('0'),
      name: 'w1',
    })
    assert.ok('id' in child && 'attrs' in child)
    if ('id' in child && 'attrs' in child) {
      assert.equal(child.attrs.model, 'm1')
      assert.equal(sys.kernel.updateAgent(child.id, { temperature: 0.5 }), undefined)
      assert.ok(sys.kernel.updateAgent(child.id, { ctxStrategy: 'none' }))
    }
    await sys.dispose()
  })
})
