import type { Client, Executor, Tx } from "../index"
import { get, run, withTransaction } from "../index"
import { hashToken } from "../../domain/identity/tokens"

export type TokenPurpose = "verify_email" | "reset_password"

export interface TokenClaim {
  userId: number
}

export class EmailTokenRepository {
  constructor(private readonly db: Client) {}

  /** Stores only the hash, so a database leak yields no usable link. */
  async issue(
    userId: number,
    purpose: TokenPurpose,
    token: string,
    ttlMs: number,
    ex: Executor = this.db,
  ): Promise<void> {
    await run(
      ex,
      `INSERT INTO email_tokens (token_hash, user_id, purpose, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [
        hashToken(token),
        userId,
        purpose,
        new Date(Date.now() + ttlMs).toISOString(),
        new Date().toISOString(),
      ],
    )
  }

  /**
   * Consumes a token if it is valid, unused, and unexpired. Returns null
   * otherwise. Consumption and validation happen in one transaction so the
   * same link cannot be redeemed twice concurrently.
   */
  async consume(token: string, purpose: TokenPurpose, ex?: Tx): Promise<TokenClaim | null> {
    const hash = hashToken(token)
    const now = new Date().toISOString()

    return withTransaction(ex ?? this.db, async (tx) => {
      const row = await get<{ user_id: number; expires_at: string; consumed_at: string | null }>(
        tx,
        `SELECT user_id, expires_at, consumed_at FROM email_tokens
         WHERE token_hash = ? AND purpose = ?`,
        [hash, purpose],
      )

      if (!row || row.consumed_at || row.expires_at < now) return null

      await run(tx, "UPDATE email_tokens SET consumed_at = ? WHERE token_hash = ?", [now, hash])
      return { userId: row.user_id }
    })
  }
}
