// OpenAI 兼容协议客户端。端点/密钥由宿主注入，本文件零端点常量、零 process.env。

import type { ModelGateway, ChatOptions } from '../ModelGateway.ts'
import type {
  ChatMessage,
  LLMRequest,
  LLMEvent,
  UsageEvent,
  ProtocolContentPart,
} from '../types.ts'
import { GatewayError } from '../types.ts'

export const DEFAULT_REQUEST_TIMEOUT_MS = 300_000

export type OpenAiCompatibleConfig = {
  /** 服务基址；实际 POST `{base}/chat/completions` */
  readonly baseUrl: string
  /** Bearer 密钥；缺省 = 匿名（不发 Authorization） */
  readonly apiKey?: string
  /** 启用模型白名单；空/缺省 = 全启用 */
  readonly models?: readonly string[]
  readonly requestTimeoutMs?: number
  /** 可注入 fetch（测试） */
  readonly fetch?: typeof fetch
}

export function createOpenAiCompatibleGateway(config: OpenAiCompatibleConfig): ModelGateway {
  const base = config.baseUrl.replace(/\/+$/, '')
  if (base === '') {
    throw new GatewayError({ kind: 'provider_unwired', message: 'provider baseUrl 为空' })
  }
  const httpFetch = config.fetch ?? globalThis.fetch
  const requestTimeoutMs = config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  const whitelist =
    config.models !== undefined && config.models.length > 0 ? new Set(config.models) : undefined
  const endpoint = `${base}/chat/completions`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
    ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
  }

  async function* chat(request: LLMRequest, options?: ChatOptions): AsyncIterable<LLMEvent> {
    if (whitelist && !whitelist.has(request.model.id)) {
      throw new GatewayError({
        kind: 'model_not_allowed',
        message: `模型 "${request.model.provider}/${request.model.id}" 不在白名单`,
      })
    }
    const ctl = new AbortController()
    const external = options?.signal
    let onAbort: (() => void) | undefined
    if (external) {
      if (external.aborted) ctl.abort(external.reason)
      else {
        onAbort = () => ctl.abort(external.reason)
        external.addEventListener('abort', onAbort, { once: true })
      }
    }
    const timeoutId = setTimeout(() => ctl.abort(), requestTimeoutMs)
    try {
      const response = await httpFetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(buildBody(request)),
        signal: ctl.signal,
      })
      if (!response.ok) throw await toGatewayError(response)
      if (!response.body) {
        throw new GatewayError({ kind: 'invalid_response', message: '响应无正文流' })
      }
      yield* parseSse(response.body)
    } catch (error) {
      throw toGatewayErrorFromCause(error, ctl.signal)
    } finally {
      clearTimeout(timeoutId)
      if (external && onAbort) external.removeEventListener('abort', onAbort)
      ctl.abort()
    }
  }

  return { chat }
}

function buildBody(request: LLMRequest): Record<string, unknown> {
  const messages: unknown[] = []
  if (request.system) messages.push({ role: 'system', content: request.system })
  for (const message of request.messages) messages.push(toApiMessage(message))

  const body: Record<string, unknown> = {
    model: request.model.id,
    messages,
    stream: true,
    stream_options: { include_usage: true },
  }
  if (request.tools?.length) {
    body.tools = request.tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }))
  }
  if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens
  if (request.temperature !== undefined) body.temperature = request.temperature
  if (request.reasoningEffort !== undefined && request.reasoningEffort !== 'none') {
    body.reasoning_effort = request.reasoningEffort
  }
  return body
}

function toApiMessage(message: ChatMessage): Record<string, unknown> {
  const result: Record<string, unknown> = {
    role: message.role,
    content: Array.isArray(message.content)
      ? message.content.map(toApiContentPart)
      : message.content,
  }
  if (message.role === 'assistant' && message.toolCalls?.length) {
    result.tool_calls = message.toolCalls.map((tc, index) => ({
      id: tc.id,
      type: 'function',
      index,
      function: { name: tc.name, arguments: tc.arguments },
    }))
  }
  if (message.role === 'tool' && message.toolCallId !== undefined) {
    result.tool_call_id = message.toolCallId
  }
  return result
}

function toApiContentPart(part: ProtocolContentPart): Record<string, unknown> {
  if (part.type === 'text') return { type: 'text', text: part.text }
  const url = part.data ? `data:${part.mime ?? 'image/png'};base64,${part.data}` : part.url
  return { type: 'image_url', image_url: { url, detail: part.detail ?? 'auto' } }
}

type PendingToolCall = { id: string | undefined; name: string; argsBuffer: string }

async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<LLMEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  const pending = new Map<number, PendingToolCall>()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let nl: number
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim()
        buffer = buffer.slice(nl + 1)
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (data === '[DONE]') continue
        let chunk: unknown
        try {
          chunk = JSON.parse(data)
        } catch {
          throw new GatewayError({ kind: 'invalid_response', message: `SSE 载荷非法: ${data}` })
        }
        yield* handleChunk(chunk, pending)
      }
    }
  } catch (error) {
    if (error instanceof GatewayError) throw error
    throw new GatewayError({ kind: 'request_failed', message: '流读取失败', cause: error })
  } finally {
    reader.releaseLock()
  }
}

function handleChunk(chunk: unknown, pending: Map<number, PendingToolCall>): LLMEvent[] {
  const events: LLMEvent[] = []
  if (!isRecord(chunk)) return events
  if (chunk.error !== undefined) throw errorFromBody(chunk.error)

  const choice = Array.isArray(chunk.choices) ? chunk.choices[0] : undefined
  if (isRecord(choice)) {
    const delta = isRecord(choice.delta) ? choice.delta : {}
    if (typeof delta.content === 'string' && delta.content !== '') {
      events.push({ type: 'text-delta', text: delta.content })
    }
    const reasoning =
      delta.reasoning_content ??
      (isRecord(delta.reasoning) ? delta.reasoning.content : delta.reasoning)
    if (typeof reasoning === 'string' && reasoning !== '') {
      events.push({ type: 'reasoning-delta', text: reasoning })
    }
    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        if (!isRecord(tc)) continue
        const index = typeof tc.index === 'number' ? tc.index : pending.size
        const existing = pending.get(index) ?? { id: undefined, name: '', argsBuffer: '' }
        // 尾分片可能带空 id，不得覆盖首片真 id
        if (typeof tc.id === 'string' && tc.id !== '') existing.id = tc.id
        const fn = isRecord(tc.function) ? tc.function : {}
        if (typeof fn.name === 'string') existing.name += fn.name
        if (typeof fn.arguments === 'string') existing.argsBuffer += fn.arguments
        pending.set(index, existing)
      }
    }
    if (typeof choice.finish_reason === 'string') {
      const reason = choice.finish_reason
      if (reason === 'tool_calls' && pending.size > 0) {
        for (const call of pending.values()) {
          if (!call.id) continue
          events.push({
            type: 'tool-call',
            id: call.id,
            name: call.name,
            input: parseToolInput(call.argsBuffer),
          })
        }
        pending.clear()
      }
      events.push({ type: 'finish', reason: normalizeFinishReason(reason) })
    }
  }
  if (isRecord(chunk.usage)) events.push(usageEvent(chunk.usage))
  return events
}

function usageEvent(usage: Record<string, unknown>): UsageEvent {
  const details = isRecord(usage.prompt_tokens_details) ? usage.prompt_tokens_details : {}
  const inputDetails = isRecord(usage.input_tokens_details) ? usage.input_tokens_details : {}
  const cached =
    numberOrZero(details.cached_tokens) +
    numberOrZero(inputDetails.cache_read_input_tokens) +
    numberOrZero(usage.cache_read_input_tokens)
  const inputTokens = numberOrZero(usage.prompt_tokens) || numberOrZero(usage.input_tokens)
  const outputTokens = numberOrZero(usage.completion_tokens) || numberOrZero(usage.output_tokens)
  const cacheWrite =
    numberOrZero(inputDetails.cache_creation_input_tokens) +
    numberOrZero(usage.cache_write_input_tokens)
  return {
    type: 'usage',
    inputTokens,
    outputTokens,
    ...(cached > 0 ? { cacheReadTokens: cached } : {}),
    ...(cacheWrite > 0 ? { cacheWriteTokens: cacheWrite } : {}),
  }
}

function normalizeFinishReason(reason: string): 'stop' | 'tool_calls' | 'length' {
  if (reason === 'tool_calls') return 'tool_calls'
  if (reason === 'length' || reason === 'max_tokens') return 'length'
  return 'stop'
}

function parseToolInput(raw: string): unknown {
  if (raw.trim() === '') return {}
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

const CONTEXT_OVERFLOW_PATTERNS: RegExp[] = [
  /prompt is too long/i,
  /request_too_large/i,
  /exceeds the context window/i,
  /exceeds (?:the )?(?:model'?s )?maximum context length/i,
  /context[_ ]length[_ ]exceeded/i,
  /context length is only \d+ tokens/i,
  /model_context_window_exceeded/i,
  /too many tokens/i,
  /token limit exceeded/i,
]
const CONTEXT_EXCLUSIONS: RegExp[] = [/^(throttling error|service unavailable):/i, /rate limit/i, /too many requests/i]

function isContextOverflow(message: string): boolean {
  return (
    !CONTEXT_EXCLUSIONS.some((p) => p.test(message)) &&
    CONTEXT_OVERFLOW_PATTERNS.some((p) => p.test(message))
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function errorMessageFromBody(body: unknown): string | undefined {
  if (typeof body === 'string') return body
  if (isRecord(body)) {
    if (typeof body.message === 'string') return body.message
    if (isRecord(body.error)) {
      if (typeof body.error.message === 'string') return body.error.message
      if (typeof body.error.code === 'string') return body.error.code
    }
    if (typeof body.code === 'string') return body.code
  }
  return undefined
}

function errorFromBody(body: unknown): GatewayError {
  const message = errorMessageFromBody(body) ?? '服务商错误'
  return isContextOverflow(message)
    ? new GatewayError({ kind: 'context_overflow', message })
    : new GatewayError({ kind: 'api_error', message })
}

async function toGatewayError(response: Response): Promise<GatewayError> {
  const raw = await response.text().catch(() => '')
  let body: unknown = raw
  try {
    body = JSON.parse(raw)
  } catch {
    // 非 JSON 保留原文
  }
  const message = errorMessageFromBody(body) ?? `HTTP ${response.status} ${response.statusText}`
  if (response.status === 413 || isContextOverflow(message)) {
    return new GatewayError({ kind: 'context_overflow', message, statusCode: response.status })
  }
  return new GatewayError({
    kind: 'api_error',
    message,
    retryable: response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500,
    statusCode: response.status,
  })
}

function toGatewayErrorFromCause(error: unknown, signal: AbortSignal): GatewayError {
  if (error instanceof GatewayError) return error
  return new GatewayError({
    kind: 'request_failed',
    message: signal.aborted ? '请求中止' : '请求失败',
    cause: error,
  })
}
