import type { Database } from "bun:sqlite"
import { randomToken } from "../../domain/identity/tokens"

export interface Session {
  id: string
  userId: number
  createdAt: string
  lastSeenAt: string
  expiresAt: string
  ip: string | null
  userAgent: string | null
}

interface SessionRow {
  id: string
  user_id: number
  created_at: string
  last_seen_at: string
  expires_at: string
  ip: string | null
  user_agent: string | null
}

const ABSOLUTE_DAYS = 30

function toSession(row: SessionRow): Session {
  return {
    id: row.id,
    userId: row.user_id,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at,
    ip: row.ip,
    userAgent: row.user_agent,
  }
}

export class SessionRepository {
  constructor(private readonly db: Database) {}

  create(userId: number, ctx: { ip?: string | null; userAgent?: string | null }): string {
    const id = randomToken(32)
    const now = new Date()
    const expires = new Date(now.getTime() + ABSOLUTE_DAYS * 86_400_000)
    this.db
      .query(
        `INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at, ip, user_agent)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        userId,
        now.toISOString(),
        now.toISOString(),
        expires.toISOString(),
        ctx.ip ?? null,
        ctx.userAgent ?? null,
      )
    return id
  }

  find(id: string): Session | null {
    const row = this.db
      .query<SessionRow, [string, string]>(
        `SELECT id, user_id, created_at, last_seen_at, expires_at, ip, user_agent
         FROM sessions
         WHERE id = ? AND revoked_at IS NULL AND expires_at > ?`,
      )
      .get(id, new Date().toISOString())
    return row ? toSession(row) : null
  }

  touch(id: string): void {
    this.db
      .query("UPDATE sessions SET last_seen_at = ? WHERE id = ?")
      .run(new Date().toISOString(), id)
  }

  revoke(id: string): void {
    this.db
      .query("UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL")
      .run(new Date().toISOString(), id)
  }

  revokeAllFor(userId: number): number {
    const active = this.listActive(userId).length
    this.db
      .query("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL")
      .run(new Date().toISOString(), userId)
    return active
  }

  listActive(userId: number): Session[] {
    return this.db
      .query<SessionRow, [number, string]>(
        `SELECT id, user_id, created_at, last_seen_at, expires_at, ip, user_agent
         FROM sessions
         WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?
         ORDER BY created_at DESC, rowid DESC`,
      )
      .all(userId, new Date().toISOString())
      .map(toSession)
  }
}
