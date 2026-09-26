// classic —— 有效序直出；水位可触发 compact（process）。

import type { ContextStrategy, CorpusView, OrchestrateResult, Trigger } from '../types.ts'
import { projectMessages } from '../stamp.ts'
import { validateSequence, type Message } from '../../model/index.ts'

export function createClassicStrategy(options?: {
  /** 水位阈值；达到时 process 做 compact（摘要暂存语义由宿主补全） */
  readonly compactAt?: number
}): ContextStrategy {
  const compactAt = options?.compactAt ?? Number.POSITIVE_INFINITY

  return {
    name: 'classic',
    orchestrate(view: CorpusView, trigger: Trigger): OrchestrateResult {
      const messages = projectMessages(view.envelopes, view.stamp)
      const err = validateSequence(messages)
      if (err) {
        // 投影应恒合法；若语料本身未决未闭，返回空投影让上层等待
        return { messages: [] }
      }
      void trigger
      return { messages }
    },
    async process(view: CorpusView): Promise<OrchestrateResult | undefined> {
      if (view.ctxTokens < compactAt) return undefined
      // 紧凑基线：保留头尾、中间以摘要占位（摘要生成由 complete/宿主注入）
      const messages = projectMessages(view.envelopes, view.stamp)
      const compacted = compactBaseline(messages)
      return { messages: compacted, ready: 'watermark' }
    },
    note: 'You are participating in a stem multi-agent system.',
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
  // head 后必须能接 user：若 head 末是 assistant 可接 user；若是 tool 序列需谨慎
  const lastHead = head[head.length - 1]
  if (lastHead && lastHead.kind === 'assistant') {
    return [...head, mid, ...tail]
  }
  return [...head, ...tail]
}
