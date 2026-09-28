// shell 宿主装配 —— 任何 shell 复用；只换 UI 与事件消费。
// extension = 对 core 的能力扩展；shell = 面向用户的延伸。

import { createSystem, restoreInstances, restoreEnvelopes, type StemSystem } from '../../src/core/boot/index.ts'
import { createMailListTool, createMailSendTool, createMailParticipantsTool, createAgentClassCreateTool, createAgentClassUpdateTool, createAgentClassListTool, createAgentInstantiateTool, createAgentUpdateTool, createAgentInspectTool, createAgentListTool, createAgentAncestryTool, createAgentDescendantsTool, createAgentTerminateTool, createContextOverviewTool, createContextExportTool, createContextRemoveTool, createContextEditTool, createContextApplyTool, createTelemetryQueryTool } from '../../src/core/tools/internal/index.ts'
import { loadAgentClassDir, writeAgentClassFile } from '../../extension/agent/index.ts'
import {
  createReadTool,
  createWriteTool,
  createEditTool,
  createGrepTool,
  createGlobTool,
  createBashTool,
  createSkillTool,
  createWebfetchTool,
  createWebsearchTool,
  loadMcpTools,
  parseMcpConfig,
} from '../../extension/tools/index.ts'
import { createToolAgent } from '../../src/core/toolagent/index.ts'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DefaultRuntime } from '../../src/core/runtime/index.ts'
import { createPilot, type Pilot } from '../../src/core/pilot/index.ts'
import type { PilotEvent } from '../../src/core/events/index.ts'
import type { TimerPort, Delivery } from '../../src/core/post/index.ts'
import type { ToolCapability, AccessResolver } from '../../src/core/tools/index.ts'
import { allowAll, ToolCapabilityRegistry } from '../../src/core/tools/index.ts'
import type { AgentID, Message } from '../../src/core/model/index.ts'
import { makeTextMessage } from '../../src/core/model/index.ts'
import { buildGateway } from './gateway.ts'
import { FakeGateway, type LLMEvent, type ModelGateway } from '../../src/core/gateway/index.ts'
import { createNodeShellRunner, type ShellRunner } from './bash.ts'
import {
  defaultDbFile,
  ensureSpace,
  loadStemConfig,
  resolveProjectRoot,
  stemDir,
  type StemConfig,
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
  /** 演示用假网关：自动调用工具并回复 */
  readonly fakeGateway?: boolean
}

export type BootResult = {
  readonly system: StemSystem
  readonly pilot: Pilot
  readonly runtime: DefaultRuntime
  readonly projectRoot: string
  readonly close: () => Promise<void>
}

/** 装载 extension 策略（core 不耦合实现）；参数来自 stem.jsonc extensions.strategy。 */
async function loadExtensionStrategies(
  projectRoot: string,
  complete: (prompt: string) => Promise<string>,
  config: StemConfig,
): Promise<import('../../src/core/post/index.ts').ContextStrategy[]> {
  const out: import('../../src/core/post/index.ts').ContextStrategy[] = []
  try {
    const mod = await import('../../extension/strategy/index.ts')
    if (typeof mod.createCortexStrategy === 'function') {
      const cortex = config.extensions?.strategy?.cortex
      out.push(
        mod.createCortexStrategy({
          homeRoot: join(stemDir(projectRoot), 'home'),
          complete,
          ...(cortex?.dreamAt !== undefined ? { dreamAt: cortex.dreamAt } : {}),
          ...(cortex?.note !== undefined ? { note: cortex.note } : {}),
          ...(cortex?.stmMax !== undefined ? { stmMax: cortex.stmMax } : {}),
          ...(cortex?.ltmMax !== undefined ? { ltmMax: cortex.ltmMax } : {}),
          ...(cortex?.recentChars !== undefined ? { recentChars: cortex.recentChars } : {}),
        }),
      )
    }
  } catch {
    // extension 策略缺省不装载
  }
  return out
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

  const { gateway: realGateway, warnings } = buildGateway(config, process.env)
  for (const w of warnings) console.warn(`[stem] ${w}`)

  // 演示假网关：按需调用已注册工具，便于无密钥观察工具轮
  let fakeRound = 0
  const demoGateway: ModelGateway = {
    async *chat() {
      fakeRound++
      const scripts: LLMEvent[][] = [
        [
          { type: 'tool-call', id: 'demo-list', name: 'agent_class_list', input: {} },
          { type: 'finish', reason: 'tool_calls' },
        ],
        [
          { type: 'tool-call', id: 'demo-bash', name: 'bash', input: { command: 'echo hello-from-bash' } },
          { type: 'finish', reason: 'tool_calls' },
        ],
        [
          {
            type: 'text-delta',
            text: '（演示网关）已调用 agent_class_list 与 bash。真实对话请配置 providers 并注入密钥，或去掉 STEM_FAKE_GATEWAY。',
          },
          { type: 'finish', reason: 'stop' },
        ],
      ]
      const events = scripts[Math.min(fakeRound - 1, scripts.length - 1)] ?? scripts[2]!
      for (const e of events) yield e
    },
  }
  const useFake = opts.fakeGateway === true || process.env.STEM_FAKE_GATEWAY === '1'
  const gateway: ModelGateway = useFake ? demoGateway : realGateway
  if (useFake) console.warn('[stem] STEM_FAKE_GATEWAY 演示模式：工具轮可观察，非真实模型')

  const stores =
    opts.stateStore === false ? undefined : createSqliteStores(defaultDbFile(opts.projectRoot))

  const timer = opts.timer ?? defaultTimer()
  const access = opts.access ?? allowAll()

  let runtime!: DefaultRuntime
  const kernelRef: { current?: import('../../src/core/kernel/index.ts').Kernel } = {}
  const agentDir = join(stemDir(opts.projectRoot), 'agent')
  const classDirs = [join(opts.projectRoot, 'extension', 'agent'), agentDir]
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

  // 整理用 ToolAgent：compact / dream 经 complete，不 spawn 实例
  const emptyRegistry = new ToolCapabilityRegistry()
  await emptyRegistry.drain([], {})
  const completePrompt = async (prompt: string): Promise<string> => {
    const agent = createToolAgent(
      { model: config.user?.model ?? 'opencode-go/deepseek-v4.1-flash', tools: [] },
      {
        gateway,
        registry: emptyRegistry,
        access,
        parseModel: (s) => {
          const i = s.indexOf('/')
          return { provider: s.slice(0, Math.max(0, i)), id: s.slice(i + 1) }
        },
      },
    )
    const r = await agent.complete({
      messages: [{ kind: 'user', content: [{ type: 'text', text: prompt }] }],
    })
    return r.text
  }

  // MCP：.stem/mcp.jsonc 点名服务器，init 连接投影
  let mcpDispose: (() => Promise<void>) | undefined
  let mcpTools: Awaited<ReturnType<typeof loadMcpTools>>['tools'] = []
  {
    const mcpFile = join(stemDir(opts.projectRoot), 'mcp.jsonc')
    if (existsSync(mcpFile)) {
      const parsed = parseMcpConfig(readFileSync(mcpFile, 'utf8'))
      if ('kind' in parsed) {
        console.warn(`[stem] mcp config: ${parsed.detail}`)
      } else {
        const loadedMcp = await loadMcpTools(parsed.mcpServers, process.env)
        for (const issue of loadedMcp.issues) console.warn(`[stem] ${issue}`)
        mcpTools = loadedMcp.tools
        mcpDispose = loadedMcp.dispose
      }
    }
  }

  const system = await createSystem({
    gateway,
    timer,
    access,
    userGenes: {
      classRef: 'user',
      description: config.user?.description,
      sysPrompt: config.user?.systemPrompt ?? 'You are the user representative.',
      model: config.user?.model,
      ctxStrategy: config.user?.contextStrategy,
      tools: config.user?.tools as never,
      sendCountdown: config.user?.sendCountdown,
      temperature: config.user?.temperature,
      effort: config.user?.effort,
      ...(config.user?.maxSteps !== undefined ? { maxSteps: config.user.maxSteps } : {}),
    },
    tools: [
      ...(opts.hostTools ?? []),
      createReadTool(),
      createWriteTool(),
      createEditTool(),
      createGrepTool(),
      createGlobTool(),
      createSkillTool({ skillsRoot: join(stemDir(opts.projectRoot), 'skills') }),
      createWebfetchTool(),
      createWebsearchTool(),
      ...(shellRunner ? [createBashTool(shellRunner)] : []),
      ...mcpTools,
    ],
    toolFactories: ({ post }) => [
      createMailSendTool({ post }),
      createMailListTool({ post }),
      createMailParticipantsTool({ post }),
      createAgentClassCreateTool({
        getKernel: () => kernelRef.current!,
        persist: (name, genes) => writeAgentClassFile(agentDir, name, genes),
      }),
      createAgentClassUpdateTool({
        getKernel: () => kernelRef.current!,
        persist: (name, genes) => writeAgentClassFile(agentDir, name, genes),
      }),
      createAgentClassListTool({
        getKernel: () => kernelRef.current!,
      }),
      createAgentInstantiateTool({ getKernel: () => kernelRef.current! }),
      createAgentUpdateTool({ getKernel: () => kernelRef.current! }),
      createAgentInspectTool({ getKernel: () => kernelRef.current! }),
      createAgentListTool({ getKernel: () => kernelRef.current! }),
      createAgentAncestryTool({ getKernel: () => kernelRef.current! }),
      createAgentDescendantsTool({ getKernel: () => kernelRef.current! }),
      createAgentTerminateTool({ getKernel: () => kernelRef.current! }),
      createContextOverviewTool({ post }),
      createContextExportTool({ post }),
      createContextRemoveTool({ post }),
      createContextEditTool({ post }),
      createContextApplyTool({ post }),
      createTelemetryQueryTool(),
    ],
    classicOptions: {
      complete: completePrompt,
      compactAt: config.classic?.window,
    },
    strategies: await loadExtensionStrategies(opts.projectRoot, completePrompt, config),
    stamp: config.stamp ?? { source: true },
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
  kernelRef.current = system.kernel

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
    modelOf: (id: AgentID) =>
      system.lineage.get(id)?.attrs.model ?? config.user?.model ?? 'opencode-go/deepseek-v4.1-flash',
    systemOf: (id: AgentID) => system.lineage.get(id)?.attrs.sysPrompt,
    maxStepsOf: (id: AgentID) => system.lineage.get(id)?.attrs.maxSteps ?? 0,
    setStatus: (id, status) => system.kernel.setStatus(id, status),
    onTurnEnd: (id, usage) => {
      const node = system.lineage.get(id)
      if (!node) return
      const input = usage?.inputTokens ?? 0
      const output = usage?.outputTokens ?? 0
      // 信箱粗估优先（随对话增长）；有 usage 时取较大者
      const est = system.post
        .boxOf(id)
        .filter((e) => e.valid)
        .reduce(
          (s, e) =>
            s +
            e.message.content.reduce(
              (n, p) => n + (p.type === 'text' ? p.text.length : 0),
              0,
            ),
          0,
        )
      const estTokens = Math.ceil(est / 4)
      const ctx = Math.max(input, estTokens)
      system.lineage.rewriteRuntime(id, {
        ...node.runtime,
        ctxTokens: ctx,
        totalTokens: node.runtime.totalTokens + (input || estTokens) + output,
        turnCount: node.runtime.turnCount + 1,
        lastActive: Date.now(),
      })
      // 水位触发整理（compact/dream）
      void system.pipeline.tick(id, 'watermark')
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
    // write-through：语料 + 实例
    const baseDeposit = system.post.deposit.bind(system.post)
    system.post.deposit = (envelope) => {
      stores.append(envelope)
      baseDeposit(envelope)
    }
    const persistInstance = (id: AgentID) => {
      const n = system.lineage.get(id)
      if (!n) return
      stores.upsert({
        id: n.id,
        attrs: n.attrs,
        runtime: n.runtime,
        tombstone: n.tombstone,
      })
    }
    const baseRewriteRuntime = system.lineage.rewriteRuntime.bind(system.lineage)
    system.lineage.rewriteRuntime = (id, runtime) => {
      const r = baseRewriteRuntime(id, runtime)
      persistInstance(id)
      return r
    }
    const baseAttach = system.lineage.attach.bind(system.lineage)
    system.lineage.attach = (id, config) => {
      const r = baseAttach(id, config)
      persistInstance(id)
      return r
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
      await mcpDispose?.()
      stores?.close()
    },
  }
}
