import type { Database } from "bun:sqlite"

export type AuditActor = "user" | "admin" | "system"

export interface AuditEntry {
  id: number
  userId: number | null
  actorType: AuditActor
  action: string
  target: string | null
  ip: string | null
  userAgent: string | null
  metadata: Record<string, unknown>
  createdAt: string
}

interface AuditRow {
  id: number
  user_id: number | null
  actor_type: AuditActor
  action: string
  target: string | null
  ip: string | null
  user_agent: string | null
  metadata: string
  created_at: string
}

export class AuditRepository {
  constructor(private readonly db: Database) {}

  record(entry: {
    userId?: number | null
    actorType: AuditActor
    action: string
    target?: string | null
    ip?: string | null
    userAgent?: string | null
    metadata?: Record<string, unknown>
  }): number {
    this.db
      .query(
        `INSERT INTO audit_log (user_id, actor_type, action, target, ip, user_agent, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.userId ?? null,
        entry.actorType,
        entry.action,
        entry.target ?? null,
        entry.ip ?? null,
        entry.userAgent ?? null,
        JSON.stringify(entry.metadata ?? {}),
        new Date().toISOString(),
      )
    return Number(
      this.db.query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get()!.id,
    )
  }

  forUser(userId: number, limit: number): AuditEntry[] {
    return this.db
      .query<AuditRow, [number, number]>(
        `SELECT id, user_id, actor_type, action, target, ip, user_agent, metadata, created_at
         FROM audit_log WHERE user_id = ? ORDER BY id DESC LIMIT ?`,
      )
      .all(userId, limit)
      .map((row) => ({
        id: row.id,
        userId: row.user_id,
        actorType: row.actor_type,
        action: row.action,
        target: row.target,
        ip: row.ip,
        userAgent: row.user_agent,
        metadata: JSON.parse(row.metadata) as Record<string, unknown>,
        createdAt: row.created_at,
      }))
  }
}
