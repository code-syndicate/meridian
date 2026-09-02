import type { Client, Executor } from "../index"
import { all, get, run } from "../index"
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
  constructor(private readonly db: Client) {}

  async create(
    userId: number,
    ctx: { ip?: string | null; userAgent?: string | null },
    ex: Executor = this.db,
  ): Promise<string> {
    const id = randomToken(32)
    const now = new Date()
    const expires = new Date(now.getTime() + ABSOLUTE_DAYS * 86_400_000)
    await run(
      ex,
      `INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at, ip, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        userId,
        now.toISOString(),
        now.toISOString(),
        expires.toISOString(),
        ctx.ip ?? null,
        ctx.userAgent ?? null,
      ],
    )
    return id
  }

  async find(id: string, ex: Executor = this.db): Promise<Session | null> {
    const row = await get<SessionRow>(
      ex,
      `SELECT id, user_id, created_at, last_seen_at, expires_at, ip, user_agent
       FROM sessions
       WHERE id = ? AND revoked_at IS NULL AND expires_at > ?`,
      [id, new Date().toISOString()],
    )
    return row ? toSession(row) : null
  }

  async touch(id: string, ex: Executor = this.db): Promise<void> {
    await run(ex, "UPDATE sessions SET last_seen_at = ? WHERE id = ?", [
      new Date().toISOString(),
      id,
    ])
  }

  async revoke(id: string, ex: Executor = this.db): Promise<void> {
    await run(ex, "UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL", [
      new Date().toISOString(),
      id,
    ])
  }

  async revokeAllFor(userId: number, ex: Executor = this.db): Promise<number> {
    const active = (await this.listActive(userId, ex)).length
    await run(ex, "UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL", [
      new Date().toISOString(),
      userId,
    ])
    return active
  }

  async listActive(userId: number, ex: Executor = this.db): Promise<Session[]> {
    const rows = await all<SessionRow>(
      ex,
      `SELECT id, user_id, created_at, last_seen_at, expires_at, ip, user_agent
       FROM sessions
       WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?
       ORDER BY created_at DESC, rowid DESC`,
      [userId, new Date().toISOString()],
    )
    return rows.map(toSession)
  }
}
