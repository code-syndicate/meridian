import { get, run } from "../../src/db"
import { test, expect, describe, beforeEach } from "bun:test"
import type { Client } from "../../src/db"
import { LedgerRepository } from "../../src/db/repositories/ledger"
import { verifyLedger } from "../../scripts/verify-ledger"
import { CustodyRepository } from "../../src/db/repositories/custody"
import { freshDb, createUser } from "../support/fixtures"

let db: Client
let ledger: LedgerRepository
let userId: number

beforeEach(async () => {
  db = await freshDb()
  ledger = new LedgerRepository(db)
  userId = await createUser(db)
})

async function deposit(amount: bigint, key: string): Promise<void> {
  const external = await ledger.ensureAccount(null, "BTC", "external_deposit")
  const available = await ledger.ensureAccount(userId, "BTC", "user_available")
  await ledger.post({
    kind: "deposit",
    idempotencyKey: key,
    entries: [
      { accountId: external, asset: "BTC", amount: -amount },
      { accountId: available, asset: "BTC", amount },
    ],
  })
}

describe("verifyLedger", () => {
  test("passes on an empty ledger", async () => {
    expect((await verifyLedger(db)).ok).toBe(true)
  })

  test("passes after well-formed postings", async () => {
    for (let i = 0; i < 100; i++) await deposit(1000n, `k-${i}`)
    const result = await verifyLedger(db)
    expect(result.ok).toBe(true)
    expect(result.violations).toEqual([])
    expect(result.checked.transactions).toBe(100)
    expect(result.checked.entries).toBe(200)
  })

  test("passes after holds and releases", async () => {
    await deposit(100000000n, "d-1")
    const { holdId } = await ledger.hold(userId, "BTC", 40000000n, "w", "h-1")
    await ledger.hold(userId, "BTC", 10000000n, "x", "h-2")
    await ledger.release(holdId, "r-1")
    expect((await verifyLedger(db)).ok).toBe(true)
  })

  test("detects a drifted balance cache", async () => {
    await deposit(100000000n, "d-1")
    const accountId = await ledger.ensureAccount(userId, "BTC", "user_available")
    await run(db, "UPDATE account_balances SET amount = amount + 1 WHERE account_id = ?", [accountId,])
    const result = await verifyLedger(db)
    expect(result.ok).toBe(false)
    expect(result.violations.map((v) => v.invariant)).toContain("balance_cache")
  })

  test("detects a non-conserved asset", async () => {
    await deposit(100000000n, "d-1")
    const accountId = await ledger.ensureAccount(userId, "BTC", "user_available")
    const txId = (await get<{ id: number }>(db, "SELECT id FROM ledger_transactions LIMIT 1"))!.id
    await run(db, `INSERT INTO ledger_entries (transaction_id, account_id, asset, amount, created_at)
       VALUES (?, ?, 'BTC', 500, '2026-01-01')`, [txId, accountId])
    const result = await verifyLedger(db)
    expect(result.ok).toBe(false)
    expect(result.violations.map((v) => v.invariant)).toContain("conservation")
  })

  test("detects an unbalanced transaction", async () => {
    await deposit(100000000n, "d-1")
    const external = await ledger.ensureAccount(null, "BTC", "external_deposit")
    const txId = (await get<{ id: number }>(db, "SELECT id FROM ledger_transactions LIMIT 1"))!.id
    await run(db, `INSERT INTO ledger_entries (transaction_id, account_id, asset, amount, created_at)
       VALUES (?, ?, 'BTC', 500, '2026-01-01')`, [txId, external])
    const result = await verifyLedger(db)
    expect(result.ok).toBe(false)
    expect(result.violations.map((v) => v.invariant)).toContain("transaction_balance")
  })

  test("detects a negative user balance", async () => {
    await deposit(100000000n, "d-1")
    const accountId = await ledger.ensureAccount(userId, "BTC", "user_available")
    await run(db, "UPDATE account_balances SET amount = -1 WHERE account_id = ?", [accountId])
    const result = await verifyLedger(db)
    expect(result.ok).toBe(false)
    expect(result.violations.map((v) => v.invariant)).toContain("non_negative_user")
  })

  test("detects an entry whose asset does not match its account", async () => {
    await deposit(100000000n, "d-1")
    const accountId = await ledger.ensureAccount(userId, "BTC", "user_available")
    const txId = (await get<{ id: number }>(db, "SELECT id FROM ledger_transactions LIMIT 1"))!.id
    await run(db, `INSERT INTO ledger_entries (transaction_id, account_id, asset, amount, created_at)
       VALUES (?, ?, 'ETH', 100, '2026-01-01')`, [txId, accountId])
    const result = await verifyLedger(db)
    expect(result.ok).toBe(false)
    expect(result.violations.map((v) => v.invariant)).toContain("entry_asset_match")
  })

  test("detects active holds that disagree with the held balance", async () => {
    await deposit(100000000n, "d-1")
    await ledger.hold(userId, "BTC", 40000000n, "w", "h-1")
    await run(db, "UPDATE holds SET amount = 999 WHERE status = 'active'")
    const result = await verifyLedger(db)
    expect(result.ok).toBe(false)
    expect(result.violations.map((v) => v.invariant)).toContain("hold_sum")
  })

  test("passes over a large synthetic journal", async () => {
    for (let i = 0; i < 2000; i++) await deposit(BigInt(1 + (i % 997)), `bulk-${i}`)
    expect((await verifyLedger(db)).ok).toBe(true)
    // Each posting is now a round trip with its own transaction, so building
    // the journal takes about forty seconds where it used to be instant.
  }, 180_000)
})

describe("reserve backing", () => {
  test("passes when reserves cover what clients are owed", async () => {
    await deposit(100000000n, "r-1")
    await new CustodyRepository(db).setReserve("BTC", 100000000n)
    expect((await verifyLedger(db)).ok).toBe(true)
  })

  test("passes when reserves exceed what clients are owed", async () => {
    await deposit(100000000n, "r-1")
    await new CustodyRepository(db).setReserve("BTC", 150000000n)
    expect((await verifyLedger(db)).ok).toBe(true)
  })

  test("fails when clients are owed more than the confirmed reserve", async () => {
    await deposit(100000000n, "r-1")
    await new CustodyRepository(db).setReserve("BTC", 99999999n)
    const result = await verifyLedger(db)
    expect(result.ok).toBe(false)
    expect(result.violations.map((v) => v.invariant)).toContain("reserve_backing")
  })

  test("counts held balance toward what is owed", async () => {
    await deposit(100000000n, "r-1")
    await ledger.hold(userId, "BTC", 40000000n, "w", "h-r")
    await new CustodyRepository(db).setReserve("BTC", 100000000n)
    expect((await verifyLedger(db)).ok).toBe(true)
    await new CustodyRepository(db).setReserve("BTC", 60000000n)
    expect((await verifyLedger(db)).ok).toBe(false)
  })

  test("ignores assets with no reserve row recorded", async () => {
    await deposit(100000000n, "r-1")
    expect((await verifyLedger(db)).ok).toBe(true)
  })
})
