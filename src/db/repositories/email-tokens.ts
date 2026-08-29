import type { Database } from "bun:sqlite"
import { hashToken } from "../../domain/identity/tokens"

export type TokenPurpose = "verify_email" | "reset_password"

export interface TokenClaim {
  userId: number
}

export class EmailTokenRepository {
  constructor(private readonly db: Database) {}

  /** Stores only the hash, so a database leak yields no usable link. */
  issue(userId: number, purpose: TokenPurpose, token: string, ttlMs: number): void {
    this.db
      .query(
        `INSERT INTO email_tokens (token_hash, user_id, purpose, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        hashToken(token),
        userId,
        purpose,
        new Date(Date.now() + ttlMs).toISOString(),
        new Date().toISOString(),
      )
  }

  /**
   * Consumes a token if it is valid, unused, and unexpired. Returns null
   * otherwise. Consumption and validation happen in one transaction so the
   * same link cannot be redeemed twice concurrently.
   */
  consume(token: string, purpose: TokenPurpose): TokenClaim | null {
    const hash = hashToken(token)
    const now = new Date().toISOString()

    return this.db.transaction(() => {
      const row = this.db
        .query<{ user_id: number; expires_at: string; consumed_at: string | null }, [string, string]>(
          `SELECT user_id, expires_at, consumed_at FROM email_tokens
           WHERE token_hash = ? AND purpose = ?`,
        )
        .get(hash, purpose)

      if (!row || row.consumed_at || row.expires_at < now) return null

      this.db
        .query("UPDATE email_tokens SET consumed_at = ? WHERE token_hash = ?")
        .run(now, hash)
      return { userId: row.user_id }
    })()
  }
}
