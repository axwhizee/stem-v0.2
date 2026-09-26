import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  makeTextMessage,
  validateSuccessor,
  validateSequence,
  textContent,
  type Message,
} from './message.ts'

const sys = () => makeTextMessage('system', 'sys')
const user = (t = 'u') => makeTextMessage('user', t)
const asst = (t = 'a') => makeTextMessage('assistant', t)
const calls = (ids: string[]): Message => ({
  kind: 'assistant',
  content: [{ type: 'text', text: '' }],
  toolCalls: ids.map((id) => ({ id, name: 't', arguments: {} })),
})
const tool = (callId: string, text = 'ok'): Message => ({
  kind: 'tool',
  content: [{ type: 'text', text }],
  toolCallId: callId,
})

describe('message 后继表', () => {
  it('system → user → assistant', () => {
    assert.equal(validateSuccessor(null, sys()), undefined)
    assert.equal(validateSuccessor(sys(), user()), undefined)
    assert.equal(validateSuccessor(user(), asst()), undefined)
    assert.equal(validateSuccessor(asst(), user()), undefined)
  })

  it('禁止悬空 system / tool→user', () => {
    assert.ok(validateSuccessor(user(), sys()))
    assert.ok(validateSuccessor(tool('c'), user()))
  })

  it('toolCalls 配对与闭合', () => {
    const seq = [sys(), user(), calls(['c1', 'c2']), tool('c1'), tool('c2'), asst('done')]
    assert.equal(validateSequence(seq), undefined)
  })

  it('孤儿 tool 结果与未闭合槽位非法', () => {
    assert.ok(validateSequence([user(), tool('ghost')]))
    assert.ok(validateSequence([user(), calls(['c1'])]))
  })

  it('未闭合时不得插入 user/assistant', () => {
    assert.ok(validateSequence([user(), calls(['c1']), asst()]))
  })

  it('textContent 投影', () => {
    assert.equal(textContent(makeTextMessage('user', '你好')), '你好')
  })
})
