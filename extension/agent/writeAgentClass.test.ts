import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { serializeAgentClass } from './writeAgentClass.ts'
import { parseAgentClassFile } from './loadAgentClass.ts'

describe('类写回', () => {
  it('序列化可再解析', () => {
    const text = serializeAgentClass('worker', {
      classRef: 'worker',
      description: 'Work',
      sysPrompt: 'Do it.',
      model: 'openai/gpt-4o-mini',
      tools: { bash: 'allow' },
    })
    const r = parseAgentClassFile('worker.md', text)
    assert.ok(!('kind' in r))
    if (!('kind' in r)) {
      assert.equal(r.name, 'worker')
      assert.equal(r.genes.model, 'openai/gpt-4o-mini')
      assert.equal(r.genes.sysPrompt, 'Do it.')
      assert.equal(r.genes.tools?.bash, 'allow')
    }
  })
})
