// kernel 领域类型 —— 类/实例/错误联合。

import type {
  AgentID,
  ClassGenes,
  EffectiveAttrs,
  InstanceIncoming,
  RuntimeAttrs,
  ToolAccessMap,
} from '../model/index.ts'

export type AgentClass = {
  readonly name: string
  readonly genes: ClassGenes
}

export type AgentInstance = {
  readonly id: AgentID
  readonly attrs: EffectiveAttrs
  readonly runtime: RuntimeAttrs
  readonly tombstone?: boolean
}

export type InstantiateOptions = {
  readonly className: string
  readonly userPrompt: string
  readonly parentId?: AgentID | null
  readonly name?: string
  readonly incoming?: InstanceIncoming
  readonly raise?: ToolAccessMap
}

export type KernelIssue =
  | { readonly kind: 'class_not_found'; readonly className: string }
  | { readonly kind: 'attr_invalid'; readonly field: string; readonly detail: string }
  | { readonly kind: 'attr_write_forbidden'; readonly field: string }
  | { readonly kind: 'lineage_duplicate_id'; readonly id: AgentID }
  | { readonly kind: 'lineage_missing_node'; readonly id: AgentID }
  | { readonly kind: 'instance_not_found'; readonly id: AgentID }
  | { readonly kind: 'name_taken'; readonly name: string }
  | { readonly kind: 'instantiate_failed'; readonly detail: string }

export function isKernelIssue(value: unknown): value is KernelIssue {
  return typeof value === 'object' && value !== null && 'kind' in value
}
