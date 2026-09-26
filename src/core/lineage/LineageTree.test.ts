import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { LineageTree } from './LineageTree.ts'
import { makeAgentID, rootEffective, ROOT_AGENT_ID } from '../model/index.ts'

const genes = { classRef: 'user', tools: { bash: 'allow' as const } }

describe('LineageTree', () => {
  it('登记与拓扑', () => {
    const tree = new LineageTree()
    assert.equal(tree.attach(ROOT_AGENT_ID, { attrs: rootEffective(genes, 'root') }), undefined)
    const child = tree.nextChildID(ROOT_AGENT_ID)
    assert.equal(child, makeAgentID('0.0'))
    assert.equal(
      tree.attach(child, {
        attrs: rootEffective({ classRef: 'worker', tools: {} }, 'w'),
      }),
      undefined,
    )
    assert.deepEqual(tree.children(ROOT_AGENT_ID), [child])
    assert.deepEqual(tree.ancestors(child), [ROOT_AGENT_ID])
    assert.equal(tree.canReach(ROOT_AGENT_ID, child), true)
    assert.equal(tree.canReach(child, ROOT_AGENT_ID), false)
  })

  it('能力物化：raise 只抬不封，register deny 锁死', () => {
    const tree = new LineageTree()
    tree.attach(ROOT_AGENT_ID, {
      attrs: rootEffective({ classRef: 'a', tools: { read: 'hidden', bash: 'allow', rm: 'deny' } }),
      raise: { read: 'allow' },
      registerAccess: { rm: 'allow', bash: 'deny' },
    })
    assert.equal(tree.effectiveAccess(ROOT_AGENT_ID, 'read'), 'allow')
    assert.equal(tree.effectiveAccess(ROOT_AGENT_ID, 'bash'), 'deny')
    assert.equal(tree.effectiveAccess(ROOT_AGENT_ID, 'rm'), 'deny')
    assert.equal(tree.effectiveAccess(ROOT_AGENT_ID, 'ghost'), 'hidden')
  })

  it('墓碑保留 id 占用，子清单排除', () => {
    const tree = new LineageTree()
    tree.attach(ROOT_AGENT_ID, { attrs: rootEffective(genes) })
    const child = tree.nextChildID(ROOT_AGENT_ID)
    tree.attach(child, { attrs: rootEffective(genes) })
    assert.equal(tree.tombstone(child), undefined)
    assert.deepEqual(tree.children(ROOT_AGENT_ID), [])
    assert.equal(tree.nextChildID(ROOT_AGENT_ID), makeAgentID('0.1'))
  })

  it('缺父拒绝登记', () => {
    const tree = new LineageTree()
    assert.deepEqual(tree.attach(makeAgentID('0.1'), { attrs: rootEffective(genes) }), {
      kind: 'lineage_missing_node',
      id: ROOT_AGENT_ID,
    })
  })
})
