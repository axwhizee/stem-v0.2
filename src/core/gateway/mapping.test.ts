import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { toChatMessage, toProtocolContent } from './mapping.ts'
import { makeTextMessage, type Message } from '../model/index.ts'

describe('gateway mapping', () => {
  it('Message → ChatMessage 单向投影', () => {
    const m = makeTextMessage('user', 'hi')
    const chat = toChatMessage(m)
    assert.equal(chat.role, 'user')
    assert.deepEqual(chat.content, [{ type: 'text', text: 'hi' }])
  })

  it('toolCalls 序列化 arguments', () => {
    const m: Message = {
      kind: 'assistant',
      content: [{ type: 'text', text: '' }],
      toolCalls: [{ id: 'c1', name: 'bash', arguments: { cmd: 'ls' } }],
    }
    const chat = toChatMessage(m)
    assert.equal(chat.toolCalls?.[0]?.arguments, '{"cmd":"ls"}')
  })

  it('多模态 image 映射为协议 image part', () => {
    const parts = toProtocolContent([
      { type: 'text', text: 'a' },
      { type: 'image', ref: 'assets/x.png', mime: 'image/png' },
    ])
    assert.equal(parts[1]?.type, 'image')
    assert.equal(parts[1]?.type === 'image' && parts[1].url, 'assets/x.png')
  })
})
