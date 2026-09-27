// cortex —— 扩展记忆策略：LTM ∥ STM ∥ 上下文（含笔记清单）。
// 笔记目录 = 假 tool 结果槽：插在「最新 userPrompt 前的 assistant」之前，
// 原地再生、全局只保留一份，避免 churn 轮结构、少伤缓存前缀。
// 整理经 complete；无 dreamer 实例；笔记住 home/<id>/。

import type {
  ContextStrategy,
  CorpusView,
  OrchestrateResult,
  Trigger,
} from '../../src/core/post/index.ts'
import type { Message, ContentPart } from '../../src/core/model/index.ts'
import { validateSequence, makeTextMessage } from '../../src/core/model/index.ts'
import type { ToolCapability } from '../../src/core/tools/index.ts'
import { toolOk, toolError } from '../../src/core/tools/index.ts'
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/** 假 tool 槽固定 id：投影内唯一，便于原地替换。 */
export const NOTES_CALL_ID = 'cortex_notes'
export const NOTES_TOOL_NAME = 'cortex_note_dir'

export type CortexState = {
  ltm: string[]
  stm: string[]
  dreamAt: number
  dreaming: boolean
}

export type CortexOptions = {
  readonly homeRoot: string
  readonly complete?: (prompt: string) => Promise<string>
  readonly dreamAt?: number
  readonly note?: string
  /** 策略自持配置（jsonc 路径）；缺省 homeRoot 同级 cortex.jsonc */
  readonly configFile?: string
}

/** 策略自维护配置，不进 stem.jsonc。 */
export function loadCortexConfig(file: string): { dreamAt?: number; note?: string } {
  try {
    const text = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    const o = JSON.parse(text) as { dreamAt?: number; note?: string }
    return { dreamAt: o.dreamAt, note: o.note }
  } catch {
    return {}
  }
}

function homeOf(homeRoot: string, agentId: string): string {
  return join(homeRoot, agentId)
}

function listNotes(homeRoot: string, agentId: string): string[] {
  const dir = homeOf(homeRoot, agentId)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
}

function readNotes(homeRoot: string, agentId: string): string[] {
  const dir = homeOf(homeRoot, agentId)
  return listNotes(homeRoot, agentId).map((f) => readFileSync(join(dir, f), 'utf8'))
}

function notesDirectoryText(homeRoot: string, agentId: string): string {
  const names = listNotes(homeRoot, agentId)
  if (names.length === 0) return '(no notes)'
  return names.map((n) => `- ${n}`).join('\n')
}

/**
 * 笔记目录假 tool 槽：
 * 1) 去掉历史投影里同 id 的旧槽（只留一份）
 * 2) 插在「最新 userPrompt 的前驱 assistant」之前；无该 assistant 则紧贴最新 user 之前
 * 3) 形状恒为 assistant(toolCalls)+tool，内容原地再生
 */
export function spliceNoteSlot(
  messages: readonly Message[],
  noteText: string,
): Message[] {
  const cleaned: Message[] = []
  for (const m of messages) {
    if (m.kind === 'tool' && m.toolCallId === NOTES_CALL_ID) continue
    if (m.kind === 'assistant' && m.toolCalls?.some((c) => c.id === NOTES_CALL_ID)) {
      const rest = m.toolCalls.filter((c) => c.id !== NOTES_CALL_ID)
      if (rest.length === 0) continue
      cleaned.push({ ...m, toolCalls: rest })
      continue
    }
    cleaned.push(m)
  }

  // 最新 userPrompt 位置
  let lastUser = -1
  for (let i = cleaned.length - 1; i >= 0; i--) {
    if (cleaned[i]?.kind === 'user') {
      lastUser = i
      break
    }
  }

  // 插入点：最新 user 的前驱 assistant 之前；无则紧贴最新 user 之前
  let insertAt = lastUser >= 0 ? lastUser : cleaned.length
  if (lastUser > 0) {
    for (let i = lastUser - 1; i >= 0; i--) {
      const m = cleaned[i]
      if (!m) continue
      if (m.kind === 'assistant') {
        insertAt = i
        break
      }
      if (m.kind === 'user') break
    }
  }
  // 序列起始不能是 assistant：落在头部时改挂在首个 user 之后
  if (insertAt === 0) insertAt = 1

  const slotAssistant: Message = {
    kind: 'assistant',
    content: [],
    toolCalls: [{ id: NOTES_CALL_ID, name: NOTES_TOOL_NAME, arguments: {} }],
  }
  const slotTool: Message = {
    kind: 'tool',
    content: [{ type: 'text', text: noteText }],
    toolCallId: NOTES_CALL_ID,
  }
  // tool 不得直接接 user：若后继是 user，用空 assistant 收束
  const bridge: Message[] =
    insertAt < cleaned.length && cleaned[insertAt]?.kind === 'user'
      ? [{ kind: 'assistant', content: [] }]
      : []

  return [...cleaned.slice(0, insertAt), slotAssistant, slotTool, ...bridge, ...cleaned.slice(insertAt)]
}

export function createCortexStrategy(options: CortexOptions): ContextStrategy {
  const state = new Map<string, CortexState>()
  const homeRoot = options.homeRoot
  const fileCfg = options.configFile ? loadCortexConfig(options.configFile) : {}
  const dreamAt = options.dreamAt ?? fileCfg.dreamAt ?? 8000

  const stateOf = (id: string): CortexState => {
    let s = state.get(id)
    if (!s) {
      s = { ltm: [], stm: [], dreamAt, dreaming: false }
      state.set(id, s)
    }
    return s
  }

  const notesTool = (kind: 'add' | 'del'): ToolCapability => ({
    name: kind === 'add' ? 'cortex_add_note' : 'cortex_del_note',
    description:
      kind === 'add'
        ? 'Add or update a topic note under home/<agentId>/'
        : 'Delete a topic note under home/<agentId>/',
    kind: 'extension',
    registerAccess: 'hidden',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'note file name without path' },
        body: { type: 'string' },
      },
      required: kind === 'add' ? ['name', 'body'] : ['name'],
    },
    execute: (input: unknown, ctx) => {
      const args = input as { name?: string; body?: string }
      if (!args.name || args.name.includes('/') || args.name.includes('\\')) {
        return toolError('invalid note name', 'invalid_args')
      }
      const dir = homeOf(homeRoot, ctx.agentId)
      mkdirSync(dir, { recursive: true })
      const file = join(dir, args.name.endsWith('.md') ? args.name : `${args.name}.md`)
      if (kind === 'add') {
        writeFileSync(file, args.body ?? '', 'utf8')
        return toolOk(`saved ${args.name}`)
      }
      if (existsSync(file)) {
        writeFileSync(file, '', 'utf8')
        return toolOk(`cleared ${args.name}`)
      }
      return toolError('not found', 'not_found')
    },
  })

  return {
    name: 'cortex',
    ownedTools: [notesTool('add'), notesTool('del')],
    note: options.note ?? 'You are a long-horizon agent with externalized memory notes.',
    orchestrate(view: CorpusView, trigger: Trigger): OrchestrateResult {
      const s = stateOf(view.agentId)
      const headParts: ContentPart[] = []
      if (s.ltm.length) {
        headParts.push({ type: 'text', text: `[LTM]\n${s.ltm.join('\n')}\n` })
      }
      if (s.stm.length) {
        headParts.push({ type: 'text', text: `[STM]\n${s.stm.join('\n')}\n` })
      }

      const corpus: Message[] = []
      for (const env of view.envelopes) {
        if (!env.valid) continue
        corpus.push(env.message)
      }

      const noteText = notesDirectoryText(homeRoot, view.agentId)
      const withNotes = spliceNoteSlot(corpus, noteText)

      const head = headParts.length
        ? [makeTextMessage('system', headParts.map((p) => (p.type === 'text' ? p.text : '')).join(''))]
        : []
      const messages = [...head, ...withNotes]

      if (validateSequence(messages)) {
        const only = validateSequence(withNotes)
        return { messages: only ? [] : withNotes }
      }
      void trigger
      return { messages }
    },

    async process(view: CorpusView): Promise<OrchestrateResult | undefined> {
      const s = stateOf(view.agentId)
      if (s.dreaming || view.ctxTokens < s.dreamAt) return undefined
      if (!options.complete) return undefined
      s.dreaming = true
      try {
        const corpusText = view.envelopes
          .filter((e) => e.valid)
          .map((e) =>
            e.message.content.map((p) => (p.type === 'text' ? p.text : `[${p.type}]`)).join(''),
          )
          .join('\n')
        // 段1 → 暂存 STM；不合格不轮替
        const stmReport = await options.complete(
          `Summarize the working context into short-term notes (STM).\n${corpusText.slice(-4000)}`,
        )
        const nextStm = stmReport.split('\n').filter(Boolean).slice(0, 12)
        if (nextStm.length === 0) return undefined

        const notesText = readNotes(homeRoot, view.agentId).join('\n')
        // 段2 → 暂存 LTM；不合格不轮替
        const ltmReport = await options.complete(
          `Distill long-term memory (LTM) from prior LTM + STM + notes.\n[LTM]\n${s.ltm.join('\n')}\n[STM]\n${nextStm.join('\n')}\n[Notes]\n${notesText}`,
        )
        const nextLtm = ltmReport.split('\n').filter(Boolean).slice(0, 20)
        if (nextLtm.length === 0) return undefined

        // 双段合格才 rotate
        s.stm = nextStm
        s.ltm = nextLtm
        return this.orchestrate(view, 'watermark')
      } catch {
        return undefined
      } finally {
        s.dreaming = false
      }
    },
  }
}
