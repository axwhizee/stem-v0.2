// 事件中枢 —— 多订阅；SSE/IM 只是投递载体。

export type PilotEvent =
  | { readonly type: 'stream'; readonly agentId: string; readonly text: string; readonly done?: boolean }
  | { readonly type: 'letter'; readonly agentId: string; readonly envelopeId: string; readonly preview: string }
  | { readonly type: 'status'; readonly agentId: string; readonly status: string }
  | { readonly type: 'tool'; readonly agentId: string; readonly name: string; readonly phase: string }
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
