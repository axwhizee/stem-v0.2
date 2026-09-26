import type { LLMEvent, LLMRequest } from './types.ts'

export type ChatOptions = {
  readonly signal?: AbortSignal
}

/** 模型网关契约：流式一律 AsyncIterable。 */
export interface ModelGateway {
  chat(request: LLMRequest, options?: ChatOptions): AsyncIterable<LLMEvent>
}
