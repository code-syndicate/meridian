import { test, expect, describe, beforeEach } from "bun:test"
import type { Database } from "bun:sqlite"
import { LedgerRepository } from "../../../src/db/repositories/ledger"
import { LedgerError } from "../../../src/domain/ledger/types"
import { freshDb, createUser } from "../../support/fixtures"

let db: Database
let ledger: LedgerRepository
let userId: number

function codeOf(fn: () => void): string {
  try {
    fn()
  } catch (error) {
    if (error instanceof LedgerError) return error.code
    throw error
  }
  throw new Error("expected the call to throw, it did not")
}

beforeEach(() => {
  db = freshDb()
  ledger = new LedgerRepository(db)
  userId = createUser(db)
  const external = ledger.ensureAccount(null, "BTC", "external_deposit")
  const available = ledger.ensureAccount(userId, "BTC", "user_available")
  ledger.post({
    kind: "deposit",
    idempotencyKey: "seed",
    entries: [
      { accountId: external, asset: "BTC", amount: -100000000n },
      { accountId: available, asset: "BTC", amount: 100000000n },
    ],
  })
})

describe("hold", () => {
  test("moves value from available to held", () => {
    ledger.hold(userId, "BTC", 30000000n, "withdrawal-1", "hold-1")
    expect(ledger.balance(userId, "BTC")).toEqual({
      available: 70000000n,
      held: 30000000n,
    })
  })

  test("records an active hold row", () => {
    const { holdId } = ledger.hold(userId, "BTC", 30000000n, "withdrawal-1", "hold-1")
    const row = db
      .query<{ status: string; amount: number; reference: string }, [number]>(
        "SELECT status, amount, reference FROM holds WHERE id = ?",
      )
      .get(holdId)!
    expect(row).toMatchObject({
      status: "active",
      amount: 30000000,
      reference: "withdrawal-1",
    })
  })

  test("rejects a hold exceeding the available balance", () => {
    expect(
      codeOf(() => ledger.hold(userId, "BTC", 200000000n, "too-much", "hold-1")),
    ).toBe("insufficient_balance")
  })

  test("permits holding the entire available balance", () => {
    ledger.hold(userId, "BTC", 100000000n, "all", "hold-1")
    expect(ledger.balance(userId, "BTC")).toEqual({ available: 0n, held: 100000000n })
  })

  test("sums multiple active holds into the held balance", () => {
    ledger.hold(userId, "BTC", 10000000n, "a", "hold-a")
    ledger.hold(userId, "BTC", 20000000n, "b", "hold-b")
    expect(ledger.balance(userId, "BTC").held).toBe(30000000n)
  })

  test("leaves no hold row behind when the hold is rejected", () => {
    codeOf(() => ledger.hold(userId, "BTC", 200000000n, "too-much", "hold-1"))
    const count = db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM holds").get()!.n
    expect(count).toBe(0)
  })
})

describe("release", () => {
  test("returns held value to available", () => {
    const { holdId } = ledger.hold(userId, "BTC", 30000000n, "w-1", "hold-1")
    ledger.release(holdId, "release-1")
    expect(ledger.balance(userId, "BTC")).toEqual({ available: 100000000n, held: 0n })
  })

  test("marks the hold released and records the closing transaction", () => {
    const { holdId } = ledger.hold(userId, "BTC", 30000000n, "w-1", "hold-1")
    ledger.release(holdId, "release-1")
    const row = db
      .query<{ status: string; close_transaction_id: number | null }, [number]>(
        "SELECT status, close_transaction_id FROM holds WHERE id = ?",
      )
      .get(holdId)!
    expect(row.status).toBe("released")
    expect(row.close_transaction_id).not.toBeNull()
  })

  test("rejects releasing a hold twice", () => {
    const { holdId } = ledger.hold(userId, "BTC", 30000000n, "w-1", "hold-1")
    ledger.release(holdId, "release-1")
    expect(codeOf(() => ledger.release(holdId, "release-2"))).toBe("hold_not_active")
  })

  test("rejects releasing an unknown hold", () => {
    expect(codeOf(() => ledger.release(9999, "release-1"))).toBe("hold_not_active")
  })
})

describe("consume", () => {
  test("moves held value to the destination and leaves available untouched", () => {
    const external = ledger.ensureAccount(null, "BTC", "external_withdrawal")
    const { holdId } = ledger.hold(userId, "BTC", 30000000n, "w-1", "hold-1")
    ledger.consume(holdId, external, "consume-1")
    expect(ledger.balance(userId, "BTC")).toEqual({ available: 70000000n, held: 0n })
  })

  test("marks the hold consumed", () => {
    const external = ledger.ensureAccount(null, "BTC", "external_withdrawal")
    const { holdId } = ledger.hold(userId, "BTC", 30000000n, "w-1", "hold-1")
    ledger.consume(holdId, external, "consume-1")
    const row = db
      .query<{ status: string }, [number]>("SELECT status FROM holds WHERE id = ?")
      .get(holdId)!
    expect(row.status).toBe("consumed")
  })

  test("rejects consuming an already-released hold", () => {
    const external = ledger.ensureAccount(null, "BTC", "external_withdrawal")
    const { holdId } = ledger.hold(userId, "BTC", 30000000n, "w-1", "hold-1")
    ledger.release(holdId, "release-1")
    expect(codeOf(() => ledger.consume(holdId, external, "consume-1"))).toBe(
      "hold_not_active",
    )
  })
})

describe("hold invariant", () => {
  test("the sum of active holds equals the user_hold account balance", () => {
    ledger.hold(userId, "BTC", 10000000n, "a", "hold-a")
    const { holdId } = ledger.hold(userId, "BTC", 20000000n, "b", "hold-b")
    ledger.hold(userId, "BTC", 5000000n, "c", "hold-c")
    ledger.release(holdId, "release-b")

    const activeSum = db
      .query<{ total: number }, [number]>(
        `SELECT COALESCE(SUM(amount), 0) AS total FROM holds
         WHERE user_id = ? AND asset = 'BTC' AND status = 'active'`,
      )
      .get(userId)!.total

    expect(BigInt(activeSum)).toBe(ledger.balance(userId, "BTC").held)
  })
})
