// 测试替身网关（无网络）：按脚本产出事件，记录请求供断言。

import type { ModelGateway, ChatOptions } from './ModelGateway.ts'
import type { LLMEvent, LLMRequest } from './types.ts'

export function textEvents(
  text: string,
  usage?: { inputTokens?: number; outputTokens?: number },
): LLMEvent[] {
  const events: LLMEvent[] = []
  const chunk = 8
  for (let i = 0; i < text.length; i += chunk) {
    events.push({ type: 'text-delta', text: text.slice(i, i + chunk) })
  }
  events.push({
    type: 'usage',
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
  })
  events.push({ type: 'finish', reason: 'stop' })
  return events
}

export type FakeGatewayHandler = (
  request: LLMRequest,
  options?: ChatOptions,
) => Iterable<LLMEvent> | AsyncIterable<LLMEvent>

export class FakeGateway implements ModelGateway {
  readonly requests: LLMRequest[] = []

  constructor(private readonly handler: FakeGatewayHandler) {}

  async *chat(request: LLMRequest, options?: ChatOptions): AsyncIterable<LLMEvent> {
    this.requests.push(request)
    if (options?.signal?.aborted) throw abortError()
    const result = this.handler(request, options)
    if (Symbol.asyncIterator in Object(result)) {
      yield* result as AsyncIterable<LLMEvent>
    } else {
      for (const event of result as Iterable<LLMEvent>) yield event
    }
    if (options?.signal?.aborted) throw abortError()
  }
}

export function abortError(): Error & { readonly name: 'AbortError' } {
  const error = new Error('The operation was aborted')
  error.name = 'AbortError'
  return error as Error & { readonly name: 'AbortError' }
}
