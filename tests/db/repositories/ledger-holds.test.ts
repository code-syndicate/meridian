import { get } from "../../../src/db"
import { test, expect, describe, beforeEach } from "bun:test"
import type { Client } from "../../../src/db"
import { LedgerRepository } from "../../../src/db/repositories/ledger"
import { LedgerError } from "../../../src/domain/ledger/types"
import { freshDb, createUser } from "../../support/fixtures"

let db: Client
let ledger: LedgerRepository
let userId: number

async function codeOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn()
  } catch (error) {
    if (error instanceof LedgerError) return error.code
    throw error
  }
  throw new Error("expected the call to throw, it did not")
}

beforeEach(async () => {
  db = await freshDb()
  ledger = new LedgerRepository(db)
  userId = await createUser(db)
  const external = await ledger.ensureAccount(null, "BTC", "external_deposit")
  const available = await ledger.ensureAccount(userId, "BTC", "user_available")
  await ledger.post({
    kind: "deposit",
    idempotencyKey: "seed",
    entries: [
      { accountId: external, asset: "BTC", amount: -100000000n },
      { accountId: available, asset: "BTC", amount: 100000000n },
    ],
  })
})

describe("hold", () => {
  test("moves value from available to held", async () => {
    await ledger.hold(userId, "BTC", 30000000n, "withdrawal-1", "hold-1")
    expect(await ledger.balance(userId, "BTC")).toEqual({
      available: 70000000n,
      held: 30000000n,
    })
  })

  test("records an active hold row", async () => {
    const { holdId } = await ledger.hold(userId, "BTC", 30000000n, "withdrawal-1", "hold-1")
    const row = (await get<{ status: string; amount: number; reference: string }>(db, "SELECT status, amount, reference FROM holds WHERE id = ?", [holdId]))!
    expect(row).toMatchObject({
      status: "active",
      amount: 30000000,
      reference: "withdrawal-1",
    })
  })

  test("rejects a hold exceeding the available balance", async () => {
    expect(
      await codeOf(async () => await ledger.hold(userId, "BTC", 200000000n, "too-much", "hold-1")),
    ).toBe("insufficient_balance")
  })

  test("permits holding the entire available balance", async () => {
    await ledger.hold(userId, "BTC", 100000000n, "all", "hold-1")
    expect(await ledger.balance(userId, "BTC")).toEqual({ available: 0n, held: 100000000n })
  })

  test("sums multiple active holds into the held balance", async () => {
    await ledger.hold(userId, "BTC", 10000000n, "a", "hold-a")
    await ledger.hold(userId, "BTC", 20000000n, "b", "hold-b")
    expect((await ledger.balance(userId, "BTC")).held).toBe(30000000n)
  })

  test("leaves no hold row behind when the hold is rejected", async () => {
    await codeOf(async () => await ledger.hold(userId, "BTC", 200000000n, "too-much", "hold-1"))
    const count = (await get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM holds"))!.n
    expect(count).toBe(0)
  })
})

describe("release", () => {
  test("returns held value to available", async () => {
    const { holdId } = await ledger.hold(userId, "BTC", 30000000n, "w-1", "hold-1")
    await ledger.release(holdId, "release-1")
    expect(await ledger.balance(userId, "BTC")).toEqual({ available: 100000000n, held: 0n })
  })

  test("marks the hold released and records the closing transaction", async () => {
    const { holdId } = await ledger.hold(userId, "BTC", 30000000n, "w-1", "hold-1")
    await ledger.release(holdId, "release-1")
    const row = (await get<{ status: string; close_transaction_id: number | null }>(db, "SELECT status, close_transaction_id FROM holds WHERE id = ?", [holdId]))!
    expect(row.status).toBe("released")
    expect(row.close_transaction_id).not.toBeNull()
  })

  test("rejects releasing a hold twice", async () => {
    const { holdId } = await ledger.hold(userId, "BTC", 30000000n, "w-1", "hold-1")
    await ledger.release(holdId, "release-1")
    expect(await codeOf(async () => await ledger.release(holdId, "release-2"))).toBe("hold_not_active")
  })

  test("rejects releasing an unknown hold", async () => {
    expect(await codeOf(async () => await ledger.release(9999, "release-1"))).toBe("hold_not_active")
  })
})

describe("consume", () => {
  test("moves held value to the destination and leaves available untouched", async () => {
    const external = await ledger.ensureAccount(null, "BTC", "external_withdrawal")
    const { holdId } = await ledger.hold(userId, "BTC", 30000000n, "w-1", "hold-1")
    await ledger.consume(holdId, external, "consume-1")
    expect(await ledger.balance(userId, "BTC")).toEqual({ available: 70000000n, held: 0n })
  })

  test("marks the hold consumed", async () => {
    const external = await ledger.ensureAccount(null, "BTC", "external_withdrawal")
    const { holdId } = await ledger.hold(userId, "BTC", 30000000n, "w-1", "hold-1")
    await ledger.consume(holdId, external, "consume-1")
    const row = (await get<{ status: string }>(db, "SELECT status FROM holds WHERE id = ?", [holdId]))!
    expect(row.status).toBe("consumed")
  })

  test("rejects consuming an already-released hold", async () => {
    const external = await ledger.ensureAccount(null, "BTC", "external_withdrawal")
    const { holdId } = await ledger.hold(userId, "BTC", 30000000n, "w-1", "hold-1")
    await ledger.release(holdId, "release-1")
    expect(await codeOf(async () => await ledger.consume(holdId, external, "consume-1"))).toBe(
      "hold_not_active",
    )
  })
})

describe("hold invariant", () => {
  test("the sum of active holds equals the user_hold account balance", async () => {
    await ledger.hold(userId, "BTC", 10000000n, "a", "hold-a")
    const { holdId } = await ledger.hold(userId, "BTC", 20000000n, "b", "hold-b")
    await ledger.hold(userId, "BTC", 5000000n, "c", "hold-c")
    await ledger.release(holdId, "release-b")

    const activeSum = (await get<{ total: number }>(db, `SELECT COALESCE(SUM(amount), 0) AS total FROM holds
         WHERE user_id = ? AND asset = 'BTC' AND status = 'active'`, [userId]))!.total

    expect(BigInt(activeSum)).toBe((await ledger.balance(userId, "BTC")).held)
  })
})
