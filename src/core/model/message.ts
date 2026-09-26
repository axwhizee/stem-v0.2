// Message —— 只表达模型协议意义；策略/审计元数据住 Envelope。
// 合法序列由后继表约束（architecture 3.2.2）。

export type TextPart = { readonly type: 'text'; readonly text: string }
export type ImagePart = {
  readonly type: 'image'
  readonly ref: string
  readonly mime?: string
  readonly detail?: 'low' | 'high' | 'auto'
}
export type AudioPart = {
  readonly type: 'audio'
  readonly ref: string
  readonly mime?: string
  readonly durationMs?: number
}
export type VideoPart = {
  readonly type: 'video'
  readonly ref: string
  readonly mime?: string
  readonly durationMs?: number
}
export type FilePart = {
  readonly type: 'file'
  readonly ref: string
  readonly mime?: string
  readonly name?: string
}

export type ContentPart = TextPart | ImagePart | AudioPart | VideoPart | FilePart

export type ToolCall = {
  readonly id: string
  readonly name: string
  readonly arguments: unknown
}

export type MessageKind = 'system' | 'user' | 'assistant' | 'tool'

export type Message = {
  readonly kind: MessageKind
  readonly content: readonly ContentPart[]
  /** 仅 assistant；非空时 call id 组内唯一 */
  readonly toolCalls?: readonly ToolCall[]
  /** 仅 tool —— 恰好兑现一条前置 call */
  readonly toolCallId?: string
}

export type MessageIssue =
  | { readonly kind: 'message_invalid_shape'; readonly detail: string }
  | { readonly kind: 'message_illegal_successor'; readonly from: string; readonly to: MessageKind }

export function textContent(message: Message): string {
  return message.content
    .filter((p): p is TextPart => p.type === 'text')
    .map((p) => p.text)
    .join('')
}

export function hasToolCalls(message: Message): boolean {
  return (message.toolCalls?.length ?? 0) > 0
}

function shapeOk(m: Message): MessageIssue | undefined {
  if (!Array.isArray(m.content)) {
    return { kind: 'message_invalid_shape', detail: 'content must be ContentPart[]' }
  }
  if (m.kind === 'tool') {
    if (!m.toolCallId) return { kind: 'message_invalid_shape', detail: 'tool requires toolCallId' }
    if (m.toolCalls?.length) return { kind: 'message_invalid_shape', detail: 'tool must not declare toolCalls' }
    return undefined
  }
  if (m.toolCallId !== undefined) {
    return { kind: 'message_invalid_shape', detail: `${m.kind} must not carry toolCallId` }
  }
  if (m.kind === 'assistant' && m.toolCalls?.length) {
    const ids = m.toolCalls.map((c) => c.id)
    if (new Set(ids).size !== ids.length) {
      return { kind: 'message_invalid_shape', detail: 'toolCall ids must be unique' }
    }
    return undefined
  }
  if (m.toolCalls?.length) {
    return { kind: 'message_invalid_shape', detail: 'toolCalls only allowed on assistant' }
  }
  return undefined
}

type Slot = MessageKind | 'assistant+calls'

function slotOf(m: Message): Slot {
  return m.kind === 'assistant' && hasToolCalls(m) ? 'assistant+calls' : m.kind
}

function openCallIds(m: Message): string[] {
  return (m.toolCalls ?? []).map((c) => c.id)
}

/**
 * 后继表（architecture 3.2.2）：
 *   system → user
 *   user → assistant
 *   assistant（无 calls）→ user
 *   assistant（有 calls）→ 逐条配对 tool
 *   tool → 未兑现的下一 tool，或 assistant
 */
export function nextLegal(from: Message | null): readonly Slot[] {
  if (from === null) return ['system', 'user']
  switch (slotOf(from)) {
    case 'system':
      return ['user']
    case 'user':
      return ['assistant', 'assistant+calls']
    case 'assistant':
      return ['user']
    case 'assistant+calls': {
      return openCallIds(from).length > 0 ? ['tool'] : ['assistant', 'assistant+calls']
    }
    case 'tool':
      return ['assistant', 'assistant+calls', 'tool']
    default:
      return []
  }
}

export function validateSuccessor(prev: Message | null, next: Message): MessageIssue | undefined {
  const shape = shapeOk(next)
  if (shape) return shape
  const slot = slotOf(next)
  if (!nextLegal(prev).includes(slot)) {
    return { kind: 'message_illegal_successor', from: prev ? slotOf(prev) : 'start', to: next.kind }
  }
  if (next.kind === 'tool' && next.toolCallId && prev && slotOf(prev) === 'assistant+calls') {
    if (!openCallIds(prev).includes(next.toolCallId)) {
      return { kind: 'message_invalid_shape', detail: `unknown toolCallId ${next.toolCallId}` }
    }
  }
  return undefined
}

/** 校验完整前缀（写入 = 快照）。同时约束未决 call 闭合不变量。 */
export function validateSequence(messages: readonly Message[]): MessageIssue | undefined {
  let prev: Message | null = null
  let open: string[] = []
  for (const m of messages) {
    const err = validateSuccessor(prev, m)
    if (err) return err
    if (m.kind === 'tool' && m.toolCallId) {
      if (!open.includes(m.toolCallId)) {
        return { kind: 'message_invalid_shape', detail: `orphan tool result ${m.toolCallId}` }
      }
      open = open.filter((id) => id !== m.toolCallId)
    } else if (m.kind === 'assistant' && hasToolCalls(m)) {
      if (open.length > 0) {
        return { kind: 'message_invalid_shape', detail: 'assistant before pending tool calls closed' }
      }
      open = openCallIds(m)
    } else if (open.length > 0) {
      return { kind: 'message_invalid_shape', detail: 'non-tool message while tool calls pending' }
    }
    prev = m
  }
  if (open.length > 0) {
    return { kind: 'message_invalid_shape', detail: `unclosed tool calls: ${open.join(',')}` }
  }
  return undefined
}

export function makeTextMessage(kind: MessageKind, text: string): Message {
  return { kind, content: [{ type: 'text', text }] }
}
