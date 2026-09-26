// 恢复：载箱 + 拓扑序重放 + 未决重建（architecture 3.3）。

import type { AgentID, Envelope } from '../model/index.ts'
import type { LineageTree } from '../lineage/index.ts'
import type { PostOffice } from '../post/index.ts'
import type { InstanceRow, InstanceStore, MessageStore } from '../ports/index.ts'
import type { ToolAccessMap } from '../model/index.ts'

export type RestoreResult = {
  readonly instances: number
  readonly envelopes: number
  readonly issues: readonly string[]
}

/** 载入实例行 → 族谱 attach；活跃态归一为 interrupted。已存在（如 boot 刚建的根）只更新账目。 */
export function restoreInstances(
  store: InstanceStore,
  lineage: LineageTree,
  registerAccess?: ToolAccessMap,
): RestoreResult {
  const issues: string[] = []
  const rows = [...store.loadAll()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  let n = 0
  for (const row of rows) {
    const status = row.runtime.status
    const runtime =
      status === 'thinking' || status === 'tooling'
        ? { ...row.runtime, status: 'interrupted' as const }
        : row.runtime
    if (lineage.has(row.id)) {
      lineage.rewriteRuntime(row.id, runtime)
      n++
      continue
    }
    const err = lineage.attach(row.id, { attrs: row.attrs, registerAccess })
    if (err) issues.push(`${row.id}: ${err.kind}`)
    else {
      lineage.rewriteRuntime(row.id, runtime)
      n++
    }
  }
  return { instances: n, envelopes: 0, issues }
}

/** 载入语料行 → 邮局箱。 */
export function restoreEnvelopes(
  store: MessageStore,
  post: PostOffice,
  agentIds: readonly AgentID[],
): number {
  let n = 0
  for (const id of agentIds) {
    for (const env of store.list(id) as readonly Envelope[]) {
      post.deposit(env)
      n++
    }
  }
  return n
}

/** write-through：管道入库时同步落行。 */
export function attachWriteThrough(
  messageStore: MessageStore,
  deposit: (envelope: Envelope) => void,
): (envelope: Envelope) => void {
  return (envelope) => {
    messageStore.append(envelope)
    deposit(envelope)
  }
}
