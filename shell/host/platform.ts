// shell 宿主装配 —— 任何 shell 复用；只换 UI 与事件消费。
// extension = 对 core 的能力扩展；shell = 面向用户的延伸。

import { createSystem, restoreInstances, restoreEnvelopes, type StemSystem } from '../../src/core/boot/index.ts'
import { createMailListTool, createMailSendTool } from '../../src/core/tools/internal/index.ts'
import { loadAgentClassDir } from '../../extension/agent/index.ts'
import { createCortexStrategy } from '../../extension/strategy/index.ts'
import { createReadTool } from '../../extension/tools/read.ts'
import { createBashTool } from '../../extension/tools/bash.ts'
import { createClassicStrategy, createNoneStrategy } from '../../src/core/context/index.ts'
import { join } from 'node:path'
import { DefaultRuntime } from '../../src/core/runtime/index.ts'
import { createPilot, type Pilot } from '../../src/core/pilot/index.ts'
import type { PilotEvent } from '../../src/core/events/index.ts'
import type { TimerPort, Delivery } from '../../src/core/post/index.ts'
import type { ToolCapability, AccessResolver } from '../../src/core/tools/index.ts'
import { allowAll } from '../../src/core/tools/index.ts'
import type { AgentID, Message } from '../../src/core/model/index.ts'
import { makeTextMessage } from '../../src/core/model/index.ts'
import { buildGateway } from './gateway.ts'
import { createNodeShellRunner, type ShellRunner } from './bash.ts'
import {
  defaultDbFile,
  ensureSpace,
  loadStemConfig,
  resolveProjectRoot,
  stemDir,
} from './config.ts'
import { createSqliteStores } from './store.ts'

export { resolveProjectRoot }

export type BootOptions = {
  readonly projectRoot: string
  readonly onEvent?: (event: PilotEvent) => void
  readonly hostTools?: readonly ToolCapability[]
  readonly access?: AccessResolver
  /** false = 纯内存 */
  readonly stateStore?: boolean
  readonly shellRunner?: ShellRunner | false
  readonly timer?: TimerPort
}

export type BootResult = {
  readonly system: StemSystem
  readonly pilot: Pilot
  readonly runtime: DefaultRuntime
  readonly projectRoot: string
  readonly close: () => Promise<void>
}

function defaultTimer(): TimerPort {
  return {
    set(ms, fn) {
      const t = setTimeout(fn, ms)
      return () => clearTimeout(t)
    },
  }
}

/** 读配置 → 网关路由 → createSystem → Runtime 接线 → user#0。 */
export async function bootStem(opts: BootOptions): Promise<BootResult> {
  ensureSpace(opts.projectRoot)
  const loaded = loadStemConfig(opts.projectRoot)
  if ('kind' in loaded) throw new Error(`config: ${loaded.detail}`)
  const config = loaded

  const { gateway, warnings } = buildGateway(config, process.env)
  for (const w of warnings) console.warn(`[stem] ${w}`)

  const stores =
    opts.stateStore === false ? undefined : createSqliteStores(defaultDbFile(opts.projectRoot))

  const timer = opts.timer ?? defaultTimer()
  const access = opts.access ?? allowAll()

  let runtime!: DefaultRuntime

  // 类目录真相：extension/agent + .stem/agent
  const classDirs = [join(opts.projectRoot, 'extension', 'agent'), join(stemDir(opts.projectRoot), 'agent')]
  const classIssues: string[] = []
  const extraClasses: { name: string; genes: import('../../src/core/model/index.ts').ClassGenes }[] = []
  for (const dir of classDirs) {
    const { classes, issues } = loadAgentClassDir(dir)
    for (const i of issues) classIssues.push(`${i.file}: ${i.detail}`)
    for (const c of classes) extraClasses.push({ name: c.name, genes: c.genes })
  }

  const shellRunner =
    opts.shellRunner === false
      ? undefined
      : (opts.shellRunner ?? createNodeShellRunner({ defaultCwd: opts.projectRoot }))

  const system = await createSystem({
    gateway,
    timer,
    access,
    tools: [
      ...(opts.hostTools ?? []),
      createReadTool(),
      ...(shellRunner ? [createBashTool(shellRunner)] : []),
    ],
    toolFactories: ({ post }) => [
      createMailSendTool({ post }),
      createMailListTool({ post }),
    ],
    strategies: [
      createClassicStrategy(),
      createNoneStrategy(),
      createCortexStrategy({ homeRoot: join(stemDir(opts.projectRoot), 'home') }),
    ],
    stamp: config.context?.stamp ?? { source: true },
    logSink: {
      write: (e) => {
        if (e.level === 'error' || e.level === 'warn') {
          opts.onEvent?.({ type: 'error', message: `${e.scope}: ${e.message}` })
        }
      },
    },
    onDelivery: (d: Delivery) => {
      void runtime.processDelivery(d)
    },
  })

  runtime = new DefaultRuntime({
    gateway,
    tools: system.tools,
    access,
    post: system.post,
    events: system.events,
    snapshotOf: (id) => system.pipeline.snapshot(id),
    materializeTools: (id) => system.tools.materialize(id, access),
    parseModel: (s) => {
      const i = s.indexOf('/')
      return { provider: s.slice(0, Math.max(0, i)), id: s.slice(i + 1) }
    },
    modelOf: (id: AgentID) => system.lineage.get(id)?.attrs.model ?? config.user.model,
    systemOf: (id: AgentID) => system.lineage.get(id)?.attrs.sysPrompt,
    maxStepsOf: (id: AgentID) => system.lineage.get(id)?.attrs.maxSteps ?? 0,
    setStatus: (id, status) => system.kernel.setStatus(id, status),
    onTurnEnd: (id, usage) => {
      const node = system.lineage.get(id)
      if (!node) return
      system.lineage.rewriteRuntime(id, {
        ...node.runtime,
        totalTokens:
          node.runtime.totalTokens + (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0),
        turnCount: node.runtime.turnCount + 1,
      })
    },
  })

  if (opts.onEvent) system.events.on(opts.onEvent)

  for (const i of classIssues) console.warn(`[stem] class: ${i}`)
  for (const c of extraClasses) {
    const err = system.kernel.registerClass({ name: c.name, genes: c.genes })
    if (err) console.warn(`[stem] class ${c.name}: ${err.kind}`)
  }

  // 恢复：实例拓扑序重放 + 语料载箱
  if (stores) {
    const restored = restoreInstances(stores, system.lineage)
    for (const i of restored.issues) console.warn(`[stem] restore: ${i}`)
    const ids = stores.loadAll().map((r) => r.id)
    const envs = restoreEnvelopes(stores, system.post, ids)
    if (envs > 0 || restored.instances > 0) {
      console.log(`[stem] restored ${restored.instances} instances, ${envs} envelopes`)
    }
    // write-through
    const baseDeposit = system.post.deposit.bind(system.post)
    system.post.deposit = (envelope) => {
      stores.append(envelope)
      baseDeposit(envelope)
    }
  }

  const pilot = createPilot({
    send: async (as, text) => {
      await system.pipeline.enter(
        {
          id: `u-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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
      system.post
        .boxOf(as)
        .filter((e) => e.valid)
        .map((e) => e.message as Message),
  })

  return {
    system: { ...system, pilot },
    pilot,
    runtime,
    projectRoot: opts.projectRoot,
    close: async () => {
      await system.dispose()
      stores?.close()
    },
  }
}
