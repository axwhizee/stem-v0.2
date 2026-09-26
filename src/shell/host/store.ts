// shell 宿主：SQLite 存储端口实现（node:sqlite）。

import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type {
  AgentID,
  Envelope,
  EffectiveAttrs,
  RuntimeAttrs,
} from '../../core/model/index.ts'
import type {
  InstanceRow,
  InstanceStore,
  MessageStore,
} from '../../core/ports/index.ts'

export function createSqliteStores(dbFile: string): MessageStore & InstanceStore & { close: () => void } {
  mkdirSync(dirname(dbFile), { recursive: true })
  const db = new DatabaseSync(dbFile)
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      valid INTEGER NOT NULL,
      payload TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS instances (
      id TEXT PRIMARY KEY,
      attrs TEXT NOT NULL,
      runtime TEXT NOT NULL,
      tombstone INTEGER NOT NULL DEFAULT 0
    );
    PRAGMA user_version = 1;
  `)

  return {
    append(envelope: Envelope) {
      db.prepare(
        `INSERT OR REPLACE INTO messages (id, agent_id, valid, payload) VALUES (?, ?, ?, ?)`,
      ).run(envelope.id, envelope.agentId, envelope.valid ? 1 : 0, JSON.stringify(envelope))
    },
    list(agentId: AgentID) {
      const rows = db
        .prepare(`SELECT payload FROM messages WHERE agent_id = ? ORDER BY rowid`)
        .all(agentId) as { payload: string }[]
      return rows.map((r) => JSON.parse(r.payload) as Envelope)
    },
    invalidate(agentId: AgentID, envelopeId: string, tag?: string) {
      const rows = db
        .prepare(`SELECT payload FROM messages WHERE id = ? AND agent_id = ?`)
        .all(envelopeId, agentId) as { payload: string }[]
      const row = rows[0]
      if (!row) return
      const env = JSON.parse(row.payload) as Envelope
      const next = { ...env, valid: false, tag: tag ?? env.tag }
      db.prepare(`UPDATE messages SET valid = 0, payload = ? WHERE id = ?`).run(
        JSON.stringify(next),
        envelopeId,
      )
    },
    upsert(row: InstanceRow) {
      db.prepare(
        `INSERT OR REPLACE INTO instances (id, attrs, runtime, tombstone) VALUES (?, ?, ?, ?)`,
      ).run(row.id, JSON.stringify(row.attrs), JSON.stringify(row.runtime), row.tombstone ? 1 : 0)
    },
    load(id: AgentID) {
      const rows = db
        .prepare(`SELECT attrs, runtime, tombstone FROM instances WHERE id = ?`)
        .all(id) as { attrs: string; runtime: string; tombstone: number }[]
      const r = rows[0]
      if (!r) return undefined
      return {
        id,
        attrs: JSON.parse(r.attrs) as EffectiveAttrs,
        runtime: JSON.parse(r.runtime) as RuntimeAttrs,
        tombstone: r.tombstone === 1,
      }
    },
    loadAll() {
      const rows = db
        .prepare(`SELECT id, attrs, runtime, tombstone FROM instances ORDER BY id`)
        .all() as { id: string; attrs: string; runtime: string; tombstone: number }[]
      return rows.map((r) => ({
        id: r.id as AgentID,
        attrs: JSON.parse(r.attrs) as EffectiveAttrs,
        runtime: JSON.parse(r.runtime) as RuntimeAttrs,
        tombstone: r.tombstone === 1,
      }))
    },
    archive(id: AgentID) {
      db.prepare(`UPDATE instances SET tombstone = 1 WHERE id = ?`).run(id)
    },
    close() {
      db.close()
    },
  }
}
