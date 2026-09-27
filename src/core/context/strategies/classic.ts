// classic —— core 内置最小策略：有效序直出；水位时 compact 改写语料。
// 不做自定义记忆；完整策略实现属 extension/custom，core 不耦合。

import type { ContextStrategy, CorpusView, OrchestrateResult, Trigger } from '../types.ts'
import { projectMessages } from '../stamp.ts'
import { validateSequence, type Message, type Envelope } from '../../model/index.ts'

export type ClassicOptions = {
  /** 水位（token）；达到时 process 改写语料 */
  readonly compactAt?: number
  /** 摘要端口（宿主/ToolAgent 注入）；无则基线占位 */
  readonly complete?: (prompt: string) => Promise<string>
}

export function createClassicStrategy(options?: ClassicOptions): ContextStrategy {
  const compactAt = options?.compactAt ?? Number.POSITIVE_INFINITY
  const complete = options?.complete

  return {
    name: 'classic',
    orchestrate(view: CorpusView): OrchestrateResult {
      const messages = projectMessages(view.envelopes, view.stamp)
      return { messages: validateSequence(messages) ? [] : messages }
    },
    async process(view: CorpusView): Promise<OrchestrateResult | undefined> {
      if (view.ctxTokens < compactAt) return undefined
      const messages = projectMessages(view.envelopes, view.stamp)
      if (messages.length <= 8) return undefined
      const summary: Message = complete
        ? await complete(summarizePrompt(messages)).then(
            (text) => ({
              kind: 'user',
              content: [{ type: 'text', text: `…[compact]\n${text}` }],
            }),
            () => placeholder(messages),
          )
        : placeholder(messages)
      // compact = 改写语料：旧段作废 + 摘要占位（由上层写回）
      return { messages: [summary], ready: 'watermark' }
    },
    note: 'You are participating in a stem multi-agent system.',
  }
}

function placeholder(messages: readonly Message[]): Message {
  return {
    kind: 'user',
    content: [{ type: 'text', text: `…[compact ${messages.length} messages]…` }],
  }
}

function summarizePrompt(messages: readonly Message[]): string {
  const text = messages
    .map((m) => m.content.map((p) => (p.type === 'text' ? p.text : '')).join(''))
    .join('\n')
  return `Compress the dialogue into bullet notes:\n${text.slice(-4000)}`
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
