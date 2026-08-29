import type { Database } from "bun:sqlite"
import { openDatabase, migrate } from "../../src/db"

export function freshDb(): Database {
  const db = openDatabase(":memory:")
  migrate(db)
  return db
}

export function createUser(db: Database, email = `u${Math.random()}@test.co`): number {
  db.query(
    `INSERT INTO users (email, email_normalized, password_hash, created_at, updated_at)
     VALUES (?, ?, 'hash', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
  ).run(email, email.toLowerCase())
  return Number(db.query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get()!.id)
}
