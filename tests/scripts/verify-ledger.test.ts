import { test, expect, describe, beforeEach } from "bun:test"
import type { Database } from "bun:sqlite"
import { LedgerRepository } from "../../src/db/repositories/ledger"
import { verifyLedger } from "../../scripts/verify-ledger"
import { CustodyRepository } from "../../src/db/repositories/custody"
import { freshDb, createUser } from "../support/fixtures"

let db: Database
let ledger: LedgerRepository
let userId: number

beforeEach(() => {
  db = freshDb()
  ledger = new LedgerRepository(db)
  userId = createUser(db)
})

function deposit(amount: bigint, key: string): void {
  const external = ledger.ensureAccount(null, "BTC", "external_deposit")
  const available = ledger.ensureAccount(userId, "BTC", "user_available")
  ledger.post({
    kind: "deposit",
    idempotencyKey: key,
    entries: [
      { accountId: external, asset: "BTC", amount: -amount },
      { accountId: available, asset: "BTC", amount },
    ],
  })
}

describe("verifyLedger", () => {
  test("passes on an empty ledger", () => {
    expect(verifyLedger(db).ok).toBe(true)
  })

  test("passes after well-formed postings", () => {
    for (let i = 0; i < 100; i++) deposit(1000n, `k-${i}`)
    const result = verifyLedger(db)
    expect(result.ok).toBe(true)
    expect(result.violations).toEqual([])
    expect(result.checked.transactions).toBe(100)
    expect(result.checked.entries).toBe(200)
  })

  test("passes after holds and releases", () => {
    deposit(100000000n, "d-1")
    const { holdId } = ledger.hold(userId, "BTC", 40000000n, "w", "h-1")
    ledger.hold(userId, "BTC", 10000000n, "x", "h-2")
    ledger.release(holdId, "r-1")
    expect(verifyLedger(db).ok).toBe(true)
  })

  test("detects a drifted balance cache", () => {
    deposit(100000000n, "d-1")
    const accountId = ledger.ensureAccount(userId, "BTC", "user_available")
    db.query("UPDATE account_balances SET amount = amount + 1 WHERE account_id = ?").run(
      accountId,
    )
    const result = verifyLedger(db)
    expect(result.ok).toBe(false)
    expect(result.violations.map((v) => v.invariant)).toContain("balance_cache")
  })

  test("detects a non-conserved asset", () => {
    deposit(100000000n, "d-1")
    const accountId = ledger.ensureAccount(userId, "BTC", "user_available")
    const txId = db
      .query<{ id: number }, []>("SELECT id FROM ledger_transactions LIMIT 1")
      .get()!.id
    db.query(
      `INSERT INTO ledger_entries (transaction_id, account_id, asset, amount, created_at)
       VALUES (?, ?, 'BTC', 500, '2026-01-01')`,
    ).run(txId, accountId)
    const result = verifyLedger(db)
    expect(result.ok).toBe(false)
    expect(result.violations.map((v) => v.invariant)).toContain("conservation")
  })

  test("detects an unbalanced transaction", () => {
    deposit(100000000n, "d-1")
    const external = ledger.ensureAccount(null, "BTC", "external_deposit")
    const txId = db
      .query<{ id: number }, []>("SELECT id FROM ledger_transactions LIMIT 1")
      .get()!.id
    db.query(
      `INSERT INTO ledger_entries (transaction_id, account_id, asset, amount, created_at)
       VALUES (?, ?, 'BTC', 500, '2026-01-01')`,
    ).run(txId, external)
    const result = verifyLedger(db)
    expect(result.ok).toBe(false)
    expect(result.violations.map((v) => v.invariant)).toContain("transaction_balance")
  })

  test("detects a negative user balance", () => {
    deposit(100000000n, "d-1")
    const accountId = ledger.ensureAccount(userId, "BTC", "user_available")
    db.query("UPDATE account_balances SET amount = -1 WHERE account_id = ?").run(accountId)
    const result = verifyLedger(db)
    expect(result.ok).toBe(false)
    expect(result.violations.map((v) => v.invariant)).toContain("non_negative_user")
  })

  test("detects an entry whose asset does not match its account", () => {
    deposit(100000000n, "d-1")
    const accountId = ledger.ensureAccount(userId, "BTC", "user_available")
    const txId = db
      .query<{ id: number }, []>("SELECT id FROM ledger_transactions LIMIT 1")
      .get()!.id
    db.query(
      `INSERT INTO ledger_entries (transaction_id, account_id, asset, amount, created_at)
       VALUES (?, ?, 'ETH', 100, '2026-01-01')`,
    ).run(txId, accountId)
    const result = verifyLedger(db)
    expect(result.ok).toBe(false)
    expect(result.violations.map((v) => v.invariant)).toContain("entry_asset_match")
  })

  test("detects active holds that disagree with the held balance", () => {
    deposit(100000000n, "d-1")
    ledger.hold(userId, "BTC", 40000000n, "w", "h-1")
    db.query("UPDATE holds SET amount = 999 WHERE status = 'active'").run()
    const result = verifyLedger(db)
    expect(result.ok).toBe(false)
    expect(result.violations.map((v) => v.invariant)).toContain("hold_sum")
  })

  test("passes over a large synthetic journal", () => {
    for (let i = 0; i < 2000; i++) deposit(BigInt(1 + (i % 997)), `bulk-${i}`)
    expect(verifyLedger(db).ok).toBe(true)
  })
})

describe("reserve backing", () => {
  test("passes when reserves cover what clients are owed", () => {
    deposit(100000000n, "r-1")
    new CustodyRepository(db).setReserve("BTC", 100000000n)
    expect(verifyLedger(db).ok).toBe(true)
  })

  test("passes when reserves exceed what clients are owed", () => {
    deposit(100000000n, "r-1")
    new CustodyRepository(db).setReserve("BTC", 150000000n)
    expect(verifyLedger(db).ok).toBe(true)
  })

  test("fails when clients are owed more than the confirmed reserve", () => {
    deposit(100000000n, "r-1")
    new CustodyRepository(db).setReserve("BTC", 99999999n)
    const result = verifyLedger(db)
    expect(result.ok).toBe(false)
    expect(result.violations.map((v) => v.invariant)).toContain("reserve_backing")
  })

  test("counts held balance toward what is owed", () => {
    deposit(100000000n, "r-1")
    ledger.hold(userId, "BTC", 40000000n, "w", "h-r")
    new CustodyRepository(db).setReserve("BTC", 100000000n)
    expect(verifyLedger(db).ok).toBe(true)
    new CustodyRepository(db).setReserve("BTC", 60000000n)
    expect(verifyLedger(db).ok).toBe(false)
  })

  test("ignores assets with no reserve row recorded", () => {
    deposit(100000000n, "r-1")
    expect(verifyLedger(db).ok).toBe(true)
  })
})
