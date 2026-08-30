import type { Database } from "bun:sqlite"
import { moneyQuery } from "../index"

export class UsageRepository {
  constructor(private readonly db: Database) {}

  used(userId: number, kind: "outbound" | "inbound", windowKey: string): bigint {
    const row = moneyQuery<{ used_usd: bigint }, [number, string, string]>(
      this.db,
      `SELECT used_usd FROM usage_counters
        WHERE user_id = ? AND kind = ? AND window_key = ?`,
    ).get(userId, kind, windowKey)
    return row ? row.used_usd : 0n
  }

  /**
   * Adds to the counter only if the result stays within cap, in one statement.
   * Two withdrawals racing cannot both see headroom that only one of them has.
   * Returns false when the cap would be exceeded.
   */
  consume(input: {
    userId: number
    kind: "outbound" | "inbound"
    windowKey: string
    amountUsd: bigint
    capUsd: bigint | null
  }): boolean {
    const now = new Date().toISOString()
    this.db
      .query(
        `INSERT OR IGNORE INTO usage_counters (user_id, kind, window_key, used_usd, updated_at)
         VALUES (?, ?, ?, 0, ?)`,
      )
      .run(input.userId, input.kind, input.windowKey, now)

    if (input.capUsd === null) {
      this.db
        .query(
          `UPDATE usage_counters SET used_usd = used_usd + ?, updated_at = ?
            WHERE user_id = ? AND kind = ? AND window_key = ?`,
        )
        .run(input.amountUsd, now, input.userId, input.kind, input.windowKey)
      return true
    }

    const result = this.db
      .query(
        `UPDATE usage_counters SET used_usd = used_usd + ?, updated_at = ?
          WHERE user_id = ? AND kind = ? AND window_key = ?
            AND used_usd + ? <= ?`,
      )
      .run(
        input.amountUsd, now,
        input.userId, input.kind, input.windowKey,
        input.amountUsd, input.capUsd,
      )
    return result.changes > 0
  }

  /** Gives headroom back when the movement the counter was reserved for failed. */
  release(input: {
    userId: number
    kind: "outbound" | "inbound"
    windowKey: string
    amountUsd: bigint
  }): void {
    this.db
      .query(
        `UPDATE usage_counters
            SET used_usd = MAX(0, used_usd - ?), updated_at = ?
          WHERE user_id = ? AND kind = ? AND window_key = ?`,
      )
      .run(input.amountUsd, new Date().toISOString(), input.userId, input.kind, input.windowKey)
  }
}
