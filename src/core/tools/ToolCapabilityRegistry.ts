// 工具注册表 —— 发现清单 → drain（register+init 可追加）→ 冻结 → execute。

import type { AccessState } from '../model/index.ts'
import { isExecutable, isModelVisible } from '../model/index.ts'
import type {
  ExecuteIssue,
  ToolCapability,
  ToolContext,
  ToolEventSink,
  ToolInitContext,
  ToolResult,
} from './types.ts'
import { fromThrown, toolError } from './output.ts'
import { validateArgs } from './validate.ts'
import type { ToolDefinition } from '../gateway/index.ts'

export type AccessResolver = {
  readonly effective: (agentId: string, toolName: string) => AccessState | undefined
}

export class ToolCapabilityRegistry {
  readonly #tools = new Map<string, ToolCapability>()
  readonly #issues: string[] = []
  #frozen = false
  #events: ToolEventSink | undefined

  constructor(options?: { events?: ToolEventSink }) {
    this.#events = options?.events
  }

  get frozen(): boolean {
    return this.#frozen
  }

  get issues(): readonly string[] {
    return this.#issues
  }

  has(name: string): boolean {
    return this.#tools.has(name)
  }

  get(name: string): ToolCapability | undefined {
    return this.#tools.get(name)
  }

  names(): readonly string[] {
    return [...this.#tools.keys()]
  }

  /**
   * drain：无序清单逐个 register + init；init 可 registerMore。
   * 全部完成后冻结，再 register 无效。
   */
  async drain(
    seed: readonly ToolCapability[],
    initCtx: Omit<ToolInitContext, 'registerMore'>,
  ): Promise<void> {
    const queue = [...seed]
    while (queue.length > 0) {
      const tool = queue.shift()
      if (!tool) break
      if (this.#tools.has(tool.name)) {
        this.#issues.push(`duplicate tool: ${tool.name}`)
        continue
      }
      this.#tools.set(tool.name, tool)
      if (tool.init) {
        const ctx: ToolInitContext = {
          ...initCtx,
          registerMore: (t) => {
            if (this.#frozen) return
            queue.push(t)
          },
        }
        try {
          await tool.init(ctx)
        } catch (error) {
          // fail-soft：单工具 init 失败留痕，不炸启动
          this.#issues.push(
            `init failed: ${tool.name}: ${error instanceof Error ? error.message : String(error)}`,
          )
        }
      }
    }
    this.#frozen = true
    for (const tool of this.#tools.values()) {
      if (tool.dispose === undefined) continue
      // dispose 在 registry.dispose 统一调
    }
  }

  async dispose(): Promise<void> {
    for (const tool of this.#tools.values()) {
      if (!tool.dispose) continue
      try {
        await tool.dispose()
      } catch {
        // dispose 忽略
      }
    }
    this.#tools.clear()
  }

  /** 模型可见面：仅 effective allow。 */
  materialize(agentId: string, resolve: AccessResolver): ToolDefinition[] {
    const out: ToolDefinition[] = []
    for (const tool of this.#tools.values()) {
      if (!isModelVisible(resolve.effective(agentId, tool.name) ?? 'hidden')) continue
      out.push({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters as Record<string, unknown>,
      })
    }
    return out
  }

  async execute(
    agentId: string,
    name: string,
    input: unknown,
    resolve: AccessResolver,
    ctx: Omit<ToolContext, 'agentId'>,
  ): Promise<ToolResult | ExecuteIssue> {
    const tool = this.#tools.get(name)
    if (!tool) return { kind: 'tool_not_found', name }
    const state = resolve.effective(agentId, name) ?? 'hidden'
    if (!isExecutable(state)) {
      return { kind: 'tool_access_denied', name, state }
    }
    const argsError = validateArgs(tool.parameters, input)
    if (argsError) return { kind: 'tool_invalid_args', name, detail: argsError }

    const full: ToolContext = { ...ctx, agentId }
    this.#events?.emit({ phase: 'called', name, agentId, callId: ctx.callId })
    try {
      const result = await tool.execute(input, full)
      this.#events?.emit({
        phase: result.kind === 'tool_ok' ? 'success' : 'error',
        name,
        agentId,
        callId: ctx.callId,
        result,
      })
      return result
    } catch (error) {
      const result = fromThrown(error, `tool ${name} failed`)
      this.#events?.emit({
        phase: 'error',
        name,
        agentId,
        callId: ctx.callId,
        result,
        error,
      })
      return result
    }
  }
}

/** 供测试：始终 allow 的解析器。 */
export function allowAll(): AccessResolver {
  return { effective: () => 'allow' }
}

export function denyAll(): AccessResolver {
  return { effective: () => 'deny' }
}

export { toolError }
