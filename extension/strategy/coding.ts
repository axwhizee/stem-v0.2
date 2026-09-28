// coding —— 扩展记忆策略：实时域（watched 文件快照）+ classic 式压缩。
//
// 实时域不是连续块，而是假 tool 调用槽：
//   - 新/变更快照放在「工具 assistant 之后、最终 assistant 之前」
//   - 同文件旧快照滚动标记失效（投影剥离）
//   - 未变动文件快照原位不动（保缓存）
// 压缩借鉴 classic 但保护实时域：摘要前汇总当前全部域快照，随后滚动更新。
// 终态 LSP 未做；demo 用可变行数截断 + agent 点名投影形式。

import { readFileSync, statSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, isAbsolute } from 'node:path'
import type {
  ContextStrategy,
  CorpusView,
  OrchestrateResult,
  Trigger,
} from '../../src/core/post/index.ts'
import type { Message, ToolCall } from '../../src/core/model/index.ts'
import { validateSequence, makeTextMessage } from '../../src/core/model/index.ts'
import type { ToolCapability, ToolContext } from '../../src/core/tools/index.ts'
import { toolOk, toolError } from '../../src/core/tools/index.ts'

export type SnapshotMode = 'full' | 'outline-diff' | 'diff'

export type WatchEntry = {
  readonly path: string
  mode: SnapshotMode
  maxLines: number
  /** 上次投影时的内容 hash；不变则槽位不动 */
  hash: string
  /** 上次投影正文 */
  body: string
  /** 稳定假 call id，便于滚动失效 */
  slotId: string
}

export type CodingOptions = {
  /** 文件根（项目根）；相对路径相对它解析 */
  readonly workspaceRoot: string
  /** 压缩摘要端口 */
  readonly complete?: (prompt: string) => Promise<string>
  /** 压缩保留尾部条数 */
  readonly keepTail?: number
  /** 压缩水位（ctxTokens）；默认无限 = 仅手动/watermark 显式触发 */
  readonly compactAt?: number
}

export type CodingState = {
  watches: Map<string, WatchEntry>
  seq: number
  compacting: boolean
}

const DEFAULT_MAX_LINES = 300
const SLOT_PREFIX = 'coding_file_'
const SLOT_TOOL_NAME = 'coding_snapshot'

function hashOf(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 12)
}

function resolvePath(workspaceRoot: string, p: string): string {
  return isAbsolute(p) ? resolve(p) : resolve(workspaceRoot, p)
}

function readCapped(path: string, maxLines: number): { body: string; truncated: boolean } {
  const text = readFileSync(path, 'utf8')
  const lines = text.split('\n')
  if (lines.length <= maxLines) return { body: text, truncated: false }
  return { body: lines.slice(0, maxLines).join('\n'), truncated: true }
}

/** 骨架：取非空的函数/类/导出/标题行。 */
function outlineOf(text: string, maxLines: number): string {
  const picked: string[] = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i] ?? ''
    if (/^\s*(export\s+)?(async\s+)?function\b|^\s*(export\s+)?(abstract\s+)?class\b|^\s*export\b|^\s*#\s|^\s*\/\/\s*---/.test(l)) {
      picked.push(`${i + 1}: ${l.slice(0, 160)}`)
    }
  }
  if (picked.length === 0) {
    return lines.slice(0, Math.min(maxLines, 40)).join('\n')
  }
  return picked.slice(0, maxLines).join('\n')
}

/** demo 级行块 diff：相对旧 body 给出变更块摘要。 */
function simpleDiff(oldText: string, newText: string, maxLines: number): string {
  const a = oldText.split('\n')
  const b = newText.split('\n')
  const out: string[] = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (a[i] === b[j]) {
      i++
      j++
      continue
    }
    const startJ = j
    while (j < b.length && a[i] !== b[j]) j++
    if (j === startJ) {
      i++
      continue
    }
    const chunk = b.slice(startJ, j)
    out.push(`@@ +${startJ + 1} ${chunk.length}L`)
    for (const line of chunk.slice(0, 20)) out.push(`+${line}`)
    if (chunk.length > 20) out.push(`+… (${chunk.length - 20} more lines)`)
    if (out.length >= maxLines) break
    i = Math.max(i + 1, j - 1)
  }
  if (out.length === 0) return '(no line-level delta)'
  return out.slice(0, maxLines).join('\n')
}

function renderSnapshot(entry: WatchEntry, workspaceRoot: string, previousBody: string): string {
  const abs = resolvePath(workspaceRoot, entry.path)
  if (!existsSync(abs)) return `[coding] missing: ${entry.path}`
  const { body, truncated } = readCapped(abs, entry.maxLines)
  const stat = statSync(abs)
  const header = `[coding:${entry.mode} lines=${entry.maxLines}${truncated ? ' truncated' : ''} ${entry.path} ${stat.size}B]`
  if (entry.mode === 'diff') {
    return `${header}\n${simpleDiff(previousBody, body, entry.maxLines)}`
  }
  if (entry.mode === 'outline-diff') {
    return `${header}\n--- outline ---\n${outlineOf(body, Math.min(80, entry.maxLines))}\n--- delta ---\n${simpleDiff(previousBody, body, entry.maxLines)}`
  }
  return `${header}\n${body}`
}

function isDomainAssistant(m: Message): boolean {
  return m.kind === 'assistant' && !!m.toolCalls?.some((c) => c.id.startsWith(SLOT_PREFIX))
}

function isDomainTool(m: Message): boolean {
  return m.kind === 'tool' && !!m.toolCallId?.startsWith(SLOT_PREFIX)
}

/**
 * 剥离过期域槽：
 * - 未 watch 的路径
 * - 同路径多槽只留最新（按 call id 中序号）
 * - body 与当前 hash 不一致（内容已变，改到尾部重发）
 */
function stripDomainSlots(
  messages: readonly Message[],
  watches: Map<string, WatchEntry>,
  currentBodyOf: (slotId: string) => string | undefined,
): Message[] {
  const keptSlotIds = new Set<string>()
  for (const w of watches.values()) keptSlotIds.add(w.slotId)

  // 同 path 只保留 watches 里的现行 slotId
  const pass1: Message[] = []
  for (const m of messages) {
    if (isDomainTool(m)) {
      const id = m.toolCallId ?? ''
      if (!keptSlotIds.has(id)) continue
      // 内容过期则丢弃（稍后重发）
      const cur = currentBodyOf(id)
      const body = m.content.map((p) => (p.type === 'text' ? p.text : '')).join('')
      if (cur !== undefined && body !== cur) continue
      pass1.push(m)
      continue
    }
    if (isDomainAssistant(m)) {
      const calls = (m.toolCalls ?? []).filter((c) => keptSlotIds.has(c.id))
      // 若其中部分 call 的 tool 会被丢，则一并过滤 call
      const liveCalls = calls.filter((c) => {
        const cur = currentBodyOf(c.id)
        return cur === undefined || true // tool 正文过滤在 tool 消息；这里保留 call，下面按 tool 是否保留再裁
      })
      if (liveCalls.length === 0) continue
      pass1.push({ ...m, toolCalls: liveCalls })
      continue
    }
    pass1.push(m)
  }

  // 第二遍：assistant 的 call 若无对应 tool 则去掉 call
  const retainedTools = new Set(
    pass1.filter((m) => m.kind === 'tool' && m.toolCallId).map((m) => m.toolCallId!),
  )
  const out: Message[] = []
  for (const m of pass1) {
    if (m.kind === 'assistant' && m.toolCalls?.some((c) => c.id.startsWith(SLOT_PREFIX))) {
      const rest = m.toolCalls.filter((c) => !c.id.startsWith(SLOT_PREFIX) || retainedTools.has(c.id))
      if (rest.length === 0) continue
      out.push({ ...m, toolCalls: rest })
      continue
    }
    out.push(m)
  }
  return out
}

/** 插入点：工具 assistant 之后、最终 assistant 之前。 */
function insertIndexForLiveDomain(messages: readonly Message[]): number {
  // 找最后一个无 toolCalls 的 assistant（最终回复）
  let finalAssistant = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m?.kind === 'assistant' && !m.toolCalls?.length) {
      finalAssistant = i
      break
    }
  }
  if (finalAssistant >= 0) return finalAssistant

  // 否则挂在末尾；若末尾是 tool 则在 tool 后（紧跟未来 assistant）
  return messages.length
}

function domainPair(entry: WatchEntry, body: string): Message[] {
  const call: ToolCall = {
    id: entry.slotId,
    name: SLOT_TOOL_NAME,
    arguments: { path: entry.path, mode: entry.mode, maxLines: entry.maxLines },
  }
  return [
    { kind: 'assistant', content: [], toolCalls: [call] },
    {
      kind: 'tool',
      content: [{ type: 'text', text: body }],
      toolCallId: entry.slotId,
    },
  ]
}

export function createCodingStrategy(options: CodingOptions): ContextStrategy {
  const workspaceRoot = options.workspaceRoot
  const state = new Map<string, CodingState>()

  const stateOf = (agentId: string): CodingState => {
    let s = state.get(agentId)
    if (!s) {
      s = { watches: new Map(), seq: 0, compacting: false }
      state.set(agentId, s)
    }
    return s
  }

  const refreshHash = (s: CodingState, e: WatchEntry): void => {
    const abs = resolvePath(workspaceRoot, e.path)
    if (!existsSync(abs)) {
      e.hash = 'missing'
      e.body = ''
      return
    }
    const { body } = readCapped(abs, e.maxLines)
    const fullText = readFileSync(abs, 'utf8')
    e.hash = hashOf(fullText)
    e.body = renderSnapshot(e, workspaceRoot, e.body)
    void body
  }

  const watchTool = (kind: 'watch' | 'unwatch' | 'status' | 'mode'): ToolCapability => {
    const name =
      kind === 'watch'
        ? 'coding_watch'
        : kind === 'unwatch'
          ? 'coding_unwatch'
          : kind === 'mode'
            ? 'coding_mode'
            : 'coding_status'
    return {
      name,
      description:
        kind === 'watch'
          ? 'Watch a file into the live domain (fake snapshot slots). Optional maxLines (default 300) and mode: full | outline-diff | diff.'
          : kind === 'unwatch'
            ? 'Remove a file from the live domain.'
            : kind === 'mode'
              ? 'Change snapshot mode/maxLines for a watched file.'
              : 'List watched files with mode/maxLines/hash.',
      kind: 'extension',
      registerAccess: 'hidden',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          maxLines: { type: 'number' },
          mode: { type: 'string', enum: ['full', 'outline-diff', 'diff'] },
        },
        required: kind === 'watch' || kind === 'unwatch' || kind === 'mode' ? ['path'] : [],
      },
      execute: (input: unknown, ctx: ToolContext) => {
        const args = (input ?? {}) as { path?: string; maxLines?: number; mode?: string }
        const s = stateOf(String(ctx.agentId))
        if (kind === 'status') {
          const rows = [...s.watches.values()].map(
            (w) => `- ${w.path} mode=${w.mode} maxLines=${w.maxLines} hash=${w.hash}`,
          )
          return toolOk(rows.join('\n') || '(no watched files)')
        }
        const path = args.path
        if (!path) return toolError('path required', 'invalid_args')
        const key = resolvePath(workspaceRoot, path)
        if (kind === 'unwatch') {
          for (const [k, w] of s.watches) {
            if (k === key || w.path === path) {
              s.watches.delete(k)
              return toolOk(`unwatched ${w.path}`)
            }
          }
          return toolError('not watched', 'not_found')
        }
        const mode = (args.mode as SnapshotMode | undefined) ?? s.watches.get(key)?.mode ?? 'full'
        if (!['full', 'outline-diff', 'diff'].includes(mode)) {
          return toolError('mode must be full|outline-diff|diff', 'invalid_args')
        }
        const maxLines = Number.isFinite(args.maxLines) ? (args.maxLines as number) : (s.watches.get(key)?.maxLines ?? DEFAULT_MAX_LINES)
        if (maxLines <= 0) return toolError('maxLines must be > 0', 'invalid_args')

        if (kind === 'mode') {
          const w = s.watches.get(key)
          if (!w) return toolError('not watched; coding_watch first', 'not_found')
          w.mode = mode
          w.maxLines = maxLines
          refreshHash(s, w)
          return toolOk(`mode ${w.path} → ${w.mode} maxLines=${w.maxLines}`)
        }

        if (!existsSync(key)) return toolError(`not found: ${path}`, 'not_found')
        s.seq += 1
        const entry: WatchEntry = {
          path,
          mode,
          maxLines,
          hash: '',
          body: '',
          slotId: `${SLOT_PREFIX}${s.seq}`,
        }
        refreshHash(s, entry)
        s.watches.set(key, entry)
        return toolOk(`watched ${path} mode=${mode} maxLines=${maxLines} hash=${entry.hash}`)
      },
    }
  }

  return {
    name: 'coding',
    ownedTools: [watchTool('watch'), watchTool('unwatch'), watchTool('mode'), watchTool('status')],
    note: 'You are a coding agent. Use tree/coding_watch to keep critical files in the live domain; prefer snapshots over repeated read calls.',

    orchestrate(view: CorpusView, trigger: Trigger): OrchestrateResult {
      const s = stateOf(view.agentId)
      void trigger
      const corpus: Message[] = []
      for (const env of view.envelopes) {
        if (env.valid) corpus.push(env.message)
      }

      // 先刷新脏文件（换 hash/body），再剥旧槽（旧 body ≠ 现 body 即失效）
      const dirty: WatchEntry[] = []
      for (const w of s.watches.values()) {
        const abs = resolvePath(workspaceRoot, w.path)
        const full = existsSync(abs) ? readFileSync(abs, 'utf8') : ''
        const h = hashOf(full)
        if (h !== w.hash) {
          refreshHash(s, w)
          dirty.push(w)
        }
      }

      const bodyOf = new Map<string, string>()
      for (const w of s.watches.values()) bodyOf.set(w.slotId, w.body)
      const cleaned = stripDomainSlots(corpus, s.watches, (id) => bodyOf.get(id))

      // 未出现在投影里的域槽（首次 watch / 被剥掉）也要补发
      const present = new Set(
        cleaned.filter((m) => m.kind === 'tool' && m.toolCallId).map((m) => m.toolCallId!),
      )
      const emit: WatchEntry[] = []
      for (const w of s.watches.values()) {
        if (dirty.includes(w) || !present.has(w.slotId)) emit.push(w)
      }

      const insertAt = insertIndexForLiveDomain(cleaned)
      const pairs: Message[] = []
      for (const w of emit) {
        pairs.push(...domainPair(w, w.body))
      }

      const out = [...cleaned.slice(0, insertAt), ...pairs, ...cleaned.slice(insertAt)]
      const ok = validateSequence(out)
      return { messages: ok ? [] : out }
    },

    async process(view: CorpusView, trigger: Trigger): Promise<OrchestrateResult | undefined> {
      const s = stateOf(view.agentId)
      if (s.compacting) return undefined
      // 只在水位/显式整理时做破坏性 compact；tool/user 回流只刷新投影
      const compactAt = options.compactAt ?? Number.POSITIVE_INFINITY
      if (trigger !== 'watermark' && trigger !== 'manual') return undefined
      if (view.ctxTokens < compactAt) return undefined
      if (!options.complete) return undefined

      // 破坏性压缩：非域历史压成摘要；域快照汇总到摘要前
      const domainIds = new Set<string>()
      for (const w of s.watches.values()) domainIds.add(w.slotId)

      const valid = view.envelopes.filter((e) => e.valid)
      const domainEnvs = valid.filter(
        (e) =>
          e.message.kind === 'tool' &&
          e.message.toolCallId &&
          domainIds.has(e.message.toolCallId),
      )
      const history = valid.filter(
        (e) =>
          !(e.message.kind === 'tool' && e.message.toolCallId && domainIds.has(e.message.toolCallId)) &&
          !(e.message.kind === 'assistant' && e.message.toolCalls?.some((c) => domainIds.has(c.id))),
      )
      const keepTail = options.keepTail ?? 4
      if (history.length <= keepTail + 1) return undefined

      s.compacting = true
      try {
        const head = history.slice(0, history.length - keepTail)
        const tail = history.slice(-keepTail)
        const text = head
          .map((e) => e.message.content.map((p) => (p.type === 'text' ? p.text : '')).join(''))
          .join('\n')
        const summaryText = await options
          .complete(
            `Compress this coding session history. Keep goals, decisions, file paths, and constraints. The live-domain file snapshots will be provided separately — do not try to restate full file bodies.\n${text.slice(-6000)}`,
          )
          .catch(() => `[coding compact ${head.length} messages]`)

        const summary = makeTextMessage('user', `…[coding-compact]\n${summaryText}`)

        // 域快照汇总到摘要前（作为 assistant+tool）
        const snapMsgs: Message[] = []
        for (const w of s.watches.values()) {
          const abs = resolvePath(workspaceRoot, w.path)
          if (existsSync(abs)) refreshHash(s, w)
          snapMsgs.push(...domainPair(w, w.body))
        }

        const tailMsgs = tail.map((e) => e.message)
        const readyMsgs: Message[] = [...snapMsgs]
        if (readyMsgs.at(-1)?.kind === 'tool') {
          readyMsgs.push({ kind: 'assistant', content: [] })
        }
        readyMsgs.push(summary)

        return {
          messages: readyMsgs,
          rewrite: { invalidateIds: head.map((e) => e.id) },
          ready: 'watermark',
        }
      } finally {
        s.compacting = false
      }
    },
  }
}

/** 导出给测试：假 call id 前缀 */
export const CODING_SLOT_PREFIX = SLOT_PREFIX
