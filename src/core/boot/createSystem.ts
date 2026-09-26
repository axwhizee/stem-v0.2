// 组合根 —— 唯一 new 与 init 序列。不持业务状态。

import { LineageTree } from '../lineage/index.ts'
import { PostOffice, type TimerPort } from '../post/index.ts'
import { ToolCapabilityRegistry, type ToolCapability, type AccessResolver } from '../tools/index.ts'
import {
  ContextPipeline,
  createClassicStrategy,
  createNoneStrategy,
  createStrategyRegistry,
  type ContextStrategy,
  type StampConfig,
} from '../context/index.ts'
import { Kernel } from '../kernel/index.ts'
import { createPilot, type Pilot } from '../pilot/index.ts'
import { EventHub } from '../events/index.ts'
import { Logger, type LogSink } from '../logging/index.ts'
import type { ModelGateway } from '../gateway/index.ts'
import type { AgentID, Message } from '../model/index.ts'
import { ROOT_AGENT_ID, makeTextMessage } from '../model/index.ts'

export type HostPorts = {
  readonly gateway: ModelGateway
  readonly timer: TimerPort
  readonly logSink?: LogSink
  readonly stamp?: StampConfig
  readonly tools?: readonly ToolCapability[]
  readonly strategies?: readonly ContextStrategy[]
  readonly access: AccessResolver
}

export type StemSystem = {
  readonly lineage: LineageTree
  readonly post: PostOffice
  readonly tools: ToolCapabilityRegistry
  readonly kernel: Kernel
  readonly pilot: Pilot
  readonly events: EventHub
  readonly pipeline: ContextPipeline
  readonly dispose: () => Promise<void>
  readonly init: { readonly issues: readonly string[] }
}

/**
 * init 序列：资源就绪 → 策略就绪 → 工具 drain → kernel → user#0。
 * kernel 在策略、工具之后构造（依赖方向）。
 */
export async function createSystem(host: HostPorts): Promise<StemSystem> {
  const log = new Logger(host.logSink)
  const events = new EventHub()
  const lineage = new LineageTree()
  const post = new PostOffice(host.timer, {
    onDelivery: (d) => {
      events.emit({ type: 'letter', agentId: d.agentId, envelopeId: d.reason, preview: d.reason })
    },
    now: () => Date.now(),
  })

  const strategies = host.strategies ?? [createClassicStrategy(), createNoneStrategy()]
  const strategyRegistry = createStrategyRegistry(strategies)
  const stamp: StampConfig = host.stamp ?? { source: true }

  const tools = new ToolCapabilityRegistry({
    events: {
      emit: (e) => events.emit({ type: 'tool', agentId: e.agentId, name: e.name, phase: e.phase }),
    },
  })

  // 策略 ownedTools 并入 seed
  const seed = [...(host.tools ?? [])]
  for (const s of strategies) {
    if (s.ownedTools) seed.push(...s.ownedTools)
  }
  await tools.drain(seed, { log: host.logSink })
  const initIssues = [...tools.issues]

  const strategyOf = (id: AgentID) => {
    const node = lineage.get(id)
    const name = node?.attrs.ctxStrategy ?? 'classic'
    return strategyRegistry.get(name) ?? createClassicStrategy()
  }

  const pipeline = new ContextPipeline({
    post,
    strategyOf,
    stamp,
  })

  const kernel = new Kernel({
    lineage,
    deliverFirst: async (id, message) => {
      const env = {
        id: `first-${id}`,
        agentId: id,
        at: Date.now(),
        valid: true,
        turn: 0,
        indexInTurn: 0,
        from: 'user' as const,
        message,
      }
      await pipeline.enter(env, 'user_prompt')
    },
    onStatus: (id, status) => events.emit({ type: 'status', agentId: id, status }),
  })

  // 根实例 user#0
  const rootIssue = kernel.registerClass({
    name: 'user',
    genes: { classRef: 'user', sysPrompt: 'You are the user representative.', tools: {} },
  })
  if (rootIssue) initIssues.push(`user class: ${rootIssue.kind}`)

  const root = await kernel.instantiate({
    className: 'user',
    userPrompt: '',
    parentId: null,
    name: 'user#0',
  })
  if (!('id' in root)) initIssues.push(`user#0: ${root.kind}`)

  const pilot = createPilot({
    send: async (as: AgentID, text: string) => {
      await pipeline.enter(
        {
          id: `u-${Date.now()}`,
          agentId: as,
          at: Date.now(),
          valid: true,
          turn: 0,
          indexInTurn: 0,
          from: 'user',
          message: makeTextMessage('user', text),
        },
        'user_prompt',
      )
    },
    peek: (as) =>
      post
        .boxOf(as)
        .filter((e) => e.valid)
        .map((e) => e.message as Message),
  })

  log.info('boot', 'stem system ready', { root: ROOT_AGENT_ID })

  return {
    lineage,
    post,
    tools,
    kernel,
    pilot,
    events,
    pipeline,
    dispose: () => tools.dispose(),
    init: { issues: initIssues },
  }
}
