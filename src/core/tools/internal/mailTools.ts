// internal 邮件工具 —— 跨 agent 回信经邮局配对兑现。

import type { ToolCapability } from '../types.ts'
import { toolOk, toolError } from '../output.ts'
import type { PostOffice } from '../../post/index.ts'
import type { AgentID, Message } from '../../model/index.ts'
import { canReach, makeAgentID, validateSuccessor } from '../../model/index.ts'

export type MailPorts = {
  readonly post: PostOffice
  readonly canReach?: (from: AgentID, target: AgentID) => boolean
}

/** mail_send：点对点寄信；目标须在辖区内。 */
export function createMailSendTool(ports: MailPorts): ToolCapability {
  return {
    name: 'mail_send',
    description: 'Send a letter to another agent in your lineage scope',
    kind: 'internal',
    registerAccess: 'hidden',
    parameters: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'target agent id' },
        text: { type: 'string' },
      },
      required: ['to', 'text'],
    },
    execute: (input: unknown, ctx) => {
      const args = input as { to?: string; text?: string }
      if (!args.to || !args.text) return toolError('to and text required', 'invalid_args')
      let target: AgentID
      try {
        target = makeAgentID(args.to)
      } catch {
        return toolError(`invalid agent id: ${args.to}`, 'invalid_args')
      }
      const from = makeAgentID(ctx.agentId)
      const reach = ports.canReach ?? canReach
      if (!reach(from, target) && !reach(target, from)) {
        // 允许子寄父（回信）与父寄子；兄弟不可
        return toolError('target not in reach', 'access_denied')
      }
      const message: Message = {
        kind: 'user',
        content: [{ type: 'text', text: args.text }],
      }
      const prev = ports.post.boxOf(target).at(-1)?.message ?? null
      const err = validateSuccessor(prev, message)
      // 宽松：来信作为新 user 段允许（投递由策略整理）
      void err
      ports.post.deposit({
        id: `mail-${ctx.callId ?? Date.now()}`,
        agentId: target,
        at: Date.now(),
        valid: true,
        turn: 0,
        indexInTurn: 0,
        from,
        message,
      })
      ports.post.notifyReady(target, 'user_prompt', [])
      return toolOk(`sent to ${target}`)
    },
  }
}

/** mail_list：查看自己信箱摘要。 */
export function createMailListTool(ports: MailPorts): ToolCapability {
  return {
    name: 'mail_list',
    description: 'List recent letters in your mailbox',
    kind: 'internal',
    registerAccess: 'hidden',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number' },
      },
    },
    execute: (input: unknown, ctx) => {
      const limit = (input as { limit?: number }).limit ?? 10
      const box = ports.post.boxOf(makeAgentID(ctx.agentId))
      const recent = box.slice(-limit).map((e) => ({
        id: e.id,
        from: e.from,
        at: e.at,
        valid: e.valid,
        preview: e.message.content
          .map((p) => (p.type === 'text' ? p.text : `[${p.type}]`))
          .join('')
          .slice(0, 80),
      }))
      return toolOk(JSON.stringify(recent, null, 2), { count: box.length })
    },
  }
}

/** mail_participants：已通信的 from/to 摘要。 */
export function createMailParticipantsTool(ports: MailPorts): ToolCapability {
  return {
    name: 'mail_participants',
    description: 'List distinct correspondents seen in mailboxes',
    kind: 'internal',
    registerAccess: 'hidden',
    parameters: { type: 'object', properties: {} },
    execute: (_input: unknown, ctx) => {
      const box = ports.post.boxOf(makeAgentID(ctx.agentId))
      const set = new Set<string>()
      for (const e of box) {
        if (e.from !== undefined) set.add(String(e.from))
      }
      return toolOk(JSON.stringify([...set]))
    },
  }
}
