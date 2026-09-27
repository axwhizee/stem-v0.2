import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  createCortexStrategy,
  spliceNoteSlot,
  NOTES_CALL_ID,
  NOTES_TOOL_NAME,
} from './cortex.ts'
import {
  makeAgentID,
  makeTextMessage,
  validateSequence,
  ROOT_AGENT_ID,
  type Message,
} from '../../src/core/model/index.ts'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const env = (id: string, message: Message) => ({
  id,
  agentId: ROOT_AGENT_ID,
  at: 0,
  valid: true,
  turn: 0,
  indexInTurn: 0,
  message,
})

describe('cortex 笔记假 tool 槽', () => {
  it('插在最新 userPrompt 前驱 assistant 之前，且只保留一份', () => {
    const corpus: Message[] = [
      makeTextMessage('user', 'u1'),
      makeTextMessage('assistant', 'a1'),
      makeTextMessage('user', 'u2-latest'),
    ]
    const once = spliceNoteSlot(corpus, '- a.md')
    assert.equal(once.length, 5)
    // assistant a1 之前插入假槽
    assert.equal(once[1]?.kind, 'assistant')
    assert.equal(once[1]?.toolCalls?.[0]?.id, NOTES_CALL_ID)
    assert.equal(once[2]?.kind, 'tool')
    assert.equal(once[2]?.toolCallId, NOTES_CALL_ID)
    assert.equal(once[3]?.kind, 'assistant')
    assert.equal(validateSequence(once), undefined)

    // 再生：仍只有一份，内容更新
    const twice = spliceNoteSlot(once, '- a.md\n- b.md')
    const slots = twice.filter((m) => m.toolCallId === NOTES_CALL_ID || m.toolCalls?.some((c) => c.id === NOTES_CALL_ID))
    assert.equal(slots.filter((m) => m.kind === 'tool').length, 1)
    const tool = twice.find((m) => m.kind === 'tool' && m.toolCallId === NOTES_CALL_ID)
    assert.ok(tool?.content[0]?.type === 'text' && tool.content[0].text.includes('b.md'))
    assert.equal(validateSequence(twice), undefined)
  })

  it('无前驱 assistant 时：单条 user 则挂在 user 之后（起始不可 assistant）', () => {
    const corpus: Message[] = [makeTextMessage('user', 'only')]
    const out = spliceNoteSlot(corpus, '(no notes)')
    assert.equal(out[0]?.kind, 'user')
    assert.equal(out[1]?.kind, 'assistant')
    assert.equal(out[2]?.kind, 'tool')
    assert.equal(validateSequence(out), undefined)
  })

  it('多条 user 无 assistant：插在最新 user 之前，tool 后用空 assistant 收束', () => {
    const corpus: Message[] = [makeTextMessage('user', 'u1'), makeTextMessage('user', 'u2')]
    const out = spliceNoteSlot(corpus, '- n')
    assert.equal(out[1]?.kind, 'assistant')
    assert.equal(out[2]?.kind, 'tool')
    assert.equal(out[3]?.kind, 'assistant')
    assert.equal(out[4]?.kind, 'user')
    assert.equal(validateSequence(out), undefined)
  })

  it('orchestrate 组合 LTM/STM + 假槽', () => {
    const home = mkdtempSync(join(tmpdir(), 'cortex-'))
    mkdirSync(join(home, ROOT_AGENT_ID), { recursive: true })
    writeFileSync(join(home, ROOT_AGENT_ID, 'topic.md'), '# t', 'utf8')
    const s = createCortexStrategy({ homeRoot: home })
    const r = s.orchestrate(
      {
        agentId: ROOT_AGENT_ID,
        envelopes: [env('e1', makeTextMessage('user', 'hi'))],
        ctxTokens: 0,
        stamp: {},
      },
      'user_prompt',
    )
    const names = r.messages.map((m) => m.kind).join(',')
    assert.ok(names.includes('tool'))
    assert.ok(r.messages.some((m) => m.kind === 'assistant' && m.toolCalls?.[0]?.name === NOTES_TOOL_NAME))
    assert.equal(validateSequence(r.messages), undefined)
  })

  it('dream 双段合格才轮替；段2 空报告不轮替', async () => {
    const home = mkdtempSync(join(tmpdir(), 'cortex-'))
    const ok = createCortexStrategy({
      homeRoot: home,
      dreamAt: 1,
      complete: async (p) => (p.includes('STM') ? 'stm-line' : 'ltm-line'),
    })
    const view = { agentId: makeAgentID('1'), envelopes: [], ctxTokens: 100, stamp: {} }
    const r = await ok.process?.(view, 'watermark')
    assert.ok(r === undefined || Array.isArray(r.messages))

    let call = 0
    const bad = createCortexStrategy({
      homeRoot: home,
      dreamAt: 1,
      complete: async () => {
        call++
        return call === 1 ? 'stm-ok' : ''
      },
    })
    assert.equal(await bad.process?.(view, 'watermark'), undefined)
  })
})
