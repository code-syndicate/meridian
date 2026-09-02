import { test, expect, describe, beforeEach } from "bun:test"
import type { Client } from "../../src/db"
import { get, migrate, openDatabase, run } from "../../src/db"

let db: Client

async function seedUser(): Promise<number> {
  await run(db, `INSERT INTO users (email, email_normalized, password_hash, created_at, updated_at)
     VALUES ('a@b.co', 'a@b.co', 'hash', '2026-01-01', '2026-01-01')`,)
  return Number((await get<{ id: number }>(db, "SELECT last_insert_rowid() AS id"))!.id)
}

async function seedTransaction(): Promise<number> {
  await run(db, `INSERT INTO ledger_transactions (kind, idempotency_key, created_at)
     VALUES ('test', 'key-' || abs(random()), '2026-01-01')`,)
  return Number((await get<{ id: number }>(db, "SELECT last_insert_rowid() AS id"))!.id)
}

async function seedAccount(userId: number | null, type: string): Promise<number> {
  await run(db, `INSERT INTO accounts (user_id, asset, type, created_at) VALUES (?, 'BTC', ?, '2026-01-01')`, [userId, type])
  return Number((await get<{ id: number }>(db, "SELECT last_insert_rowid() AS id"))!.id)
}

beforeEach(async () => {
  db = await openDatabase(":memory:")
  await migrate(db)
})

describe("append-only enforcement", () => {
  test("rejects updating a ledger transaction", async () => {
    const id = await seedTransaction()
    await expect(run(db, "UPDATE ledger_transactions SET kind = 'changed' WHERE id = ?", [id]),).rejects.toThrow(/append-only/)
  })

  test("rejects deleting a ledger transaction", async () => {
    const id = await seedTransaction()
    await expect(run(db, "DELETE FROM ledger_transactions WHERE id = ?", [id])).rejects.toThrow(
      /append-only/,
    )
  })

  test("rejects updating a ledger entry", async () => {
    const txId = await seedTransaction()
    const accountId = await seedAccount(await seedUser(), "user_available")
    await run(db, `INSERT INTO ledger_entries (transaction_id, account_id, asset, amount, created_at)
       VALUES (?, ?, 'BTC', 100, '2026-01-01')`, [txId, accountId])
    await expect(run(db, "UPDATE ledger_entries SET amount = 999")).rejects.toThrow(
      /append-only/,
    )
  })

  test("rejects deleting a ledger entry", async () => {
    const txId = await seedTransaction()
    const accountId = await seedAccount(await seedUser(), "user_available")
    await run(db, `INSERT INTO ledger_entries (transaction_id, account_id, asset, amount, created_at)
       VALUES (?, ?, 'BTC', 100, '2026-01-01')`, [txId, accountId])
    await expect(run(db, "DELETE FROM ledger_entries")).rejects.toThrow(/append-only/)
  })
})

describe("schema constraints", () => {
  test("rejects a duplicate idempotency key", async () => {
    await run(db, `INSERT INTO ledger_transactions (kind, idempotency_key, created_at)
       VALUES ('test', 'dup', '2026-01-01')`,)
    await expect(run(db, `INSERT INTO ledger_transactions (kind, idempotency_key, created_at)
           VALUES ('test', 'dup', '2026-01-01')`),).rejects.toThrow()
  })

  test("rejects a zero-amount entry", async () => {
    const txId = await seedTransaction()
    const accountId = await seedAccount(await seedUser(), "user_available")
    await expect(run(db, `INSERT INTO ledger_entries (transaction_id, account_id, asset, amount, created_at)
           VALUES (?, ?, 'BTC', 0, '2026-01-01')`, [txId, accountId]),).rejects.toThrow()
  })

  test("rejects a user account with no user id", async () => {
    await expect(seedAccount(null, "user_available")).rejects.toThrow()
  })

  test("rejects a platform account carrying a user id", async () => {
    await expect(seedAccount(await seedUser(), "platform_fee")).rejects.toThrow()
  })

  test("rejects a duplicate user account for the same asset and type", async () => {
    const userId = await seedUser()
    await seedAccount(userId, "user_available")
    await expect(seedAccount(userId, "user_available")).rejects.toThrow()
  })

  test("rejects a duplicate platform account for the same asset and type", async () => {
    await seedAccount(null, "platform_fee")
    await expect(seedAccount(null, "platform_fee")).rejects.toThrow()
  })

  test("rejects an entry referencing an unknown asset", async () => {
    const txId = await seedTransaction()
    const accountId = await seedAccount(await seedUser(), "user_available")
    await expect(run(db, `INSERT INTO ledger_entries (transaction_id, account_id, asset, amount, created_at)
           VALUES (?, ?, 'NOPE', 100, '2026-01-01')`, [txId, accountId]),).rejects.toThrow()
  })

  test("rejects an active hold that carries a close transaction", async () => {
    const userId = await seedUser()
    const txId = await seedTransaction()
    await expect(run(db, `INSERT INTO holds (user_id, asset, amount, status, reference,
             place_transaction_id, close_transaction_id, created_at)
           VALUES (?, 'BTC', 100, 'active', 'ref', ?, ?, '2026-01-01')`, [userId, txId, txId]),).rejects.toThrow()
  })
})
