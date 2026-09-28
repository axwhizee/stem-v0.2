// classic —— core 内置最小策略：有效序直出；水位时 compact 改写语料。
// 不做自定义记忆；完整策略实现属 extension/custom，core 不耦合。

import type { ContextStrategy, CorpusView, OrchestrateResult, Trigger } from '../types.ts'
import { projectMessages } from '../stamp.ts'
import {
  validateSequence,
  type Message,
  type Envelope,
} from '../../model/index.ts'

export type ClassicOptions = {
  /** 水位（token）；达到时 process 改写语料 */
  readonly compactAt?: number
  /** 摘要端口（宿主/ToolAgent 注入）；无则基线占位 */
  readonly complete?: (prompt: string) => Promise<string>
  /** compact 保留的头部消息数 */
  readonly keepHead?: number
  /** compact 保留的尾部消息数 */
  readonly keepTail?: number
}

export function createClassicStrategy(options?: ClassicOptions): ContextStrategy {
  const compactAt = options?.compactAt ?? Number.POSITIVE_INFINITY
  const complete = options?.complete
  const keepHead = options?.keepHead ?? 3
  const keepTail = options?.keepTail ?? 4

  return {
    name: 'classic',
    orchestrate(view: CorpusView): OrchestrateResult {
      const messages = projectMessages(view.envelopes, view.stamp)
      return { messages: validateSequence(messages) ? [] : messages }
    },
    async process(view: CorpusView): Promise<OrchestrateResult | undefined> {
      if (view.ctxTokens < compactAt) return undefined
      const valid = view.envelopes.filter((e) => e.valid)
      if (valid.length <= keepHead + keepTail + 1) return undefined

      const head = valid.slice(0, keepHead)
      const tail = valid.slice(-keepTail)
      const middle = valid.slice(keepHead, valid.length - keepTail)
      const headMsgs = head.map((e) => e.message)
      const tailMsgs = tail.map((e) => e.message)

      const summaryText = complete
        ? await complete(summarizePrompt(middle.map((e) => e.message))).catch(() =>
            placeholderText(middle.length),
          )
        : placeholderText(middle.length)

      const summary: Message = {
        kind: 'user',
        content: [{ type: 'text', text: `…[compact]\n${summaryText}` }],
      }

      const messages = legalizeCompactSequence(headMsgs, summary, tailMsgs)
      if (validateSequence(messages)) return undefined

      return {
        messages: [summary],
        rewrite: { invalidateIds: middle.map((e) => e.id) },
        ready: 'watermark',
      }
    },
    note: 'You are participating in a stem multi-agent system.',
  }
}

function placeholderText(count: number): string {
  return `[compressed ${count} earlier messages]`
}

/**
 * compact 结构：head 保留 + summary(user) + tail 保留。
 * 在两处接缝补空 assistant，避免 user↔user / tool→user 非法。
 */
export function legalizeCompactSequence(
  head: readonly Message[],
  summary: Message,
  tail: readonly Message[],
): Message[] {
  const out: Message[] = []
  for (const m of head) out.push(m)

  const lastHead = out.at(-1)
  if (lastHead && lastHead.kind !== 'assistant') {
    // user / tool / system 之后接 user 摘要需要 assistant 收束（system→user 本合法，补桥不伤）
    out.push({ kind: 'assistant', content: [] })
  }
  out.push(summary)

  const firstTail = tail[0]
  if (firstTail && firstTail.kind === 'user') {
    out.push({ kind: 'assistant', content: [] })
  }
  for (const m of tail) out.push(m)
  return out
}

function summarizePrompt(messages: readonly Message[]): string {
  const text = messages
    .map((m) => m.content.map((p) => (p.type === 'text' ? p.text : '')).join(''))
    .join('\n')
  return `Compress the dialogue into bullet notes:\n${text.slice(-6000)}`
}

/** none —— 跳过策略编排（占位符）。 */
export function createNoneStrategy(): ContextStrategy {
  return {
    name: 'none',
    orchestrate: () => ({ messages: [] }),
  }
}

export function createStrategyRegistry(strategies: readonly ContextStrategy[]) {
  const map = new Map(strategies.map((s) => [s.name, s]))
  return {
    get: (name: string) => map.get(name),
    names: () => [...map.keys()],
  }
}

export type { Envelope }
