// id —— 出生路径 AgentID。根 `0` 是拓扑原点，不是特权码。
// 一律「子 = `<父>.<序号>`」；父 id 纯推导（parentIdOf），不冗余存储。

export type AgentID = string & { readonly __brand: 'AgentID' }

export const ROOT_AGENT_ID = '0' as AgentID

export function makeAgentID(value: string): AgentID {
  if (!isAgentID(value)) throw new Error(`invalid AgentID: ${value}`)
  return value as AgentID
}

export function isAgentID(value: string): boolean {
  return /^0(\.(0|[1-9]\d*))*$/.test(value)
}

export function parentIdOf(id: AgentID): AgentID | null {
  if (id === ROOT_AGENT_ID) return null
  return makeAgentID(id.slice(0, id.lastIndexOf('.')))
}

/** 子出生路径 = `<父>.<序号>`。序号不回收。 */
export function childAgentID(parent: AgentID, ordinal: number): AgentID {
  if (!Number.isInteger(ordinal) || ordinal < 0) throw new Error(`invalid ordinal: ${ordinal}`)
  return makeAgentID(`${parent}.${ordinal}`)
}

export function isAncestorOf(ancestor: AgentID, node: AgentID): boolean {
  return node === ancestor || node.startsWith(`${ancestor}.`)
}

/** 可达域 ≡ 自身 ∨ 祖先（architecture 3.5）。 */
export function canReach(from: AgentID, target: AgentID): boolean {
  return target === from || isAncestorOf(target, from)
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
