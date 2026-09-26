// 事件中枢 —— 多订阅；SSE/IM 只是投递载体。
// 形状对齐 WebUI 订阅面：stream 携带 LLMEvent，letter/status/tool 各成一路。

import type { LLMEvent } from '../gateway/index.ts'
import type { ToolPhase } from '../tools/index.ts'

export type PilotEvent =
  | { readonly type: 'stream'; readonly agentId: string; readonly event: LLMEvent }
  | {
      readonly type: 'letter'
      readonly agentId: string
      readonly letters: readonly { readonly role: string; readonly content: string }[]
      readonly at: number
    }
  | {
      readonly type: 'status'
      readonly agentId: string
      readonly from: string
      readonly to: string
      readonly at: number
    }
  | {
      readonly type: 'tool'
      readonly agentId: string
      readonly tool: string
      readonly phase: ToolPhase
      readonly at: number
    }
  | { readonly type: 'error'; readonly agentId?: string; readonly message: string }

export type EventHandler = (event: PilotEvent) => void

export class EventHub {
  readonly #handlers = new Set<EventHandler>()

  on(handler: EventHandler): () => void {
    this.#handlers.add(handler)
    return () => this.#handlers.delete(handler)
  }

  emit(event: PilotEvent): void {
    for (const h of this.#handlers) {
      try {
        h(event)
      } catch {
        // 订阅方异常不影响总线
      }
    }
  }
}
