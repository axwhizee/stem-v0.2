// Envelope —— Message 的持久化/审计外罩。
// Message 只承载模型协议意义；tag/valid/turn/from/stamp 住这里（architecture 3.3）。

import type { Message } from './message.ts'
import type { AgentID } from './id.ts'

export type Stamp = {
  readonly timestamp?: boolean
  readonly delay?: boolean
  readonly tokens?: boolean
}

export type Envelope = {
  readonly id: string
  readonly agentId: AgentID
  readonly at: number
  readonly tokens?: number
  readonly valid: boolean
  readonly tag?: string
  readonly turn: number
  readonly indexInTurn: number
  /** 来源必采集 */
  readonly from?: AgentID | 'user' | 'system' | 'tool'
  readonly stamp?: Stamp
  readonly message: Message
}

/** 作废不改 Message，只落信封（可审计）。 */
export function invalidate(envelope: Envelope, tag?: string): Envelope {
  return { ...envelope, valid: false, tag: tag ?? envelope.tag }
}

export function isValid(envelope: Envelope): boolean {
  return envelope.valid
}
