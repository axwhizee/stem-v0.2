// 上下文管道 —— 预处理 → 入库 → 策略编排 → 通知邮局。
// 不仲裁族谱、不实现工具；策略经契约调用。

import {
  validateSequence,
  validateSuccessor,
  type AgentID,
  type Envelope,
  type Message,
} from '../model/index.ts'
import type { PostOffice, DeliveryReason } from './PostOffice.ts'
import type { ContextStrategy, StampConfig, Trigger } from './types.ts'
import { collectStamp, projectMessages } from './stamp.ts'

export type PipelineHooks = {
  readonly post: PostOffice
  readonly strategyOf: (agentId: AgentID) => ContextStrategy
  readonly stamp: StampConfig
  readonly now?: () => number
  /** 上下文占用（反馈账）；缺省 0 */
  readonly ctxTokensOf?: (agentId: AgentID) => number
  /** 调用策略 process（compact/dream）；返回新投影 */
  readonly runProcess?: (
    agentId: AgentID,
    strategy: ContextStrategy,
    trigger: Trigger,
  ) => Promise<void>
}

export type EnterIssue =
  | { readonly kind: 'envelope_invalid_message'; readonly detail: string }

export class ContextPipeline {
  readonly #hooks: PipelineHooks

  constructor(hooks: PipelineHooks) {
    this.#hooks = hooks
  }

  /**
   * 进入管道：代数校验 → 打戳 → 入库 → 策略编排（none 跳过）→ notifyReady。
   */
  async enter(envelope: Envelope, trigger: Trigger): Promise<EnterIssue | undefined> {
    const check = validateSuccessor(null, envelope.message)
    if (check && check.kind === 'message_invalid_shape' && check.detail.includes('toolCallId')) {
      return { kind: 'envelope_invalid_message', detail: check.detail }
    }

    const at = this.#hooks.now?.() ?? Date.now()
    const stamped = collectStamp(envelope, this.#hooks.stamp, at)
    this.#hooks.post.deposit(stamped)

    const strategy = this.#hooks.strategyOf(stamped.agentId)
    if (strategy.name !== 'none' && strategy.process) {
      await this.#hooks.runProcess?.(stamped.agentId, strategy, trigger)
    }

    this.#hooks.post.notifyReady(stamped.agentId, trigger as DeliveryReason, [stamped])
    return undefined
  }

  /** 投影当前语料；none 跳过策略编排，直接基线投影。 */
  snapshot(agentId: AgentID): readonly Message[] {
    const strategy = this.#hooks.strategyOf(agentId)
    const envelopes = this.#hooks.post.boxOf(agentId)
    const view = {
      agentId,
      envelopes,
      ctxTokens: this.#hooks.ctxTokensOf?.(agentId) ?? 0,
      stamp: this.#hooks.stamp,
    }
    const messages =
      strategy.name === 'none'
        ? projectMessages(envelopes, this.#hooks.stamp)
        : strategy.orchestrate(view, 'manual').messages
    return validateSequence(messages) ? [] : messages
  }

  /** 水位/手动触发策略整理（compact/dream），不投递新信。 */
  async tick(agentId: AgentID, trigger: Trigger = 'watermark'): Promise<void> {
    const strategy = this.#hooks.strategyOf(agentId)
    if (strategy.process) {
      await this.#hooks.runProcess?.(agentId, strategy, trigger)
    }
  }

  /** 作废后重投影。 */
  invalidateAndReproject(agentId: AgentID, envelope: Envelope, tag?: string): readonly Message[] {
    const box = this.#hooks.post.boxOf(agentId)
    const updated = box.map((e) =>
      e.id === envelope.id ? { ...e, valid: false, tag: tag ?? e.tag } : e,
    )
    // 邮局箱为追加模型；重投影基于更新视图
    return projectMessages(updated, this.#hooks.stamp)
  }
}
