import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  makeAgentID,
  isAgentID,
  parentIdOf,
  childAgentID,
  isAncestorOf,
  canReach,
  compareAgentID,
  ROOT_AGENT_ID,
} from './id.ts'

describe('id', () => {
  it('根与出生路径合法', () => {
    assert.equal(isAgentID('0'), true)
    assert.equal(isAgentID('0.0'), true)
    assert.equal(isAgentID('0.1.2'), true)
    assert.equal(isAgentID('3'), false)
    assert.equal(isAgentID('01'), false)
    assert.equal(isAgentID('0.02'), false)
  })

  it('父 id 纯推导', () => {
    assert.equal(parentIdOf(ROOT_AGENT_ID), null)
    assert.equal(parentIdOf(makeAgentID('0.3')), ROOT_AGENT_ID)
    assert.equal(parentIdOf(makeAgentID('0.3.4')), makeAgentID('0.3'))
  })

  it('子 id = `<父>.<序号>`', () => {
    assert.equal(childAgentID(ROOT_AGENT_ID, 0), makeAgentID('0.0'))
    assert.equal(childAgentID(ROOT_AGENT_ID, 2), makeAgentID('0.2'))
    assert.equal(childAgentID(makeAgentID('0.2'), 1), makeAgentID('0.2.1'))
  })

  it('canReach ≡ from 为 target 自身或祖先', () => {
    const a = makeAgentID('0.1')
    const b = makeAgentID('0.1.2')
    assert.equal(canReach(a, a), true)
    assert.equal(canReach(a, b), true)
    assert.equal(canReach(b, a), false)
    assert.equal(isAncestorOf(a, b), true)
    assert.equal(isAncestorOf(b, a), false)
  })

  it('自然序（族谱 DFS）', () => {
    const ids = ['0.1.10', '0.1.2', '0', '0.2'].map(makeAgentID)
    ids.sort(compareAgentID)
    assert.deepEqual(ids.map(String), ['0', '0.1.2', '0.1.10', '0.2'])
  })
})
