import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { FakeGateway, textEvents, abortError } from './FakeGateway.ts'
import { isAbortError, type LLMRequest } from './types.ts'

const req: LLMRequest = {
  model: { provider: 'p', id: 'm' },
  messages: [{ role: 'user', content: 'x' }],
}

describe('FakeGateway', () => {
  it('记录请求并产出脚本事件', async () => {
    const gw = new FakeGateway(() => textEvents('hello'))
    const events = []
    for await (const e of gw.chat(req)) events.push(e)
    assert.equal(gw.requests.length, 1)
    assert.equal(events.at(-1)?.type, 'finish')
  })

  it('中断抛 AbortError', async () => {
    const gw = new FakeGateway(() => textEvents('x'))
    const ctl = new AbortController()
    ctl.abort()
    await assert.rejects(async () => {
      for await (const _ of gw.chat(req, { signal: ctl.signal })) {
        // 消费
      }
    }, isAbortError)
    assert.equal(abortError().name, 'AbortError')
  })
})
