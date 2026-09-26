import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  inherit,
  applyClass,
  applyInstance,
  canWrite,
  validateGenes,
  rootEffective,
} from './attributeTable.ts'
import { makeAgentID } from './id.ts'

describe('AttributeTable 收敛', () => {
  it('解析序：实例显式 > 类 > 父', () => {
    const parent = rootEffective({ classRef: 'base', model: 'p-model', temperature: 0.2 }, 'dad')
    const childId = makeAgentID('0.0')
    const inherited = inherit(parent, childId)
    assert.equal(inherited.model, 'p-model')
    assert.equal(inherited.name, undefined)

    const withClass = applyClass(inherited, { classRef: 'worker', model: 'c-model' })
    assert.equal(withClass.model, 'c-model')

    const landed = applyInstance(withClass, { model: 'i-model', name: 'w1' })
    assert.equal(landed.model, 'i-model')
    assert.equal(landed.name, 'w1')
  })

  it('写面仅 name/model/temperature/effort', () => {
    assert.equal(canWrite({ name: 'x' }).length, 0)
    assert.equal(canWrite({ model: 'm' }).length, 0)
    assert.ok(canWrite({ id: makeAgentID('0') }).length > 0)
    assert.ok(canWrite({ ctxStrategy: 'classic' }).length > 0)
    assert.ok(canWrite({ tools: {} }).length > 0)
  })

  it('基因校验', () => {
    assert.equal(validateGenes({ classRef: 'a' }).length, 0)
    assert.ok(validateGenes({ classRef: '', temperature: 9 }).length >= 2)
  })

  it('根与普通实例同路径', () => {
    const root = rootEffective({ classRef: 'user', sysPrompt: 'hi' }, 'root')
    assert.equal(root.id, '0')
    assert.equal(root.sysPrompt, 'hi')
    assert.equal(root.ctxStrategy, 'classic')
  })
})
