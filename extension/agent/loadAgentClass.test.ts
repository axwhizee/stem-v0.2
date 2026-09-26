import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseAgentClassFile } from './loadAgentClass.ts'

describe('agent 类文件', () => {
  it('frontmatter + 正文', () => {
    const r = parseAgentClassFile(
      'worker.md',
      `---
name: worker
description: Work
model: openai/gpt-4o-mini
tools: { bash: allow, rm: deny }
---
Do work.`,
    )
    assert.ok(!('kind' in r))
    if (!('kind' in r)) {
      assert.equal(r.name, 'worker')
      assert.equal(r.genes.model, 'openai/gpt-4o-mini')
      assert.equal(r.genes.sysPrompt, 'Do work.')
      assert.equal(r.genes.tools?.bash, 'allow')
      assert.equal(r.genes.tools?.rm, 'deny')
    }
  })

  it('无 frontmatter：全文 sysPrompt，name 取文件名', () => {
    const r = parseAgentClassFile('solo.md', 'Just a prompt.')
    assert.ok(!('kind' in r))
    if (!('kind' in r)) {
      assert.equal(r.name, 'solo')
      assert.equal(r.genes.sysPrompt, 'Just a prompt.')
    }
  })
})
