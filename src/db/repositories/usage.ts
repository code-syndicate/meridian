import type { Client, Executor } from "../index"
import { moneyGet, run } from "../index"

export class UsageRepository {
  constructor(private readonly db: Client) {}

  async used(
    userId: number,
    kind: "outbound" | "inbound",
    windowKey: string,
    ex: Executor = this.db,
  ): Promise<bigint> {
    const row = await moneyGet<{ used_usd: bigint }>(
      ex,
      `SELECT used_usd FROM usage_counters
        WHERE user_id = ? AND kind = ? AND window_key = ?`,
      [userId, kind, windowKey],
    )
    return row ? row.used_usd : 0n
  }

  /**
   * Adds to the counter only if the result stays within cap, in one statement.
   * Two withdrawals racing cannot both see headroom that only one of them has.
   * Returns false when the cap would be exceeded.
   */
  async consume(
    input: {
      userId: number
      kind: "outbound" | "inbound"
      windowKey: string
      amountUsd: bigint
      capUsd: bigint | null
    },
    ex: Executor = this.db,
  ): Promise<boolean> {
    const now = new Date().toISOString()
    await run(
      ex,
      `INSERT OR IGNORE INTO usage_counters (user_id, kind, window_key, used_usd, updated_at)
       VALUES (?, ?, ?, 0, ?)`,
      [input.userId, input.kind, input.windowKey, now],
    )

    if (input.capUsd === null) {
      await run(
        ex,
        `UPDATE usage_counters SET used_usd = used_usd + ?, updated_at = ?
          WHERE user_id = ? AND kind = ? AND window_key = ?`,
        [input.amountUsd, now, input.userId, input.kind, input.windowKey],
      )
      return true
    }

    const result = await run(
      ex,
      `UPDATE usage_counters SET used_usd = used_usd + ?, updated_at = ?
        WHERE user_id = ? AND kind = ? AND window_key = ?
          AND used_usd + ? <= ?`,
      [
        input.amountUsd, now,
        input.userId, input.kind, input.windowKey,
        input.amountUsd, input.capUsd,
      ],
    )
    return result.rowsAffected > 0
  }

  /** Gives headroom back when the movement the counter was reserved for failed. */
  async release(
    input: {
      userId: number
      kind: "outbound" | "inbound"
      windowKey: string
      amountUsd: bigint
    },
    ex: Executor = this.db,
  ): Promise<void> {
    await run(
      ex,
      `UPDATE usage_counters
          SET used_usd = MAX(0, used_usd - ?), updated_at = ?
        WHERE user_id = ? AND kind = ? AND window_key = ?`,
      [input.amountUsd, new Date().toISOString(), input.userId, input.kind, input.windowKey],
    )
  }
}
