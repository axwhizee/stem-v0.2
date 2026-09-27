import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createClassicStrategy, createNoneStrategy } from './strategies/index.ts'
import { projectMessages, collectStamp } from './stamp.ts'
import { ContextPipeline } from './pipeline.ts'
import { PostOffice, type TimerPort } from './PostOffice.ts'
import {
  makeAgentID,
  makeTextMessage,
  ROOT_AGENT_ID,
  type Envelope,
} from '../model/index.ts'

const stamp = { source: true, timestamp: true }

function env(id: string, text = id, valid = true): Envelope {
  return {
    id,
    agentId: ROOT_AGENT_ID,
    at: 1,
    valid,
    turn: 0,
    indexInTurn: 0,
    from: 'user',
    message: makeTextMessage('user', text),
  }
}

function timer(): TimerPort {
  return { set: () => () => {} }
}

describe('context stamp 与 classic', () => {
  it('投影跳过作废信，可带 from 前缀', () => {
    const msgs = projectMessages([env('a'), env('b', 'x', false)], stamp)
    assert.equal(msgs.length, 1)
    assert.ok(msgs[0]?.content[0]?.type === 'text' && msgs[0].content[0].text.includes('from=user'))
  })

  it('collectStamp 记录开关', () => {
    const e = collectStamp(env('a'), { timestamp: true }, 99)
    assert.equal(e.at, 99)
    assert.equal(e.stamp?.timestamp, true)
  })

  it('classic orchestrate 有效序直出', () => {
    const s = createClassicStrategy()
    const r = s.orchestrate(
      {
        agentId: ROOT_AGENT_ID,
        envelopes: [env('a', 'hi')],
        ctxTokens: 0,
        stamp,
      },
      'user_prompt',
    )
    assert.equal(r.messages.length, 1)
  })

  it('none 不形成快照', () => {
    const r = createNoneStrategy().orchestrate(
      { agentId: ROOT_AGENT_ID, envelopes: [env('a')], ctxTokens: 0, stamp },
      'user_prompt',
    )
    assert.deepEqual(r.messages, [])
  })
})

describe('ContextPipeline', () => {
  it('enter：入库 + notifyReady', async () => {
    const post = new PostOffice(timer(), { onDelivery: () => {} })
    const pipeline = new ContextPipeline({
      post,
      strategyOf: () => createClassicStrategy(),
      stamp,
    })
    await pipeline.enter(env('a', 'hello'), 'user_prompt')
    assert.equal(post.boxOf(ROOT_AGENT_ID).length, 1)
    const snap = pipeline.snapshot(ROOT_AGENT_ID)
    assert.equal(snap.length, 1)
    assert.equal(snap[0]?.kind, 'user')
  })
})
