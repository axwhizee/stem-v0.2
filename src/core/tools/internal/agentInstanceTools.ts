// 实例生命周期工具 —— 创建子代理、更新参数、查询族谱。

import type { ToolCapability } from '../../tools/types.ts'
import { toolOk, toolError } from '../../tools/output.ts'
import type { Kernel } from '../../kernel/Kernel.ts'
import { makeAgentID, type InstanceIncoming, type EffortLevel } from '../../model/index.ts'

export type InstanceToolPorts = {
  readonly getKernel: () => Kernel
}

export function createAgentInstantiateTool(ports: InstanceToolPorts): ToolCapability {
  return {
    name: 'agent_instantiate',
    description: 'Create a child agent instance from a registered class',
    kind: 'internal',
    registerAccess: 'hidden',
    parameters: {
      type: 'object',
      properties: {
        className: { type: 'string' },
        userPrompt: { type: 'string' },
        name: { type: 'string' },
        model: { type: 'string' },
        ctxStrategy: { type: 'string' },
      },
      required: ['className', 'userPrompt'],
    },
    execute: async (input: unknown, ctx) => {
      const args = (input ?? {}) as Record<string, unknown>
      const incoming: InstanceIncoming = {
        name: args.name as string | undefined,
        model: args.model as string | undefined,
        ctxStrategy: args.ctxStrategy as string | undefined,
      }
      const result = await ports.getKernel().instantiate({
        className: String(args.className),
        userPrompt: String(args.userPrompt ?? ''),
        parentId: makeAgentID(ctx.agentId),
        name: incoming.name,
        incoming,
      })
      if (!('id' in result) || !('attrs' in result)) return toolError(result.kind, result.kind)
      return toolOk(`created ${result.id}`, { id: result.id, name: result.attrs.name })
    },
  }
}

export function createAgentUpdateTool(ports: InstanceToolPorts): ToolCapability {
  return {
    name: 'agent_update',
    description: 'Update runtime-writable fields of an instance (name/model/temperature/effort)',
    kind: 'internal',
    registerAccess: 'hidden',
    parameters: {
      type: 'object',
      properties: {
        agentId: { type: 'string' },
        name: { type: 'string' },
        model: { type: 'string' },
        temperature: { type: 'number' },
        effort: { type: 'string' },
      },
      required: ['agentId'],
    },
    execute: (input: unknown) => {
      const args = (input ?? {}) as Record<string, unknown>
      let id
      try {
        id = makeAgentID(String(args.agentId))
      } catch {
        return toolError('invalid agentId', 'invalid_args')
      }
      const patch: Record<string, unknown> = {}
      if (args.name !== undefined) patch.name = args.name
      if (args.model !== undefined) patch.model = args.model
      if (args.temperature !== undefined) patch.temperature = args.temperature
      if (args.effort !== undefined) patch.effort = args.effort as EffortLevel
      const err = ports.getKernel().updateAgent(id, patch)
      if (err) return toolError(err.kind, err.kind)
      return toolOk(`updated ${id}`)
    },
  }
}

export function createAgentInspectTool(ports: InstanceToolPorts): ToolCapability {
  return {
    name: 'agent_inspect',
    description: 'Inspect an instance effective attributes and runtime',
    kind: 'internal',
    registerAccess: 'hidden',
    parameters: {
      type: 'object',
      properties: {
        agentId: { type: 'string' },
      },
      required: ['agentId'],
    },
    execute: (input: unknown) => {
      const args = (input ?? {}) as Record<string, unknown>
      let id
      try {
        id = makeAgentID(String(args.agentId))
      } catch {
        return toolError('invalid agentId', 'invalid_args')
      }
      try {
        const inst = ports.getKernel().require(id)
        return toolOk(JSON.stringify(inst, null, 2))
      } catch {
        return toolError('instance_not_found', 'instance_not_found')
      }
    },
  }
}

export function createAgentListTool(ports: InstanceToolPorts): ToolCapability {
  return {
    name: 'agent_list',
    description: 'List known agent instances',
    kind: 'internal',
    registerAccess: 'hidden',
    parameters: { type: 'object', properties: {} },
    execute: () => toolOk(JSON.stringify(ports.getKernel().listAgents())),
  }
}

export function createAgentAncestryTool(ports: InstanceToolPorts): ToolCapability {
  return {
    name: 'agent_ancestry',
    description: 'Ancestor chain of an instance (self → root)',
    kind: 'internal',
    registerAccess: 'hidden',
    parameters: {
      type: 'object',
      properties: { agentId: { type: 'string' } },
      required: ['agentId'],
    },
    execute: (input: unknown) => {
      let id
      try {
        id = makeAgentID(String((input as { agentId?: string })?.agentId))
      } catch {
        return toolError('invalid agentId', 'invalid_args')
      }
      return toolOk(JSON.stringify(ports.getKernel().ancestry(id)))
    },
  }
}

export function createAgentDescendantsTool(ports: InstanceToolPorts): ToolCapability {
  return {
    name: 'agent_descendants',
    description: 'Descendant ids of an instance',
    kind: 'internal',
    registerAccess: 'hidden',
    parameters: {
      type: 'object',
      properties: { agentId: { type: 'string' } },
      required: ['agentId'],
    },
    execute: (input: unknown) => {
      let id
      try {
        id = makeAgentID(String((input as { agentId?: string })?.agentId))
      } catch {
        return toolError('invalid agentId', 'invalid_args')
      }
      return toolOk(JSON.stringify(ports.getKernel().descendants(id)))
    },
  }
}

export function createAgentTerminateTool(ports: InstanceToolPorts): ToolCapability {
  return {
    name: 'agent_terminate',
    description: 'Terminate an instance (tombstone; id reserved)',
    kind: 'internal',
    registerAccess: 'hidden',
    parameters: {
      type: 'object',
      properties: {
        agentId: { type: 'string' },
        recursive: { type: 'boolean' },
      },
      required: ['agentId'],
    },
    execute: (input: unknown) => {
      const args = (input ?? {}) as { agentId?: string; recursive?: boolean }
      let id
      try {
        id = makeAgentID(String(args.agentId))
      } catch {
        return toolError('invalid agentId', 'invalid_args')
      }
      const err = ports.getKernel().terminate(id, args.recursive === true)
      if (err) return toolError(err.kind, err.kind)
      return toolOk(`terminated ${id}`)
    },
  }
}
