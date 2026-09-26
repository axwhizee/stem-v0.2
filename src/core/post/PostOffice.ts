// 邮局 —— 信封收集、未决兑现、合并窗口、广播。无记忆策略、无业务组装。

import type { AgentID, Envelope, Message } from '../model/index.ts'

export type DeliveryReason = 'user_prompt' | 'tool' | 'manual' | 'watermark' | 'fill'

export type Delivery = {
  readonly agentId: AgentID
  readonly reason: DeliveryReason
  readonly envelopes: readonly Envelope[]
}

export type PendingCall = {
  readonly callId: string
  readonly owner: AgentID
  readonly tool: string
  readonly deadline?: number
}

/** 宿主定时端口：返回取消函数。 */
export type TimerPort = {
  readonly set: (ms: number, fn: () => void) => () => void
}

export type PostOfficeHooks = {
  readonly onDelivery: (delivery: Delivery) => void
  readonly now?: () => number
}

type WindowState = {
  cancelTimer: (() => void) | null
  pendingReason: DeliveryReason | null
  pendingEnvelopes: Envelope[]
}

/** 合并窗口：notifyReady → 倒计时 → onDelivery → cooling。快照为窗口内信件累积。 */
export class PostOffice {
  readonly #boxes = new Map<AgentID, Envelope[]>()
  readonly #pending = new Map<string, PendingCall>()
  readonly #windows = new Map<AgentID, WindowState>()
  readonly #countdowns = new Map<AgentID, number>()
  readonly #timer: TimerPort
  readonly #hooks: PostOfficeHooks
  #defaultCountdown = 0

  constructor(timer: TimerPort, hooks: PostOfficeHooks) {
    this.#timer = timer
    this.#hooks = hooks
  }

  setSendCountdown(agentId: AgentID, ms: number): void {
    this.#countdowns.set(agentId, ms)
  }

  setDefaultCountdown(ms: number): void {
    this.#defaultCountdown = ms
  }

  deposit(envelope: Envelope): void {
    const box = this.#boxes.get(envelope.agentId) ?? []
    box.push(envelope)
    this.#boxes.set(envelope.agentId, box)
  }

  boxOf(agentId: AgentID): readonly Envelope[] {
    return this.#boxes.get(agentId) ?? []
  }

  registerPending(call: PendingCall): void {
    this.#pending.set(call.callId, call)
  }

  pendingOf(owner: AgentID): readonly PendingCall[] {
    return [...this.#pending.values()].filter((p) => p.owner === owner)
  }

  fillPending(callId: string, result: Envelope): boolean {
    if (!this.#pending.has(callId)) return false
    this.#pending.delete(callId)
    this.deposit(result)
    return true
  }

  /** 同 kind 内容修订（context_edit）。 */
  rewrite(agentId: AgentID, envelopeId: string, message: Message): boolean {
    const box = this.#boxes.get(agentId)
    if (!box) return false
    const i = box.findIndex((e) => e.id === envelopeId)
    if (i < 0) return false
    const old = box[i]
    if (!old) return false
    box[i] = { ...old, message }
    return true
  }

  invalidate(agentId: AgentID, envelopeId: string, tag?: string): boolean {
    const box = this.#boxes.get(agentId)
    if (!box) return false
    const i = box.findIndex((e) => e.id === envelopeId)
    if (i < 0) return false
    const old = box[i]
    if (!old) return false
    box[i] = { ...old, valid: false, tag: tag ?? old.tag }
    return true
  }

  takePending(callId: string): PendingCall | undefined {
    const call = this.#pending.get(callId)
    this.#pending.delete(callId)
    return call
  }

  /** 就绪 → 合并窗口。cooling 时重置倒计时并累计信件。 */
  notifyReady(agentId: AgentID, reason: DeliveryReason, envelopes: readonly Envelope[] = []): void {
    const w: WindowState = this.#windows.get(agentId) ?? {
      cancelTimer: null,
      pendingReason: null,
      pendingEnvelopes: [],
    }
    w.pendingEnvelopes.push(...envelopes)
    w.pendingReason = reason
    w.cancelTimer?.()
    w.cancelTimer = this.#timer.set(this.#countdownOf(agentId), () => {
      w.cancelTimer = null
      const batch = w.pendingEnvelopes
      const why = w.pendingReason ?? 'manual'
      w.pendingEnvelopes = []
      w.pendingReason = null
      this.#hooks.onDelivery({ agentId, reason: why, envelopes: batch })
    })
    this.#windows.set(agentId, w)
  }

  /** 广播：对每个目标点对点入库；不替代语料点对点。 */
  broadcast(from: AgentID, targets: readonly AgentID[], message: Message, idPrefix: string): void {
    const at = this.#hooks.now?.() ?? Date.now()
    targets.forEach((to, i) => {
      this.deposit({
        id: `${idPrefix}.${i}`,
        agentId: to,
        at,
        valid: true,
        turn: 0,
        indexInTurn: i,
        from,
        message,
      })
    })
  }

  #countdownOf(agentId: AgentID): number {
    return this.#countdowns.get(agentId) ?? this.#defaultCountdown
  }
}
