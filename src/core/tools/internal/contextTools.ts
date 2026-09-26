// 上下文观测工具 —— 只读自省 + 编辑提案（功能面）。

import type { ToolCapability } from '../../tools/types.ts'
import { toolOk, toolError } from '../../tools/output.ts'
import type { PostOffice } from '../../post/index.ts'
import type { AgentID, Message } from '../../model/index.ts'
import { makeAgentID, textContent } from '../../model/index.ts'

export type ContextToolPorts = {
  readonly post: PostOffice
  readonly snapshotOf?: (id: AgentID) => readonly Message[]
}

export function createContextOverviewTool(ports: ContextToolPorts): ToolCapability {
  return {
    name: 'context_overview',
    description: 'Overview of an agent mailbox (roles, counts, token estimates)',
    kind: 'internal',
    registerAccess: 'hidden',
    parameters: {
      type: 'object',
      properties: { agentId: { type: 'string' } },
    },
    execute: (input: unknown, ctx) => {
      const idStr = String((input as { agentId?: string })?.agentId ?? ctx.agentId)
      let id: AgentID
      try {
        id = makeAgentID(idStr)
      } catch {
        return toolError('invalid agentId', 'invalid_args')
      }
      const box = ports.post.boxOf(id)
      const byRole: Record<string, number> = {}
      let chars = 0
      for (const e of box) {
        if (!e.valid) continue
        byRole[e.message.kind] = (byRole[e.message.kind] ?? 0) + 1
        chars += textContent(e.message).length
      }
      return toolOk(JSON.stringify({ agentId: idStr, messages: box.length, byRole, chars }, null, 2))
    },
  }
}

export function createContextExportTool(ports: ContextToolPorts): ToolCapability {
  return {
    name: 'context_export',
    description: 'Export valid mailbox messages as text transcript',
    kind: 'internal',
    registerAccess: 'hidden',
    parameters: {
      type: 'object',
      properties: {
        agentId: { type: 'string' },
        limit: { type: 'number' },
      },
    },
    execute: (input: unknown, ctx) => {
      const args = (input ?? {}) as { agentId?: string; limit?: number }
      const idStr = String(args.agentId ?? ctx.agentId)
      let id: AgentID
      try {
        id = makeAgentID(idStr)
      } catch {
        return toolError('invalid agentId', 'invalid_args')
      }
      const box = ports.post.boxOf(id).filter((e) => e.valid)
      const slice = args.limit ? box.slice(-args.limit) : box
      const text = slice
        .map((e) => `[${e.message.kind}] ${textContent(e.message).slice(0, 200)}`)
        .join('\n')
      return toolOk(text || '(empty)')
    },
  }
}

export function createContextRemoveTool(ports: ContextToolPorts): ToolCapability {
  return {
    name: 'context_remove',
    description: 'Invalidate one mailbox message by id (audit-preserving)',
    kind: 'internal',
    registerAccess: 'hidden',
    parameters: {
      type: 'object',
      properties: {
        agentId: { type: 'string' },
        messageId: { type: 'string' },
      },
      required: ['messageId'],
    },
    execute: (input: unknown, ctx) => {
      const args = (input ?? {}) as { agentId?: string; messageId?: string }
      const idStr = String(args.agentId ?? ctx.agentId)
      let id: AgentID
      try {
        id = makeAgentID(idStr)
      } catch {
        return toolError('invalid agentId', 'invalid_args')
      }
      if (!args.messageId) return toolError('messageId required', 'invalid_args')
      const before = ports.post.boxOf(id).length
      ports.post.invalidate(id, args.messageId, 'context_remove')
      void before
      return toolOk(`invalidated ${args.messageId}`)
    },
  }
}

export function createContextEditTool(ports: ContextToolPorts): ToolCapability {
  return {
    name: 'context_edit',
    description: 'Rewrite text content of a message in-place (same kind)',
    kind: 'internal',
    registerAccess: 'hidden',
    parameters: {
      type: 'object',
      properties: {
        agentId: { type: 'string' },
        messageId: { type: 'string' },
        text: { type: 'string' },
      },
      required: ['messageId', 'text'],
    },
    execute: (input: unknown, ctx) => {
      const args = (input ?? {}) as { agentId?: string; messageId?: string; text?: string }
      const idStr = String(args.agentId ?? ctx.agentId)
      let id: AgentID
      try {
        id = makeAgentID(idStr)
      } catch {
        return toolError('invalid agentId', 'invalid_args')
      }
      const box = ports.post.boxOf(id)
      const target = box.find((e) => e.id === args.messageId)
      if (!target) return toolError('not found', 'not_found')
      ports.post.rewrite(id, String(args.messageId ?? ''), {
        kind: target.message.kind,
        content: [{ type: 'text', text: String(args.text ?? '') }],
        toolCalls: target.message.toolCalls,
        toolCallId: target.message.toolCallId,
      })
      return toolOk('rewritten')
    },
  }
}

export function createContextApplyTool(ports: ContextToolPorts): ToolCapability {
  return {
    name: 'context_apply',
    description: 'Append a system note into the mailbox (projection helper)',
    kind: 'internal',
    registerAccess: 'hidden',
    parameters: {
      type: 'object',
      properties: {
        agentId: { type: 'string' },
        text: { type: 'string' },
      },
      required: ['text'],
    },
    execute: (input: unknown, ctx) => {
      const args = (input ?? {}) as { agentId?: string; text?: string }
      const idStr = String(args.agentId ?? ctx.agentId)
      let id: AgentID
      try {
        id = makeAgentID(idStr)
      } catch {
        return toolError('invalid agentId', 'invalid_args')
      }
      ports.post.deposit({
        id: `ctx-apply-${Date.now()}`,
        agentId: id,
        at: Date.now(),
        valid: true,
        turn: 0,
        indexInTurn: 0,
        from: 'tool',
        message: { kind: 'user', content: [{ type: 'text', text: `[context_apply] ${String(args.text ?? '')}` }] },
      })
      return toolOk('applied')
    },
  }
}
