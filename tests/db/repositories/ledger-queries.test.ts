import { test, expect, describe, beforeEach } from "bun:test"
import type { Database } from "bun:sqlite"
import { LedgerRepository } from "../../../src/db/repositories/ledger"
import { freshDb, createUser } from "../../support/fixtures"

let db: Database
let ledger: LedgerRepository
let userId: number
let otherId: number

function credit(user: number, asset: string, amount: bigint, key: string): void {
  const external = ledger.ensureAccount(null, asset, "external_deposit")
  const available = ledger.ensureAccount(user, asset, "user_available")
  ledger.post({
    kind: "deposit",
    idempotencyKey: key,
    entries: [
      { accountId: external, asset, amount: -amount },
      { accountId: available, asset, amount },
    ],
  })
}

beforeEach(() => {
  db = freshDb()
  ledger = new LedgerRepository(db)
  userId = createUser(db, "a@test.co")
  otherId = createUser(db, "b@test.co")
})

describe("balance", () => {
  test("returns zero for an asset the user has never held", () => {
    expect(ledger.balance(userId, "BTC")).toEqual({ available: 0n, held: 0n })
  })

  test("reflects a credit", () => {
    credit(userId, "BTC", 100000000n, "k1")
    expect(ledger.balance(userId, "BTC")).toEqual({ available: 100000000n, held: 0n })
  })

  test("returns bigint, not number", () => {
    credit(userId, "BTC", 100000000n, "k1")
    expect(typeof ledger.balance(userId, "BTC").available).toBe("bigint")
  })

  test("survives a balance beyond 2^53", () => {
    const huge = 9007199254740993n
    credit(userId, "BTC", huge, "k1")
    expect(ledger.balance(userId, "BTC").available).toBe(huge)
  })

  test("does not leak another user's balance", () => {
    credit(otherId, "BTC", 100000000n, "k1")
    expect(ledger.balance(userId, "BTC").available).toBe(0n)
  })
})

describe("balances", () => {
  test("returns every asset the user holds", () => {
    credit(userId, "BTC", 100000000n, "k1")
    credit(userId, "ETH", 200000000n, "k2")
    const all = ledger.balances(userId)
    expect(all.get("BTC")?.available).toBe(100000000n)
    expect(all.get("ETH")?.available).toBe(200000000n)
  })

  test("returns an empty map for a user with no accounts", () => {
    expect(ledger.balances(userId).size).toBe(0)
  })
})

describe("history", () => {
  beforeEach(() => {
    for (let i = 0; i < 25; i++) {
      credit(userId, "BTC", 1000n, `h-${i}`)
    }
  })

  test("returns the most recent entries first", () => {
    const { entries } = ledger.history(userId, { limit: 5 })
    expect(entries).toHaveLength(5)
    expect(entries[0]!.id).toBeGreaterThan(entries[4]!.id)
  })

  test("includes the transaction kind", () => {
    const { entries } = ledger.history(userId, { limit: 1 })
    expect(entries[0]!.kind).toBe("deposit")
  })

  test("returns amounts as bigint", () => {
    const { entries } = ledger.history(userId, { limit: 1 })
    expect(entries[0]!.amount).toBe(1000n)
  })

  test("pages with a cursor without repeating or skipping", () => {
    const first = ledger.history(userId, { limit: 10 })
    const second = ledger.history(userId, { limit: 10, cursor: first.nextCursor! })
    const ids = new Set([...first.entries, ...second.entries].map((e) => e.id))
    expect(ids.size).toBe(20)
  })

  test("returns a null cursor on the final page", () => {
    const { nextCursor } = ledger.history(userId, { limit: 100 })
    expect(nextCursor).toBeNull()
  })

  test("filters by asset", () => {
    credit(userId, "ETH", 5000n, "eth-1")
    const { entries } = ledger.history(userId, { asset: "ETH", limit: 100 })
    expect(entries).toHaveLength(1)
    expect(entries[0]!.asset).toBe("ETH")
  })

  test("excludes other users' entries", () => {
    credit(otherId, "BTC", 9999n, "other-1")
    const { entries } = ledger.history(userId, { limit: 100 })
    expect(entries.every((e) => e.amount === 1000n)).toBe(true)
  })
})
