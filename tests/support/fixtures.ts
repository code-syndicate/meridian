import type { Client } from "../../src/db"
import { get, migrate, openDatabase, run } from "../../src/db"

export async function freshDb(): Promise<Client> {
  const db = await openDatabase(":memory:")
  await migrate(db)
  return db
}

export async function createUser(
  db: Client,
  email = `u${Math.random()}@test.co`,
): Promise<number> {
  const result = await run(
    db,
    `INSERT INTO users (email, email_normalized, password_hash, created_at, updated_at)
     VALUES (?, ?, 'hash', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    [email, email.toLowerCase()],
  )
  return Number(result.lastInsertRowid)
}
