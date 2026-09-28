import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  createClassicStrategy,
  createNoneStrategy,
  legalizeCompactSequence,
} from './strategies/index.ts'
import { projectMessages, collectStamp } from './stamp.ts'
import { ContextPipeline } from './pipeline.ts'
import { PostOffice, type TimerPort } from './PostOffice.ts'
import {
  makeAgentID,
  makeTextMessage,
  validateSequence,
  ROOT_AGENT_ID,
  type Envelope,
  type Message,
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

describe('classic compact 改写', () => {
  it('legalizeCompactSequence 在接缝补 assistant', () => {
    const head: Message[] = [makeTextMessage('user', 'q1'), makeTextMessage('assistant', 'a1')]
    const summary = makeTextMessage('user', '…[compact]')
    const tail: Message[] = [makeTextMessage('user', 'q2')]
    const seq = legalizeCompactSequence(head, summary, tail)
    assert.equal(validateSequence(seq), undefined)
    assert.equal(seq[seq.length - 2]?.kind, 'assistant')
  })

  it('process 水位触发：作废中段 + 写回摘要', async () => {
    const s = createClassicStrategy({
      compactAt: 10,
      keepHead: 1,
      keepTail: 1,
      complete: async () => 'summary notes',
    })
    const envelopes: Envelope[] = [
      env('h', 'head-user'),
      {
        id: 'm1',
        agentId: ROOT_AGENT_ID,
        at: 1,
        valid: true,
        turn: 0,
        indexInTurn: 0,
        message: makeTextMessage('assistant', 'mid-a'),
      },
      {
        id: 'm2',
        agentId: ROOT_AGENT_ID,
        at: 1,
        valid: true,
        turn: 0,
        indexInTurn: 0,
        from: 'user',
        message: makeTextMessage('user', 'mid-u'),
      },
      env('t', 'tail-user'),
    ]
    const r = await s.process!(
      { agentId: ROOT_AGENT_ID, envelopes, ctxTokens: 100, stamp },
      'watermark',
    )
    assert.ok(r)
    assert.deepEqual(r?.rewrite?.invalidateIds, ['m1', 'm2'])
    assert.equal(r?.messages.length, 1)
    assert.ok(r?.messages[0]?.content[0]?.type === 'text')
    assert.ok(r?.messages[0]?.content[0]?.text.includes('summary notes'))
  })

  it('未达水位不 compact', async () => {
    const s = createClassicStrategy({ compactAt: 1000 })
    const r = await s.process!(
      { agentId: ROOT_AGENT_ID, envelopes: [env('a'), env('b'), env('c')], ctxTokens: 1, stamp },
      'watermark',
    )
    assert.equal(r, undefined)
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
