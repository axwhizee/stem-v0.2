// 网关领域类型 —— 与宿主完全解耦；端点/密钥由宿主注入。

export type ModelRef = {
  readonly provider: string
  readonly id: string
}

export type EffortLevel = 'none' | 'low' | 'medium' | 'high'

export type TextPart = { readonly type: 'text'; readonly text: string }
export type ImagePart = {
  readonly type: 'image'
  readonly url?: string
  readonly data?: string
  readonly mime?: string
  readonly detail?: 'low' | 'high' | 'auto'
}
export type ProtocolContentPart = TextPart | ImagePart

export type ToolCall = {
  readonly id: string
  readonly name: string
  /** 协议层为 JSON 字符串 */
  readonly arguments: string
}

export type ChatMessage = {
  readonly role: 'system' | 'user' | 'assistant' | 'tool'
  readonly content: string | readonly ProtocolContentPart[]
  readonly toolCalls?: readonly ToolCall[]
  readonly toolCallId?: string
}

export type ToolDefinition = {
  readonly name: string
  readonly description: string
  readonly parameters: Record<string, unknown>
}

export type LLMRequest = {
  readonly model: ModelRef
  readonly system?: string
  readonly messages: readonly ChatMessage[]
  readonly tools?: readonly ToolDefinition[]
  readonly maxTokens?: number
  readonly temperature?: number
  readonly reasoningEffort?: EffortLevel
}

export type ToolCallEvent = {
  readonly type: 'tool-call'
  readonly id: string
  readonly name: string
  readonly input: unknown
}

export type UsageEvent = {
  readonly type: 'usage'
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens?: number
  readonly cacheWriteTokens?: number
}

export type FinishEvent = {
  readonly type: 'finish'
  readonly reason: 'stop' | 'tool_calls' | 'length'
}

export type LLMEvent =
  | { readonly type: 'text-delta'; readonly text: string }
  | { readonly type: 'reasoning-delta'; readonly text: string }
  | ToolCallEvent
  | UsageEvent
  | FinishEvent

export type GatewayErrorKind =
  | 'auth_missing'
  | 'context_overflow'
  | 'api_error'
  | 'invalid_response'
  | 'request_failed'
  | 'provider_unwired'
  | 'model_not_allowed'

export class GatewayError extends Error {
  readonly kind: GatewayErrorKind
  readonly retryable: boolean
  readonly statusCode?: number

  constructor(input: {
    kind: GatewayErrorKind
    message: string
    retryable?: boolean
    statusCode?: number
    cause?: unknown
  }) {
    super(input.message, input.cause === undefined ? undefined : { cause: input.cause })
    this.name = 'GatewayError'
    this.kind = input.kind
    this.retryable = input.retryable ?? false
    if (input.statusCode !== undefined) this.statusCode = input.statusCode
  }
}

export function isGatewayError(value: unknown): value is GatewayError {
  return value instanceof GatewayError
}

export function isAbortError(value: unknown): value is Error & { readonly name: 'AbortError' } {
  return (value instanceof Error || value instanceof DOMException) && value.name === 'AbortError'
}

export function parseModelRef(value: string): ModelRef | undefined {
  const slash = value.indexOf('/')
  if (slash <= 0 || slash === value.length - 1) return undefined
  return { provider: value.slice(0, slash), id: value.slice(slash + 1) }
}
