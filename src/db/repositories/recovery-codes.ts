import type { Client, Executor } from "../index"
import { all, run } from "../index"

export class RecoveryCodeRepository {
  constructor(private readonly db: Client) {}

  async store(
    userId: number,
    codeHash: string,
    createdAt: string,
    ex: Executor = this.db,
  ): Promise<void> {
    await run(
      ex,
      "INSERT INTO recovery_codes (user_id, code_hash, created_at) VALUES (?, ?, ?)",
      [userId, codeHash, createdAt],
    )
  }

  async listUnused(
    userId: number,
    ex: Executor = this.db,
  ): Promise<Array<{ id: number; codeHash: string }>> {
    const rows = await all<{ id: number; code_hash: string }>(
      ex,
      "SELECT id, code_hash FROM recovery_codes WHERE user_id = ? AND used_at IS NULL",
      [userId],
    )
    return rows.map((row) => ({ id: row.id, codeHash: row.code_hash }))
  }

  async markUsed(id: number, ex: Executor = this.db): Promise<void> {
    await run(ex, "UPDATE recovery_codes SET used_at = ? WHERE id = ?", [
      new Date().toISOString(),
      id,
    ])
  }

  async deleteAllFor(userId: number, ex: Executor = this.db): Promise<void> {
    await run(ex, "DELETE FROM recovery_codes WHERE user_id = ?", [userId])
  }
}
