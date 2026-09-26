import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { restoreInstances, restoreEnvelopes } from './restore.ts'
import { LineageTree } from '../lineage/index.ts'
import { PostOffice, type TimerPort } from '../post/index.ts'
import {
  MemoryInstanceStore,
  MemoryMessageStore,
} from '../ports/index.ts'
import { makeAgentID, makeTextMessage, rootEffective, ROOT_AGENT_ID, type EffectiveAttrs } from '../model/index.ts'

function timer(): TimerPort {
  return { set: () => () => {} }
}

describe('restore', () => {
  it('拓扑序重放 + 活跃态归一', () => {
    const store = new MemoryInstanceStore()
    const attrs = rootEffective({ classRef: 'a' })
    store.upsert({
      id: ROOT_AGENT_ID,
      attrs,
      runtime: { status: 'thinking', turnCount: 2, ctxTokens: 1, totalTokens: 9 },
    })
    store.upsert({
      id: makeAgentID('0.0'),
      attrs: { ...(attrs as EffectiveAttrs), id: makeAgentID('0.0') },
      runtime: { status: 'idle', turnCount: 1, ctxTokens: 0, totalTokens: 1 },
    })
    const lineage = new LineageTree()
    const r = restoreInstances(store, lineage)
    assert.equal(r.instances, 2)
    assert.equal(lineage.get(ROOT_AGENT_ID)?.runtime.status, 'interrupted')
    assert.equal(lineage.get(makeAgentID('0.0'))?.runtime.status, 'idle')
  })

  it('语料载箱', () => {
    const ms = new MemoryMessageStore()
    ms.append({
      id: 'e1',
      agentId: ROOT_AGENT_ID,
      at: 1,
      valid: true,
      turn: 0,
      indexInTurn: 0,
      message: makeTextMessage('user', 'hi'),
    })
    const post = new PostOffice(timer(), { onDelivery: () => {} })
    assert.equal(restoreEnvelopes(ms, post, [ROOT_AGENT_ID]), 1)
    assert.equal(post.boxOf(ROOT_AGENT_ID).length, 1)
  })
})
