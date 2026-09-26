// classic —— 有效序直出；水位可触发 compact（可注入 complete 做摘要，缺省基线占位）。

import type { ContextStrategy, CorpusView, OrchestrateResult, Trigger } from '../types.ts'
import { projectMessages } from '../stamp.ts'
import { validateSequence, type Message } from '../../model/index.ts'

export type ClassicOptions = {
  readonly compactAt?: number
  /** ToolAgent.complete 等摘要端口 */
  readonly complete?: (prompt: string) => Promise<string>
}

export function createClassicStrategy(options?: ClassicOptions): ContextStrategy {
  const compactAt = options?.compactAt ?? Number.POSITIVE_INFINITY
  const complete = options?.complete

  return {
    name: 'classic',
    orchestrate(view: CorpusView, trigger: Trigger): OrchestrateResult {
      const messages = projectMessages(view.envelopes, view.stamp)
      if (validateSequence(messages)) return { messages: [] }
      void trigger
      return { messages }
    },
    async process(view: CorpusView): Promise<OrchestrateResult | undefined> {
      if (view.ctxTokens < compactAt) return undefined
      const messages = projectMessages(view.envelopes, view.stamp)
      const compacted = complete
        ? await compactWithComplete(messages, complete)
        : compactBaseline(messages)
      return { messages: compacted, ready: 'watermark' }
    },
    note: 'You are participating in a stem multi-agent system.',
  }
}

async function compactWithComplete(
  messages: readonly Message[],
  complete: (prompt: string) => Promise<string>,
): Promise<Message[]> {
  if (messages.length <= 8) return [...messages]
  const head = messages.slice(0, 3)
  const tail = messages.slice(-3)
  const midRaw = messages.slice(3, -3)
  const text = midRaw
    .map((m) => m.content.map((p) => (p.type === 'text' ? p.text : `[${p.type}]`)).join(''))
    .join('\n')
  try {
    const summary = await complete(`Compress the following dialogue into bullet notes:\n${text}`)
    return [
      ...head,
      { kind: 'user', content: [{ type: 'text', text: `…[compacted]\n${summary}` }] },
      ...tail,
    ]
  } catch {
    return compactBaseline(messages)
  }
}

/** 无 LLM 的基线压缩：过长时中间变占位，保后继合法。 */
function compactBaseline(messages: readonly Message[]): Message[] {
  if (messages.length <= 8) return [...messages]
  const head = messages.slice(0, 3)
  const tail = messages.slice(-3)
  const mid: Message = {
    kind: 'user',
    content: [{ type: 'text', text: `…[earlier ${messages.length - 6} messages compacted]…` }],
  }
  const lastHead = head[head.length - 1]
  if (lastHead && lastHead.kind === 'assistant') {
    return [...head, mid, ...tail]
  }
  return [...head, ...tail]
}
