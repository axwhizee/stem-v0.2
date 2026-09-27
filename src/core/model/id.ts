// id —— 出生路径 AgentID。根 `0` 是拓扑原点，不是特权码。
// 根之子 = `1` `2`…（user#0 实例化顺序）；更深层 = `<父>.<序号>`。
// 父 id 纯推导（parentIdOf），不冗余存储；销毁后 id 仍保留。

export type AgentID = string & { readonly __brand: 'AgentID' }

export const ROOT_AGENT_ID = '0' as AgentID

export function makeAgentID(value: string): AgentID {
  if (!isAgentID(value)) throw new Error(`invalid AgentID: ${value}`)
  return value as AgentID
}

export function isAgentID(value: string): boolean {
  return /^(0|[1-9]\d*(\.[1-9]\d*)*)$/.test(value)
}

export function parentIdOf(id: AgentID): AgentID | null {
  if (id === ROOT_AGENT_ID) return null
  const cut = id.lastIndexOf('.')
  return makeAgentID(cut === -1 ? '0' : id.slice(0, cut))
}

/** 子出生路径：根之子 = 序号本身（自 1 起）；更深层 = `<父>.<序号>`。 */
export function childAgentID(parent: AgentID, ordinal: number): AgentID {
  if (!Number.isInteger(ordinal) || ordinal < 1) throw new Error(`invalid ordinal: ${ordinal}`)
  return makeAgentID(parent === ROOT_AGENT_ID ? String(ordinal) : `${parent}.${ordinal}`)
}

export function isAncestorOf(ancestor: AgentID, node: AgentID): boolean {
  return node === ancestor || node.startsWith(`${ancestor}.`) ||
    (ancestor === ROOT_AGENT_ID && /^\d+$/.test(node))
}

/** 可达谓词 ≡ from 为 target 的自身或祖先。 */
export function canReach(from: AgentID, target: AgentID): boolean {
  return from === target || isAncestorOf(from, target)
}

export function compareAgentID(a: AgentID, b: AgentID): number {
  if (a === b) return 0
  const as = a.split('.').map(Number)
  const bs = b.split('.').map(Number)
  for (let i = 0; i < Math.min(as.length, bs.length); i++) {
    const av = as[i] ?? 0
    const bv = bs[i] ?? 0
    if (av !== bv) return av < bv ? -1 : 1
  }
  return as.length - bs.length
}
