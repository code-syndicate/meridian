import type { Database } from "bun:sqlite"

export class RateLimitRepository {
  constructor(private readonly db: Database) {}

  /**
   * Token bucket, persisted so a restart does not hand an attacker a fresh
   * allowance. Returns whether this request may proceed.
   */
  consume(
    bucket: string,
    capacity: number,
    refillPerSecond: number,
    lockSeconds: number,
  ): { allowed: boolean; lockedUntil: string | null } {
    const now = new Date()
    const nowIso = now.toISOString()

    return this.db.transaction(() => {
      const row = this.db
        .query<{ tokens: number; updated_at: string; locked_until: string | null }, [string]>(
          "SELECT tokens, updated_at, locked_until FROM rate_limits WHERE bucket = ?",
        )
        .get(bucket)

      if (row?.locked_until && new Date(row.locked_until) > now) {
        return { allowed: false, lockedUntil: row.locked_until }
      }

      let tokens = capacity
      if (row) {
        const elapsed = (now.getTime() - new Date(row.updated_at).getTime()) / 1000
        tokens = Math.min(capacity, row.tokens + elapsed * refillPerSecond)
      }

      if (tokens < 1) {
        const lockedUntil =
          lockSeconds > 0 ? new Date(now.getTime() + lockSeconds * 1000).toISOString() : null
        this.db
          .query(
            `INSERT INTO rate_limits (bucket, tokens, updated_at, locked_until)
             VALUES (?, 0, ?, ?)
             ON CONFLICT(bucket) DO UPDATE SET tokens = 0, updated_at = ?, locked_until = ?`,
          )
          .run(bucket, nowIso, lockedUntil, nowIso, lockedUntil)
        return { allowed: false, lockedUntil }
      }

      const remaining = tokens - 1
      this.db
        .query(
          `INSERT INTO rate_limits (bucket, tokens, updated_at, locked_until)
           VALUES (?, ?, ?, NULL)
           ON CONFLICT(bucket) DO UPDATE SET tokens = ?, updated_at = ?, locked_until = NULL`,
        )
        .run(bucket, remaining, nowIso, remaining, nowIso)
      return { allowed: true, lockedUntil: null }
    })()
  }
}
