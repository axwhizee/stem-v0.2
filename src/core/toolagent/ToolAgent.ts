// ToolAgent —— 独立于实例树的工具执行体；系统直调，不写语料。

import type { Message } from '../model/index.ts'
import type { ModelGateway, LLMEvent, ToolDefinition, ChatMessage } from '../gateway/index.ts'
import { toChatMessage } from '../gateway/index.ts'
import type { ToolCapabilityRegistry, AccessResolver, ToolResult } from '../tools/index.ts'
import { validateSequence } from '../model/index.ts'

export type ToolAgentSpec = {
  readonly system?: string
  readonly model: string
  readonly tools: readonly string[]
  readonly maxSteps?: number
}

export type CompleteRequest = {
  readonly messages: readonly Message[]
  readonly signal?: AbortSignal
}

export type CompleteResult = {
  readonly text: string
  readonly messages: readonly Message[]
  readonly toolRounds: number
  readonly finish: 'stop' | 'length' | 'tool_calls'
  readonly usage?: { inputTokens: number; outputTokens: number }
}

export type ToolAgent = {
  readonly complete: (req: CompleteRequest) => Promise<CompleteResult>
}

export type ToolAgentDeps = {
  readonly gateway: ModelGateway
  readonly registry: ToolCapabilityRegistry
  readonly access: AccessResolver
  readonly parseModel: (ref: string) => { provider: string; id: string }
}

/**
 * create：冻结工具清单点名；complete：gateway ⇄ 工具子集直至 stop|maxSteps。
 * 身份非实例：不进族谱、不写语料。
 */
export function createToolAgent(spec: ToolAgentSpec, deps: ToolAgentDeps): ToolAgent {
  const named = spec.tools.map((name) => {
    const tool = deps.registry.get(name)
    return { name, tool }
  })
  for (const { name, tool } of named) {
    if (!tool) throw new Error(`tool_unresolvable: ${name}`)
  }

  async function complete(req: CompleteRequest): Promise<CompleteResult> {
    const tools: ToolDefinition[] = named.map(({ tool }) => ({
      name: tool!.name,
      description: tool!.description,
      parameters: tool!.parameters as Record<string, unknown>,
    }))
    const transcript: Message[] = [...req.messages]
    let text = ''
    let toolRounds = 0
    let usage = { inputTokens: 0, outputTokens: 0 }
    const maxSteps = spec.maxSteps ?? 8
    let finish: CompleteResult['finish'] = 'stop'

    for (let step = 0; step < maxSteps; step++) {
      const chatMessages: ChatMessage[] = transcript.map(toChatMessage)
      const request = {
        model: deps.parseModel(spec.model),
        system: spec.system,
        messages: chatMessages,
        tools,
      }
      const deltas: string[] = []
      const calls: { id: string; name: string; arguments: unknown }[] = []
      let reason: CompleteResult['finish'] = 'stop'
      let sawUsage: { inputTokens: number; outputTokens: number } | undefined

      for await (const ev of deps.gateway.chat(request, { signal: req.signal })) {
        const e = ev as LLMEvent
        if (e.type === 'text-delta') deltas.push(e.text)
        else if (e.type === 'tool-call') calls.push({ id: e.id, name: e.name, arguments: e.input })
        else if (e.type === 'usage') {
          sawUsage = { inputTokens: e.inputTokens, outputTokens: e.outputTokens }
        } else if (e.type === 'finish') reason = e.reason
      }
      if (sawUsage) {
        usage = {
          inputTokens: usage.inputTokens + sawUsage.inputTokens,
          outputTokens: usage.outputTokens + sawUsage.outputTokens,
        }
      }
      const chunk = deltas.join('')
      text += chunk
      const assistant: Message =
        calls.length > 0
          ? {
              kind: 'assistant',
              content: chunk ? [{ type: 'text', text: chunk }] : [],
              toolCalls: calls,
            }
          : { kind: 'assistant', content: [{ type: 'text', text: chunk }] }
      transcript.push(assistant)

      if (calls.length === 0) {
        finish = reason === 'length' ? 'length' : 'stop'
        break
      }
      toolRounds++
      for (const call of calls) {
        const result = await deps.registry.execute(
          'toolagent',
          call.name,
          call.arguments,
          deps.access,
          { callId: call.id, signal: req.signal },
        )
        const content =
          'content' in result
            ? (result as ToolResult).content
            : `error: ${'detail' in result ? result.detail : 'failed'}`
        transcript.push({
          kind: 'tool',
          content: [{ type: 'text', text: content }],
          toolCallId: call.id,
        })
      }
      finish = 'tool_calls'
      if (reason === 'length') {
        finish = 'length'
        break
      }
    }

    const err = validateSequence(transcript)
    return {
      text,
      messages: err ? transcript.slice(0, -1) : transcript,
      toolRounds,
      finish,
      usage,
    }
  }

  return { complete }
}

/** internal 包装：外层一条工具记录，内层非实例身份。 */
export function createInvokeTool(agent: ToolAgent) {
  return {
    name: 'invoke',
    description: 'Run a ToolAgent completion',
    kind: 'internal' as const,
    parameters: {
      type: 'object' as const,
      properties: {
        prompt: { type: 'string' as const },
      },
      required: ['prompt'],
    },
    registerAccess: 'hidden' as const,
    execute: async (input: unknown, ctx: { agentId: string; callId?: string; signal?: AbortSignal }) => {
      const prompt = (input as { prompt?: string }).prompt ?? ''
      const result = await agent.complete({
        messages: [{ kind: 'user', content: [{ type: 'text', text: prompt }] }],
        signal: ctx.signal,
      })
      return {
        kind: 'tool_ok' as const,
        content: result.text,
        data: { toolRounds: result.toolRounds, finish: result.finish },
      }
    },
  }
}
