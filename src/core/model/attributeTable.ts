// AttributeTable —— 类/实例属性纯代数（architecture 3.1.1）。
// 收敛链：父生效 → 类基因 → 实例化入参 → 节点落地表。
// 解析序：实例显式 > 类 > 父。改父不级联子。

import type { AgentID } from './id.ts'
import type { AccessState } from './access.ts'

export type EffortLevel = 'none' | 'low' | 'medium' | 'high'

/** 工具权限映射：键 = 工具名；未设 = 继承父生效档案。 */
export type ToolAccessMap = Readonly<Record<string, AccessState>>

export type ClassGenes = {
  readonly classRef: string
  readonly description?: string
  readonly sysPrompt?: string
  readonly ctxStrategy?: string
  readonly tools?: ToolAccessMap
  readonly sendCountdown?: number
  readonly model?: string
  readonly temperature?: number
  readonly effort?: EffortLevel
  readonly maxSteps?: number
}

export type InstanceIncoming = {
  readonly name?: string
  readonly ctxStrategy?: string
  readonly tools?: ToolAccessMap
  readonly sendCountdown?: number
  readonly model?: string
  readonly temperature?: number
  readonly effort?: EffortLevel
  readonly maxSteps?: number
}

export type EffectiveAttrs = {
  readonly id: AgentID
  readonly name?: string
  readonly classRef: string
  readonly description?: string
  readonly sysPrompt?: string
  readonly ctxStrategy: string
  readonly tools: ToolAccessMap
  readonly sendCountdown: number
  readonly model?: string
  readonly temperature?: number
  readonly effort?: EffortLevel
  readonly maxSteps: number
}

/** 运行时/账目字段 —— 系统写，不参与继承收敛。 */
export type RuntimeAttrs = {
  readonly status: 'idle' | 'thinking' | 'tooling' | 'interrupted' | 'holding'
  readonly turnCount: number
  readonly ctxTokens: number
  readonly totalTokens: number
  readonly lastActive?: number
}

export type AttrIssue =
  | { readonly kind: 'attr_invalid'; readonly field: string; readonly detail: string }
  | { readonly kind: 'attr_write_forbidden'; readonly field: string }

/** 运行期唯一写通道允许的字段（kernel.updateAgent）。 */
export const RUNTIME_WRITABLE = ['name', 'model', 'temperature', 'effort'] as const
export type RuntimeWritable = (typeof RUNTIME_WRITABLE)[number]

const isEffort = (v: unknown): v is EffortLevel =>
  v === 'none' || v === 'low' || v === 'medium' || v === 'high'

export function validateGenes(genes: ClassGenes): readonly AttrIssue[] {
  const issues: AttrIssue[] = []
  if (!genes.classRef) issues.push({ kind: 'attr_invalid', field: 'classRef', detail: 'required' })
  if (genes.temperature !== undefined && (genes.temperature < 0 || genes.temperature > 2)) {
    issues.push({ kind: 'attr_invalid', field: 'temperature', detail: '0..2' })
  }
  if (genes.effort !== undefined && !isEffort(genes.effort)) {
    issues.push({ kind: 'attr_invalid', field: 'effort', detail: 'none|low|medium|high' })
  }
  if (genes.sendCountdown !== undefined && genes.sendCountdown < 0) {
    issues.push({ kind: 'attr_invalid', field: 'sendCountdown', detail: '>=0' })
  }
  if (genes.maxSteps !== undefined && genes.maxSteps < 0) {
    issues.push({ kind: 'attr_invalid', field: 'maxSteps', detail: '>=0' })
  }
  return issues
}

/** 严格父子继承：子未填则用父生效值。 */
export function inherit(parent: EffectiveAttrs, id: AgentID): EffectiveAttrs {
  return { ...parent, id, name: undefined }
}

/** 收敛①：类基因覆盖继承默认（类显式值优先）。 */
export function applyClass(base: EffectiveAttrs, genes: ClassGenes): EffectiveAttrs {
  return {
    ...base,
    classRef: genes.classRef,
    description: genes.description ?? base.description,
    sysPrompt: genes.sysPrompt ?? base.sysPrompt,
    ctxStrategy: genes.ctxStrategy ?? base.ctxStrategy,
    tools: genes.tools ?? base.tools,
    sendCountdown: genes.sendCountdown ?? base.sendCountdown,
    model: genes.model ?? base.model,
    temperature: genes.temperature ?? base.temperature,
    effort: genes.effort ?? base.effort,
    maxSteps: genes.maxSteps ?? base.maxSteps,
  }
}

/** 收敛②：实例化入参最优先。 */
export function applyInstance(base: EffectiveAttrs, incoming: InstanceIncoming): EffectiveAttrs {
  return {
    ...base,
    name: incoming.name ?? base.name,
    ctxStrategy: incoming.ctxStrategy ?? base.ctxStrategy,
    tools: incoming.tools ?? base.tools,
    sendCountdown: incoming.sendCountdown ?? base.sendCountdown,
    model: incoming.model ?? base.model,
    temperature: incoming.temperature ?? base.temperature,
    effort: incoming.effort ?? base.effort,
    maxSteps: incoming.maxSteps ?? base.maxSteps,
  }
}

/** 写面预检：出生即定字段与非写面字段一律拒绝。 */
export function canWrite(patch: Partial<Record<keyof EffectiveAttrs, unknown>>): readonly AttrIssue[] {
  const issues: AttrIssue[] = []
  for (const key of Object.keys(patch) as (keyof EffectiveAttrs)[]) {
    if (!(RUNTIME_WRITABLE as readonly string[]).includes(key)) {
      issues.push({ kind: 'attr_write_forbidden', field: key })
    }
  }
  return issues
}

export function effective(table: EffectiveAttrs): EffectiveAttrs {
  return { ...table }
}

/** 根实例落地：与任意实例同路径，无特权。 */
export function rootEffective(genes: ClassGenes, name?: string): EffectiveAttrs {
  const base: EffectiveAttrs = {
    id: '0' as AgentID,
    name: undefined,
    classRef: genes.classRef,
    description: genes.description,
    sysPrompt: genes.sysPrompt,
    ctxStrategy: genes.ctxStrategy ?? 'classic',
    tools: genes.tools ?? {},
    sendCountdown: genes.sendCountdown ?? 0,
    model: genes.model,
    temperature: genes.temperature,
    effort: genes.effort,
    maxSteps: genes.maxSteps ?? 0,
  }
  return applyInstance(applyClass(base, genes), { name })
}
