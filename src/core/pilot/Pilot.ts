// pilot —— 以某实例身份行动的对外接口；默认 user#0。无特权，只是扮演。

import type { AgentID, Message } from '../model/index.ts'
import { ROOT_AGENT_ID } from '../model/index.ts'

export type PilotDeps = {
  /** 按被扮演实例发出用户输入 */
  readonly send: (as: AgentID, text: string) => Promise<void>
  /** 只读查询：该实例可见的最近消息 */
  readonly peek: (as: AgentID) => readonly Message[]
  readonly now?: () => number
}

export type Pilot = {
  readonly actAs: AgentID
  readonly send: (text: string) => Promise<void>
  readonly peek: () => readonly Message[]
  readonly play: (id: AgentID) => Pilot
}

/**
 * 扮演 = 使用该实例的属性/权限/语料，不是新类型。
 * shell 只经 pilot + 只读查询与事件订阅进入系统。
 */
export function createPilot(deps: PilotDeps, actAs: AgentID = ROOT_AGENT_ID): Pilot {
  return {
    actAs,
    send: (text) => deps.send(actAs, text),
    peek: () => deps.peek(actAs),
    play: (id) => createPilot(deps, id),
  }
}
