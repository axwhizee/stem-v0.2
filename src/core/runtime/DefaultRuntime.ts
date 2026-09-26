// Runtime —— 送信驱动的单轮循环。被动：由邮局投递唤醒。

import {
  validateSequence,
  type AgentID,
  type Message,
  type ToolCall,
} from '../model/index.ts'
import type { ModelGateway, ChatMessage, LLMEvent, ToolDefinition } from '../gateway/index.ts'
import { toChatMessage } from '../gateway/index.ts'
import type { ToolCapabilityRegistry, AccessResolver, ToolResult } from '../tools/index.ts'
import type { PostOffice, Delivery } from '../post/index.ts'
import type { EventHub } from '../events/index.ts'
import { fromThrown } from '../tools/index.ts'

export type RuntimePorts = {
  readonly gateway: ModelGateway
  readonly tools: ToolCapabilityRegistry
  readonly access: AccessResolver
  readonly post: PostOffice
  readonly events: EventHub
  readonly snapshotOf: (id: AgentID) => readonly Message[]
  readonly materializeTools: (id: AgentID) => ToolDefinition[]
  readonly parseModel: (ref: string) => { provider: string; id: string }
  readonly modelOf: (id: AgentID) => string
  readonly systemOf: (id: AgentID) => string | undefined
  readonly maxStepsOf: (id: AgentID) => number
  readonly onTurnEnd?: (id: AgentID, usage?: { inputTokens: number; outputTokens: number }) => void
  readonly setStatus?: (id: AgentID, status: 'idle' | 'thinking' | 'tooling' | 'interrupted' | 'holding') => void
}

export class DefaultRuntime {
  readonly #ports: RuntimePorts
  readonly #aborts = new Map<AgentID, AbortController>()

  constructor(ports: RuntimePorts) {
    this.#ports = ports
  }

  /** 投递入口：合并窗口 onDelivery 应调到这里。 */
  async processDelivery(delivery: Delivery): Promise<void> {
    const id = delivery.agentId
    this.#ports.setStatus?.(id, 'thinking')
    const ctl = new AbortController()
    this.#aborts.set(id, ctl)
    try {
      await this.#runTurn(id, ctl.signal)
    } finally {
      this.#aborts.delete(id)
      this.#ports.setStatus?.(id, 'idle')
    }
  }

  interrupt(id: AgentID): void {
    this.#aborts.get(id)?.abort()
    this.#ports.setStatus?.(id, 'interrupted')
  }

  async #runTurn(id: AgentID, signal: AbortSignal): Promise<void> {
    const maxSteps = this.#ports.maxStepsOf(id)
    for (let step = 0; step < (maxSteps > 0 ? maxSteps : 8); step++) {
      if (signal.aborted) break
      const messages = this.#ports.snapshotOf(id)
      const err = validateSequence(messages)
      if (err) return
      const tools = this.#ports.materializeTools(id)
      const request = {
        model: this.#ports.parseModel(this.#ports.modelOf(id)),
        system: this.#ports.systemOf(id),
        messages: messages.map(toChatMessage) as ChatMessage[],
        tools: tools.length ? tools : undefined,
      }

      const textParts: string[] = []
      const calls: ToolCall[] = []
      let finishReason: 'stop' | 'tool_calls' | 'length' = 'stop'
      let usage: { inputTokens: number; outputTokens: number } | undefined

      try {
        for await (const raw of this.#ports.gateway.chat(request, { signal })) {
          const ev = raw as LLMEvent
          if (ev.type === 'text-delta') {
            textParts.push(ev.text)
            this.#ports.events.emit({ type: 'stream', agentId: id, event: ev })
          } else if (ev.type === 'tool-call') {
            calls.push({ id: ev.id, name: ev.name, arguments: ev.input })
            this.#ports.events.emit({ type: 'stream', agentId: id, event: ev })
          } else if (ev.type === 'usage') {
            usage = { inputTokens: ev.inputTokens, outputTokens: ev.outputTokens }
            this.#ports.events.emit({ type: 'stream', agentId: id, event: ev })
          } else if (ev.type === 'finish') {
            finishReason = ev.reason
            this.#ports.events.emit({ type: 'stream', agentId: id, event: ev })
          } else if (ev.type === 'reasoning-delta') {
            this.#ports.events.emit({ type: 'stream', agentId: id, event: ev })
          }
        }
      } catch (error) {
        this.#ports.events.emit({
          type: 'error',
          agentId: id,
          message: error instanceof Error ? error.message : String(error),
        })
        this.#halt(id, textParts.join('') || '(interrupted)')
        return
      }

      const text = textParts.join('')
      const assistant: Message =
        calls.length > 0
          ? {
              kind: 'assistant',
              content: text ? [{ type: 'text', text }] : [],
              toolCalls: calls,
            }
          : { kind: 'assistant', content: [{ type: 'text', text }] }
      this.#writeBack(id, assistant)

      if (calls.length === 0) {
        this.#ports.onTurnEnd?.(id, usage)
        return
      }

      this.#ports.setStatus?.(id, 'tooling')
      await Promise.all(
        calls.map(async (call) => {
          const result = await this.#ports.tools.execute(
            id,
            call.name,
            call.arguments,
            this.#ports.access,
            { callId: call.id, signal },
          )
          const content =
            'content' in result
              ? (result as ToolResult).content
              : fromThrown(result, 'tool failed').content
          this.#writeBack(id, {
            kind: 'tool',
            content: [{ type: 'text', text: content }],
            toolCallId: call.id,
          })
        }),
      )
      this.#ports.setStatus?.(id, 'thinking')

      if (finishReason === 'length' || signal.aborted) {
        this.#ports.onTurnEnd?.(id, usage)
        return
      }
    }
    this.#ports.setStatus?.(id, 'holding')
  }

  /** 中止/出错：合成合法收束，不把未闭合槽位留给下一轮。 */
  #halt(id: AgentID, text: string): void {
    this.#writeBack(id, { kind: 'assistant', content: [{ type: 'text', text }] })
  }

  /** 自身写回只入库，不自动重投递（防自激）。 */
  #writeBack(id: AgentID, message: Message): void {
    this.#ports.post.deposit({
      id: `rt-${id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      agentId: id,
      at: Date.now(),
      valid: true,
      turn: 0,
      indexInTurn: 0,
      from: id,
      message,
    })
  }
}
