import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { PostOffice, type Delivery, type TimerPort } from './PostOffice.ts'
import { makeAgentID, makeTextMessage, ROOT_AGENT_ID, type Envelope } from '../model/index.ts'

function manualTimer(): TimerPort & { flush: () => void; pending: number } {
  const jobs: (() => void)[] = []
  return {
    set(_ms, fn) {
      jobs.push(fn)
      return () => {
        const i = jobs.indexOf(fn)
        if (i >= 0) jobs.splice(i, 1)
      }
    },
    flush() {
      while (jobs.length) jobs.shift()?.()
    },
    get pending() {
      return jobs.length
    },
  }
}

const env = (id: string, agentId = ROOT_AGENT_ID): Envelope => ({
  id,
  agentId,
  at: 0,
  valid: true,
  turn: 0,
  indexInTurn: 0,
  message: makeTextMessage('user', id),
})

describe('PostOffice', () => {
  it('合并窗口倒计时后投递并累积', () => {
    const timer = manualTimer()
    const got: Delivery[] = []
    const post = new PostOffice(timer, { onDelivery: (d) => got.push(d) })
    post.setSendCountdown(ROOT_AGENT_ID, 10)
    post.notifyReady(ROOT_AGENT_ID, 'user_prompt', [env('a')])
    post.notifyReady(ROOT_AGENT_ID, 'user_prompt', [env('b')])
    assert.equal(got.length, 0)
    timer.flush()
    assert.equal(got.length, 1)
    assert.deepEqual(
      got[0]?.envelopes.map((e) => e.id),
      ['a', 'b'],
    )
  })

  it('未决登记与兑现', () => {
    const post = new PostOffice(manualTimer(), { onDelivery: () => {} })
    post.registerPending({ callId: 'c1', owner: ROOT_AGENT_ID, tool: 'bash' })
    assert.equal(post.pendingOf(ROOT_AGENT_ID).length, 1)
    assert.equal(post.fillPending('c1', env('r')), true)
    assert.equal(post.pendingOf(ROOT_AGENT_ID).length, 0)
    assert.equal(post.boxOf(ROOT_AGENT_ID).length, 1)
    assert.equal(post.fillPending('ghost', env('x')), false)
  })

  it('广播点对点入库', () => {
    const post = new PostOffice(manualTimer(), { onDelivery: () => {} })
    const a = makeAgentID('0.0')
    const b = makeAgentID('0.1')
    post.broadcast(ROOT_AGENT_ID, [a, b], makeTextMessage('user', 'hi'), 'm')
    assert.equal(post.boxOf(a).length, 1)
    assert.equal(post.boxOf(b).length, 1)
  })
})
