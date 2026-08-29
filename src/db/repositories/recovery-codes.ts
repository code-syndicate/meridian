import type { Database } from "bun:sqlite"

export class RecoveryCodeRepository {
  constructor(private readonly db: Database) {}

  store(userId: number, codeHash: string, createdAt: string): void {
    this.db
      .query("INSERT INTO recovery_codes (user_id, code_hash, created_at) VALUES (?, ?, ?)")
      .run(userId, codeHash, createdAt)
  }

  listUnused(userId: number): Array<{ id: number; codeHash: string }> {
    return this.db
      .query<{ id: number; code_hash: string }, [number]>(
        "SELECT id, code_hash FROM recovery_codes WHERE user_id = ? AND used_at IS NULL",
      )
      .all(userId)
      .map((row) => ({ id: row.id, codeHash: row.code_hash }))
  }

  markUsed(id: number): void {
    this.db
      .query("UPDATE recovery_codes SET used_at = ? WHERE id = ?")
      .run(new Date().toISOString(), id)
  }

  deleteAllFor(userId: number): void {
    this.db.query("DELETE FROM recovery_codes WHERE user_id = ?").run(userId)
  }
}
