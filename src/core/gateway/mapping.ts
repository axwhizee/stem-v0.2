// Message → 网关协议（单向）。策略/审计字段不进入协议。

import type { Message, ContentPart } from '../model/index.ts'
import type { ChatMessage, ProtocolContentPart, ToolCall } from './types.ts'

export function toProtocolContent(parts: readonly ContentPart[]): ProtocolContentPart[] {
  const out: ProtocolContentPart[] = []
  for (const p of parts) {
    if (p.type === 'text') out.push({ type: 'text', text: p.text })
    else if (p.type === 'image') {
      out.push({ type: 'image', url: p.ref, mime: p.mime, detail: p.detail })
    }
    // 其它模态暂由宿主预投影为文本占位后再送网关
  }
  return out
}

export function toChatMessage(message: Message): ChatMessage {
  const content = toProtocolContent(message.content)
  const calls: ToolCall[] | undefined = message.toolCalls?.map((c) => ({
    id: c.id,
    name: c.name,
    arguments: typeof c.arguments === 'string' ? c.arguments : JSON.stringify(c.arguments ?? {}),
  }))
  return {
    role: message.kind,
    content,
    toolCalls: calls,
    toolCallId: message.toolCallId,
  }
}
