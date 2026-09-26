// 类生命周期工具 —— register/update/list；写面经 kernel；落盘经注入端口。

import type { ToolCapability } from '../../tools/types.ts'
import { toolOk, toolError } from '../../tools/output.ts'
import type { Kernel } from '../../kernel/Kernel.ts'
import type { ClassGenes, ToolAccessMap, EffortLevel } from '../../model/index.ts'
import { parseAccessState } from '../../model/index.ts'

export type AgentClassToolPorts = {
  /** 延迟取 kernel（boot 时工具先于 kernel 构造） */
  readonly getKernel: () => Kernel
  /** 类落盘（宿主注入；缺省只改内存） */
  readonly persist?: (name: string, genes: ClassGenes) => string
}

function parseGenes(input: Record<string, unknown>): ClassGenes {
  const toolsRaw = input.tools as Record<string, unknown> | undefined
  const tools: ToolAccessMap | undefined = toolsRaw
    ? Object.fromEntries(
        Object.entries(toolsRaw)
          .map(([k, v]) => [k, parseAccessState(v)])
          .filter((e): e is [string, 'hidden' | 'allow' | 'deny'] => e[1] !== undefined),
      )
    : undefined
  return {
    classRef: String(input.classRef ?? input.name ?? ''),
    description: input.description as string | undefined,
    sysPrompt: input.sysPrompt as string | undefined,
    ctxStrategy: input.ctxStrategy as string | undefined,
    tools,
    sendCountdown: input.sendCountdown as number | undefined,
    model: input.model as string | undefined,
    temperature: input.temperature as number | undefined,
    effort: input.effort as EffortLevel | undefined,
    maxSteps: input.maxSteps as number | undefined,
  }
}

export function createAgentClassCreateTool(ports: AgentClassToolPorts): ToolCapability {
  return {
    name: 'agent_class_create',
    description: 'Create an agent class and persist it under the stem space agent directory',
    kind: 'internal',
    registerAccess: 'hidden',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        description: { type: 'string' },
        sysPrompt: { type: 'string' },
        classRef: { type: 'string' },
        model: { type: 'string' },
        ctxStrategy: { type: 'string' },
        tools: { type: 'object' },
      },
      required: ['name', 'sysPrompt'],
    },
    execute: (input: unknown) => {
      const args = (input ?? {}) as Record<string, unknown>
      const name = String(args.name ?? '')
      if (!name) return toolError('name required', 'invalid_args')
      const genes = parseGenes({ ...args, classRef: args.classRef ?? name })
      const err = ports.getKernel().registerClass({ name, genes })
      if (err) return toolError(`${err.kind}`, err.kind)
      const file = ports.persist?.(name, genes)
      return toolOk(`class ${name} registered`, { file })
    },
  }
}

export function createAgentClassUpdateTool(ports: AgentClassToolPorts): ToolCapability {
  return {
    name: 'agent_class_update',
    description: 'Update an agent class genes (tools convergence enforced on write)',
    kind: 'internal',
    registerAccess: 'hidden',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        sysPrompt: { type: 'string' },
        model: { type: 'string' },
        tools: { type: 'object' },
      },
      required: ['name'],
    },
    execute: (input: unknown) => {
      const args = (input ?? {}) as Record<string, unknown>
      const name = String(args.name ?? '')
      const existing = ports.getKernel().classOf(name)
      if (!existing) return toolError('class_not_found', 'class_not_found')
      const genes = parseGenes({ ...existing.genes, ...args, classRef: existing.genes.classRef })
      const err = ports.getKernel().updateClassGenes(name, genes)
      if (err) return toolError(`${err.kind}`, err.kind)
      const file = ports.persist?.(name, genes)
      return toolOk(`class ${name} updated`, { file })
    },
  }
}

export function createAgentClassListTool(ports: AgentClassToolPorts): ToolCapability {
  return {
    name: 'agent_class_list',
    description: 'List registered agent class names',
    kind: 'internal',
    registerAccess: 'hidden',
    parameters: { type: 'object', properties: {} },
    execute: () => toolOk(JSON.stringify(ports.getKernel().classNames())),
  }
}
