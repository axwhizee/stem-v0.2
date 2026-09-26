import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  raiseAccess,
  convergeAccess,
  canTransition,
  transitionAccess,
  isExecutable,
  isModelVisible,
} from './access.ts'

describe('权限三态', () => {
  it('hidden 可抬为 allow；deny 不可逆', () => {
    assert.equal(raiseAccess('hidden', 'allow'), 'allow')
    assert.equal(raiseAccess('allow', 'hidden'), 'allow')
    assert.equal(raiseAccess('deny', 'allow'), 'deny')
    assert.equal(canTransition('hidden', 'allow'), true)
    assert.equal(canTransition('deny', 'allow'), false)
    assert.equal(canTransition('allow', 'hidden'), false)
    assert.equal(canTransition('allow', 'deny'), true)
  })

  it('收敛只紧不松：deny 吸收', () => {
    assert.equal(convergeAccess(['hidden', 'allow', 'hidden']), 'allow')
    assert.equal(convergeAccess(['allow', 'deny', 'allow']), 'deny')
    assert.equal(convergeAccess(['hidden', 'hidden']), 'hidden')
  })

  it('仅 allow 可执行且模型可见', () => {
    assert.equal(isExecutable('allow'), true)
    assert.equal(isExecutable('hidden'), false)
    assert.equal(isModelVisible('deny'), false)
    assert.equal(isModelVisible('allow'), true)
  })

  it('非法转移给出判别联合', () => {
    const r = transitionAccess('deny', 'allow')
    assert.ok(typeof r === 'object' && r.kind === 'access_illegal_transition')
  })
})
