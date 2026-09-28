// 上下文簇类型 —— 策略契约与管道视图。

import type { Envelope, Message, AgentID, Stamp } from '../model/index.ts'
import type { ToolCapability } from '../tools/index.ts'

export type Trigger = 'user_prompt' | 'tool' | 'manual' | 'watermark' | 'fill'

export type StampConfig = Stamp & {
  /** 投影开关；信封必采集 from */
  readonly source?: boolean
}

/** 策略只读语料视图；不拥有邮局/族谱。 */
export type CorpusView = {
  readonly agentId: AgentID
  readonly envelopes: readonly Envelope[]
  readonly ctxTokens: number
  readonly stamp: StampConfig
}

export type OrchestrateResult = {
  readonly messages: readonly Message[]
  /** 策略要求的通知原因（如水位 dream 后 ready） */
  readonly ready?: Trigger
  /** process 改写语料：作废列出的信封，并把 messages 写回为占位 */
  readonly rewrite?: {
    readonly invalidateIds: readonly string[]
  }
}

export interface ContextStrategy {
  readonly name: string
  /** 投影合法 Message 序列（必须过 3.2.2） */
  orchestrate(view: CorpusView, trigger: Trigger): OrchestrateResult
  /** 并入工具表的自有工具 */
  readonly ownedTools?: readonly ToolCapability[]
  /** system 贡献者片段 */
  readonly note?: string
  /** 异步整理（compact/dream）；绝不抛到送信链路 */
  process?(view: CorpusView, trigger: Trigger): Promise<OrchestrateResult | undefined>
}

export type StrategyRegistry = {
  readonly get: (name: string) => ContextStrategy | undefined
  readonly names: () => readonly string[]
}
