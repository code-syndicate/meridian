import type { Client, Executor } from "../index"
import { all, run } from "../index"

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
  constructor(private readonly db: Client) {}

  async record(
    entry: {
      userId?: number | null
      actorType: AuditActor
      action: string
      target?: string | null
      ip?: string | null
      userAgent?: string | null
      metadata?: Record<string, unknown>
    },
    ex: Executor = this.db,
  ): Promise<number> {
    const result = await run(
      ex,
      `INSERT INTO audit_log (user_id, actor_type, action, target, ip, user_agent, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.userId ?? null,
        entry.actorType,
        entry.action,
        entry.target ?? null,
        entry.ip ?? null,
        entry.userAgent ?? null,
        JSON.stringify(entry.metadata ?? {}),
        new Date().toISOString(),
      ],
    )
    return Number(result.lastInsertRowid)
  }

  async forUser(userId: number, limit: number, ex: Executor = this.db): Promise<AuditEntry[]> {
    const rows = await all<AuditRow>(
      ex,
      `SELECT id, user_id, actor_type, action, target, ip, user_agent, metadata, created_at
       FROM audit_log WHERE user_id = ? ORDER BY id DESC LIMIT ?`,
      [userId, limit],
    )
    return rows.map((row) => ({
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
