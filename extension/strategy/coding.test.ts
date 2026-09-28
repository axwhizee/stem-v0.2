// coding 策略：watch、假 tool 槽、滚动失效、未变原位。

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCodingStrategy, CODING_SLOT_PREFIX } from './coding.ts'
import { createTreeTool } from '../tools/tree.ts'
import { validateSequence, ROOT_AGENT_ID, type Envelope, type Message } from '../../src/core/model/index.ts'
import type { ToolResult } from '../../src/core/tools/index.ts'

function env(id: string, msg: Message): Envelope {
  return {
    id,
    agentId: ROOT_AGENT_ID,
    at: 1,
    valid: true,
    turn: 0,
    indexInTurn: 0,
    message: msg,
  }
}

function textMsg(kind: Message['kind'], text: string): Message {
  return { kind, content: [{ type: 'text', text }] }
}

describe('coding 实时域', () => {
  let root = ''

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'stem-coding-'))
    writeFileSync(join(root, 'a.ts'), 'export function a() {\n  return 1\n}\n', 'utf8')
  })

  after(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('watch 后投影出现快照槽；文件变更后旧槽剥离、新槽在最终 assistant 前', () => {
    const s = createCodingStrategy({ workspaceRoot: root })
    const watch = s.ownedTools!.find((t) => t.name === 'coding_watch')!
    const r = watch.execute(
      { path: 'a.ts', mode: 'full', maxLines: 300 },
      { agentId: ROOT_AGENT_ID } as never,
    ) as ToolResult
    assert.equal(r.kind, 'tool_ok')

    const base: Message[] = [
      textMsg('user', 'hello'),
      textMsg('assistant', 'working'),
      textMsg('user', 'next'),
      textMsg('assistant', 'done'),
    ]
    const view = {
      agentId: ROOT_AGENT_ID,
      envelopes: [env('1', base[0]!), env('2', base[1]!), env('3', base[2]!), env('4', base[3]!)],
      ctxTokens: 0,
      stamp: { source: true },
    }
    const first = s.orchestrate(view, 'user_prompt')
    assert.ok(first.messages.length > 4)
    assert.ok(first.messages.some((m) => m.kind === 'tool' && m.toolCallId?.startsWith(CODING_SLOT_PREFIX)))
    // 快照在最终 assistant 之前
    const lastFinal = first.messages.findIndex(
      (m, i) => m.kind === 'assistant' && !m.toolCalls?.length && i === first.messages.length - 1,
    )
    assert.equal(lastFinal, first.messages.length - 1)
    const snapIdx = first.messages.findIndex((m) => m.toolCallId?.startsWith(CODING_SLOT_PREFIX))
    assert.ok(snapIdx < first.messages.length - 1)

    // 文件变更 → 旧槽剥离、新槽仍存在
    writeFileSync(join(root, 'a.ts'), 'export function a() {\n  return 2\n}\n', 'utf8')
    const second = s.orchestrate(view, 'user_prompt')
    const slots = second.messages.filter((m) => m.toolCallId?.startsWith(CODING_SLOT_PREFIX))
    assert.equal(slots.length, 1)
    assert.ok(slots[0]?.content[0]?.type === 'text' && slots[0].content[0].text.includes('return 2'))
    assert.equal(validateSequence(second.messages), undefined)
  })

  it('未变动文件槽位原位（内容相同）', () => {
    const s = createCodingStrategy({ workspaceRoot: root })
    const watch = s.ownedTools!.find((t) => t.name === 'coding_watch')!
    watch.execute({ path: 'a.ts' }, { agentId: ROOT_AGENT_ID } as never)
    const view = {
      agentId: ROOT_AGENT_ID,
      envelopes: [env('1', textMsg('user', 'q')), env('2', textMsg('assistant', 'a'))],
      ctxTokens: 0,
      stamp: { source: true },
    }
    const r1 = s.orchestrate(view, 'user_prompt')
    const r2 = s.orchestrate(view, 'user_prompt')
    const body1 = r1.messages.find((m) => m.toolCallId?.startsWith(CODING_SLOT_PREFIX))
    const body2 = r2.messages.find((m) => m.toolCallId?.startsWith(CODING_SLOT_PREFIX))
    assert.equal(
      JSON.stringify(body1?.content),
      JSON.stringify(body2?.content),
    )
  })

  it('compact：作废非域历史，域快照写在摘要前', async () => {
    const s = createCodingStrategy({
      workspaceRoot: root,
      complete: async () => 'keep a.ts',
      keepTail: 1,
      compactAt: 10,
    })
    const watch = s.ownedTools!.find((t) => t.name === 'coding_watch')!
    watch.execute({ path: 'a.ts' }, { agentId: ROOT_AGENT_ID } as never)
    const envelopes: Envelope[] = [
      env('h1', textMsg('user', 'q1')),
      env('h2', textMsg('assistant', 'a1')),
      env('h3', textMsg('user', 'q2')),
      env('h4', textMsg('assistant', 'a2')),
      env('h5', textMsg('user', 'q3')),
    ]
    const r = await s.process!(
      {
        agentId: ROOT_AGENT_ID,
        envelopes,
        ctxTokens: 999,
        stamp: { source: true },
      },
      'watermark',
    )
    assert.ok(r)
    assert.ok((r?.rewrite?.invalidateIds.length ?? 0) >= 3)
    assert.ok(r?.messages.some((m) => m.toolCallId?.startsWith(CODING_SLOT_PREFIX)))
    const compactIdx = r!.messages.findIndex(
      (m) => m.kind === 'user' && m.content.some((p) => p.type === 'text' && p.text.includes('coding-compact')),
    )
    const snapIdx = r!.messages.findIndex((m) => m.toolCallId?.startsWith(CODING_SLOT_PREFIX))
    assert.ok(snapIdx >= 0 && compactIdx > snapIdx)
  })
})

describe('tree 工具', () => {
  it('输出行数与大小', () => {
    const root = mkdtempSync(join(tmpdir(), 'stem-tree-'))
    mkdirSync(join(root, 'sub'), { recursive: true })
    writeFileSync(join(root, 'a.txt'), '1\n2\n3\n', 'utf8')
    writeFileSync(join(root, 'sub', 'b.ts'), 'export const x = 1\n', 'utf8')
    const t = createTreeTool()
    const r = t.execute({ path: root, depth: 2 }, { agentId: ROOT_AGENT_ID } as never) as ToolResult
    assert.equal(r.kind, 'tool_ok')
    assert.ok(r.kind === 'tool_ok' && r.content.includes('a.txt'))
    assert.ok(r.kind === 'tool_ok' && r.content.includes('3L'))
    assert.ok(r.kind === 'tool_ok' && r.content.includes('sub/'))
    rmSync(root, { recursive: true, force: true })
  })
})
