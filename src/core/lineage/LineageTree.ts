// 族谱资源面 —— 拓扑 + 属性落地 + 能力物化。无调度权、不发消息。

import {
  type AgentID,
  type EffectiveAttrs,
  type AccessState,
  type ToolAccessMap,
  type RuntimeAttrs,
  ROOT_AGENT_ID,
  canReach as idCanReach,
  compareAgentID,
  childAgentID,
  parentIdOf,
  raiseAccess,
} from '../model/index.ts'

export type NodeConfig = {
  readonly attrs: EffectiveAttrs
  /** 策略 raise：只抬不封 */
  readonly raise?: ToolAccessMap
  /** 注册声明封顶 */
  readonly registerAccess?: ToolAccessMap
}

export type LineageNode = {
  readonly id: AgentID
  readonly attrs: EffectiveAttrs
  readonly runtime: RuntimeAttrs
  readonly tombstone?: boolean
}

/** 生效访问档案：键即白名单；未显式给出的键一律 hidden。 */
export type AccessProfile = {
  readonly explicit: Readonly<Record<string, AccessState>>
}

export type LineageIssue =
  | { readonly kind: 'lineage_duplicate_id'; readonly id: AgentID }
  | { readonly kind: 'lineage_missing_node'; readonly id: AgentID }

export class LineageTree {
  readonly #nodes = new Map<AgentID, LineageNode>()
  readonly #access = new Map<AgentID, AccessProfile>()
  readonly #nextOrdinal = new Map<AgentID, number>()

  attach(id: AgentID, config: NodeConfig): LineageIssue | undefined {
    if (this.#nodes.has(id)) return { kind: 'lineage_duplicate_id', id }
    const parent = parentIdOf(id)
    if (parent !== null && !this.#nodes.has(parent)) {
      return { kind: 'lineage_missing_node', id: parent }
    }
    this.#nodes.set(id, {
      id,
      attrs: config.attrs,
      runtime: { status: 'idle', turnCount: 0, ctxTokens: 0, totalTokens: 0 },
    })
    this.#access.set(id, materializeAccess(config))
    if (parent !== null) {
      // 根之子 id 为裸序号（1,2…）；深层为 parent.n
      const ord = parent === ROOT_AGENT_ID
        ? Number(id)
        : Number(id.slice(id.lastIndexOf('.') + 1))
      const cur = this.#nextOrdinal.get(parent) ?? 1
      if (ord >= cur) this.#nextOrdinal.set(parent, ord + 1)
    }
    return undefined
  }

  /** 启动按拓扑序重放，重建能力与序号派生态。 */
  replay(entries: readonly { readonly id: AgentID; readonly config: NodeConfig }[]): readonly LineageIssue[] {
    const issues: LineageIssue[] = []
    for (const e of [...entries].sort((a, b) => compareAgentID(a.id, b.id))) {
      const err = this.attach(e.id, e.config)
      if (err) issues.push(err)
    }
    return issues
  }

  get(id: AgentID): LineageNode | undefined {
    return this.#nodes.get(id)
  }

  has(id: AgentID): boolean {
    return this.#nodes.has(id)
  }

  allIds(): readonly AgentID[] {
    return [...this.#nodes.keys()]
  }

  children(parent: AgentID): readonly AgentID[] {
    return [...this.#nodes.keys()]
      .filter((id) => !this.#nodes.get(id)?.tombstone && parentIdOf(id) === parent)
      .sort(compareAgentID)
  }

  ancestors(id: AgentID): readonly AgentID[] {
    const out: AgentID[] = []
    for (let cur = parentIdOf(id); cur !== null; cur = parentIdOf(cur)) out.push(cur)
    return out
  }

  canReach(from: AgentID, target: AgentID): boolean {
    return idCanReach(from, target)
  }

  nextChildID(parent: AgentID): AgentID {
    return childAgentID(parent, this.#nextOrdinal.get(parent) ?? 1)
  }

  profileOf(id: AgentID): AccessProfile | undefined {
    return this.#access.get(id)
  }

  effectiveAccess(id: AgentID, key: string): AccessState | undefined {
    return this.#access.get(id)?.explicit[key] ?? 'hidden'
  }

  tombstone(id: AgentID): LineageIssue | undefined {
    const n = this.#nodes.get(id)
    if (!n) return { kind: 'lineage_missing_node', id }
    this.#nodes.set(id, { ...n, tombstone: true })
    return undefined
  }

  /** 运行期属性写回（kernel 写面已预检）。 */
  rewriteAttrs(id: AgentID, attrs: EffectiveAttrs): LineageIssue | undefined {
    const n = this.#nodes.get(id)
    if (!n) return { kind: 'lineage_missing_node', id }
    this.#nodes.set(id, { ...n, attrs })
    this.#access.set(id, materializeAccess({ attrs }))
    return undefined
  }

  rewriteRuntime(id: AgentID, runtime: RuntimeAttrs): LineageIssue | undefined {
    const n = this.#nodes.get(id)
    if (!n) return { kind: 'lineage_missing_node', id }
    this.#nodes.set(id, { ...n, runtime })
    return undefined
  }
}

/**
 * 能力物化：清单键 → raise 只抬不封 → register 封顶（deny 锁死）。
 * 键即白名单：未出现的键 = hidden。
 */
function materializeAccess(config: NodeConfig): AccessProfile {
  const declared = config.attrs.tools ?? {}
  const lift = config.raise ?? {}
  const register = config.registerAccess ?? {}
  const explicit: Record<string, AccessState> = {}

  for (const key of new Set([...Object.keys(declared), ...Object.keys(lift), ...Object.keys(register)])) {
    let state = raiseAccess(declared[key] ?? 'hidden', lift[key] ?? 'hidden')
    const cap = register[key]
    if (cap === 'deny') state = 'deny'
    else if (cap === 'allow') state = raiseAccess(state, 'allow')
    explicit[key] = state
  }
  return { explicit }
}
