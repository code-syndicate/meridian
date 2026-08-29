import { test, expect, describe, beforeEach } from "bun:test"
import type { Database } from "bun:sqlite"
import { openDatabase, migrate } from "../../src/db"

let db: Database

function seedUser(): number {
  db.query(
    `INSERT INTO users (email, email_normalized, password_hash, created_at, updated_at)
     VALUES ('a@b.co', 'a@b.co', 'hash', '2026-01-01', '2026-01-01')`,
  ).run()
  return Number(db.query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get()!.id)
}

function seedTransaction(): number {
  db.query(
    `INSERT INTO ledger_transactions (kind, idempotency_key, created_at)
     VALUES ('test', 'key-' || abs(random()), '2026-01-01')`,
  ).run()
  return Number(db.query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get()!.id)
}

function seedAccount(userId: number | null, type: string): number {
  db.query(
    `INSERT INTO accounts (user_id, asset, type, created_at) VALUES (?, 'BTC', ?, '2026-01-01')`,
  ).run(userId, type)
  return Number(db.query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get()!.id)
}

beforeEach(() => {
  db = openDatabase(":memory:")
  migrate(db)
})

describe("append-only enforcement", () => {
  test("rejects updating a ledger transaction", () => {
    const id = seedTransaction()
    expect(() =>
      db.query("UPDATE ledger_transactions SET kind = 'changed' WHERE id = ?").run(id),
    ).toThrow(/append-only/)
  })

  test("rejects deleting a ledger transaction", () => {
    const id = seedTransaction()
    expect(() => db.query("DELETE FROM ledger_transactions WHERE id = ?").run(id)).toThrow(
      /append-only/,
    )
  })

  test("rejects updating a ledger entry", () => {
    const txId = seedTransaction()
    const accountId = seedAccount(seedUser(), "user_available")
    db.query(
      `INSERT INTO ledger_entries (transaction_id, account_id, asset, amount, created_at)
       VALUES (?, ?, 'BTC', 100, '2026-01-01')`,
    ).run(txId, accountId)
    expect(() => db.query("UPDATE ledger_entries SET amount = 999").run()).toThrow(
      /append-only/,
    )
  })

  test("rejects deleting a ledger entry", () => {
    const txId = seedTransaction()
    const accountId = seedAccount(seedUser(), "user_available")
    db.query(
      `INSERT INTO ledger_entries (transaction_id, account_id, asset, amount, created_at)
       VALUES (?, ?, 'BTC', 100, '2026-01-01')`,
    ).run(txId, accountId)
    expect(() => db.query("DELETE FROM ledger_entries").run()).toThrow(/append-only/)
  })
})

describe("schema constraints", () => {
  test("rejects a duplicate idempotency key", () => {
    db.query(
      `INSERT INTO ledger_transactions (kind, idempotency_key, created_at)
       VALUES ('test', 'dup', '2026-01-01')`,
    ).run()
    expect(() =>
      db
        .query(
          `INSERT INTO ledger_transactions (kind, idempotency_key, created_at)
           VALUES ('test', 'dup', '2026-01-01')`,
        )
        .run(),
    ).toThrow()
  })

  test("rejects a zero-amount entry", () => {
    const txId = seedTransaction()
    const accountId = seedAccount(seedUser(), "user_available")
    expect(() =>
      db
        .query(
          `INSERT INTO ledger_entries (transaction_id, account_id, asset, amount, created_at)
           VALUES (?, ?, 'BTC', 0, '2026-01-01')`,
        )
        .run(txId, accountId),
    ).toThrow()
  })

  test("rejects a user account with no user id", () => {
    expect(() => seedAccount(null, "user_available")).toThrow()
  })

  test("rejects a platform account carrying a user id", () => {
    expect(() => seedAccount(seedUser(), "platform_fee")).toThrow()
  })

  test("rejects a duplicate user account for the same asset and type", () => {
    const userId = seedUser()
    seedAccount(userId, "user_available")
    expect(() => seedAccount(userId, "user_available")).toThrow()
  })

  test("rejects a duplicate platform account for the same asset and type", () => {
    seedAccount(null, "platform_fee")
    expect(() => seedAccount(null, "platform_fee")).toThrow()
  })

  test("rejects an entry referencing an unknown asset", () => {
    const txId = seedTransaction()
    const accountId = seedAccount(seedUser(), "user_available")
    expect(() =>
      db
        .query(
          `INSERT INTO ledger_entries (transaction_id, account_id, asset, amount, created_at)
           VALUES (?, ?, 'NOPE', 100, '2026-01-01')`,
        )
        .run(txId, accountId),
    ).toThrow()
  })

  test("rejects an active hold that carries a close transaction", () => {
    const userId = seedUser()
    const txId = seedTransaction()
    expect(() =>
      db
        .query(
          `INSERT INTO holds (user_id, asset, amount, status, reference,
             place_transaction_id, close_transaction_id, created_at)
           VALUES (?, 'BTC', 100, 'active', 'ref', ?, ?, '2026-01-01')`,
        )
        .run(userId, txId, txId),
    ).toThrow()
  })
})
