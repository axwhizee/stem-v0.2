// 宿主端口：消息/实例存储。SQLite/内存皆可；core 只定契约。

import type { AgentID, Envelope, EffectiveAttrs, RuntimeAttrs } from '../model/index.ts'

export type InstanceRow = {
  readonly id: AgentID
  readonly attrs: EffectiveAttrs
  readonly runtime: RuntimeAttrs
  readonly tombstone?: boolean
}

export type MessageStore = {
  readonly append: (envelope: Envelope) => void
  readonly list: (agentId: AgentID) => readonly Envelope[]
  readonly invalidate: (agentId: AgentID, envelopeId: string, tag?: string) => void
}

export type InstanceStore = {
  readonly upsert: (row: InstanceRow) => void
  readonly load: (id: AgentID) => InstanceRow | undefined
  readonly loadAll: () => readonly InstanceRow[]
  readonly archive: (id: AgentID) => void
}

/** 测试与组合缺省：内存双端口。 */
export class MemoryMessageStore implements MessageStore {
  readonly #rows: Envelope[] = []

  append(envelope: Envelope): void {
    this.#rows.push(envelope)
  }

  list(agentId: AgentID): readonly Envelope[] {
    return this.#rows.filter((e) => e.agentId === agentId)
  }

  invalidate(agentId: AgentID, envelopeId: string, tag?: string): void {
    const i = this.#rows.findIndex((e) => e.agentId === agentId && e.id === envelopeId)
    if (i >= 0) {
      const row = this.#rows[i]
      if (row) this.#rows[i] = { ...row, valid: false, tag: tag ?? row.tag }
    }
  }
}

export class MemoryInstanceStore implements InstanceStore {
  readonly #rows = new Map<AgentID, InstanceRow>()

  upsert(row: InstanceRow): void {
    this.#rows.set(row.id, row)
  }

  load(id: AgentID): InstanceRow | undefined {
    return this.#rows.get(id)
  }

  loadAll(): readonly InstanceRow[] {
    return [...this.#rows.values()]
  }

  archive(id: AgentID): void {
    const row = this.#rows.get(id)
    if (row) this.#rows.set(id, { ...row, tombstone: true })
  }
}
